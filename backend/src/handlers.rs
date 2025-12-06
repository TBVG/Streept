use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

use crate::models::*;
use crate::AppState;

// Parking Handlers

#[derive(Deserialize)]
pub struct ParkingQuery {
    pub destination: String, // Format: "lat,lng"
}

pub async fn get_parking(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ParkingQuery>,
) -> Result<Json<ApiResponse<Vec<ParkingSpace>>>, StatusCode> {
    let coords: Vec<&str> = params.destination.split(',').collect();
    if coords.len() != 2 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_destination",
            "message": "Destination must be in format 'lat,lng'"
        }))));
    }

    let lat: f64 = coords[0].parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let lng: f64 = coords[1].parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    // Query parking within 500m radius using PostGIS
    let query = r#"
        SELECT 
            id,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lng,
            is_available,
            occupied_by,
            occupied_at,
            photo_url,
            pending
        FROM parking_spaces
        WHERE ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            500
        )
        AND is_available = true
        AND pending = false
        ORDER BY ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )
        LIMIT 50
    "#;

    let rows = sqlx::query(query)
        .bind(lat)
        .bind(lng)
        .fetch_all(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let parking_spaces: Vec<ParkingSpace> = rows
        .into_iter()
        .map(|row| {
            // Convert PostGIS point to JSON
            let point: sqlx::postgres::PgPoint = row.get("location");
            let location_json = json!({
                "lat": point.y,
                "lng": point.x
            });
            ParkingSpace {
                id: row.get("id"),
                location: location_json,
                is_available: row.get("is_available"),
                occupied_by: row.get("occupied_by"),
                occupied_at: row.get("occupied_at"),
                photo_url: row.get("photo_url"),
                pending: row.get("pending"),
            }
        })
        .collect();

    Ok(Json(ApiResponse::success(parking_spaces)))
}

pub async fn reserve_parking(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ParkingReservationRequest>,
) -> Result<Json<ParkingReservationResponse>, StatusCode> {
    // Use database transaction for atomic reservation
    let mut tx = state
        .db
        .pool()
        .begin()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Check current state and reserve atomically
    let check_query = r#"
        SELECT id, is_available, pending, occupied_by
        FROM parking_spaces
        WHERE id = $1
        FOR UPDATE
    "#;

    let row = sqlx::query(check_query)
        .bind(&req.parking_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = match row {
        Some(r) => r,
        None => {
            return Ok(Json(ParkingReservationResponse {
                success: false,
                data: None,
                error: Some(ParkingReservationError {
                    error: "not_found".to_string(),
                    message: "Parking spot not found.".to_string(),
                }),
            }));
        }
    };

    let is_available: bool = row.get("is_available");
    let pending: bool = row.get("pending");
    let occupied_by: Option<String> = row.get("occupied_by");

    if !is_available || pending || occupied_by.is_some() {
        tx.rollback().await.ok();
        return Ok(Json(ParkingReservationResponse {
            success: false,
            data: None,
            error: Some(ParkingReservationError {
                error: "already_reserved".to_string(),
                message: "Parking spot is already taken.".to_string(),
            }),
        }));
    }

    // Set pending state
    let update_query = r#"
        UPDATE parking_spaces
        SET pending = true,
            occupied_by = $1,
            occupied_at = NOW(),
            photo_url = $2
        WHERE id = $3
        RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, is_available, occupied_by, occupied_at, photo_url, pending
    "#;

    let row = sqlx::query(update_query)
        .bind(&req.user_id)
        .bind(&req.photo_url)
        .bind(&req.parking_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let parking_space = ParkingSpace {
        id: row.get("id"),
        location: row.get("location"),
        is_available: false,
        occupied_by: row.get("occupied_by"),
        occupied_at: row.get("occupied_at"),
        photo_url: row.get("photo_url"),
        pending: true,
    };

    Ok(Json(ParkingReservationResponse {
        success: true,
        data: Some(parking_space),
        error: None,
    }))
}

pub async fn parking_heartbeat(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ParkingHeartbeatRequest>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let ttl_minutes = state.config.parking_heartbeat_ttl_minutes;

    // Update occupied_at timestamp to extend reservation
    let query = r#"
        UPDATE parking_spaces
        SET occupied_at = NOW(),
            pending = false,
            is_available = false
        WHERE id = $1
        AND occupied_by = $2
        AND occupied_at > NOW() - INTERVAL '1 minute' * $3
    "#;

    let result = sqlx::query(query)
        .bind(&req.parking_id)
        .bind(&req.user_id)
        .bind(ttl_minutes as i64)
        .execute(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        // Reservation expired or doesn't exist
        // Clean up expired reservations
        let cleanup_query = r#"
            UPDATE parking_spaces
            SET is_available = true,
                pending = false,
                occupied_by = NULL,
                occupied_at = NULL
            WHERE id = $1
            AND (occupied_at < NOW() - INTERVAL '1 minute' * $2 OR occupied_by != $3)
        "#;

        sqlx::query(cleanup_query)
            .bind(&req.parking_id)
            .bind(ttl_minutes as i64)
            .bind(&req.user_id)
            .execute(state.db.pool())
            .await
            .ok();

        return Ok(Json(ApiResponse::error(json!({
            "error": "heartbeat_expired",
            "message": "Parking reservation has expired."
        }))));
    }

    Ok(Json(ApiResponse::success(())))
}

// Report Handlers

#[derive(Deserialize)]
pub struct ReportsQuery {
    pub lat: f64,
    pub lng: f64,
    #[serde(default = "default_radius")]
    pub radius: f64,
}

fn default_radius() -> f64 {
    1000.0 // Default 1km radius
}

pub async fn get_reports(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ReportsQuery>,
) -> Result<Json<ApiResponse<Vec<Report>>>, StatusCode> {
    let query = r#"
        SELECT 
            id,
            type,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lng,
            photo_url,
            reported_at,
            expires_at,
            reporter_id
        FROM reports
        WHERE ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
        )
        AND expires_at > NOW()
        ORDER BY reported_at DESC
        LIMIT 100
    "#;

    let rows = sqlx::query(query)
        .bind(params.lat)
        .bind(params.lng)
        .bind(params.radius)
        .fetch_all(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let reports: Vec<Report> = rows
        .into_iter()
        .map(|row| {
            let lat: f64 = row.try_get("lat").unwrap_or(0.0);
            let lng: f64 = row.try_get("lng").unwrap_or(0.0);
            let location_json = json!({
                "lat": lat,
                "lng": lng
            });
            Report {
                id: row.get("id"),
                report_type: row.get("type"),
                location: location_json,
                photo_url: row.get("photo_url"),
                reported_at: row.get("reported_at"),
                expires_at: row.get("expires_at"),
                reporter_id: row.get("reporter_id"),
            }
        })
        .collect();

    Ok(Json(ApiResponse::success(reports)))
}

pub async fn create_report(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateReportRequest>,
) -> Result<Json<ApiResponse<Report>>, StatusCode> {
    let report_id = Uuid::new_v4().to_string();
    let reporter_id = Uuid::new_v4().to_string(); // TODO: Get from auth token
    let expires_in = req.expires_in_minutes.unwrap_or(30);
    let expires_at = Utc::now() + Duration::minutes(expires_in as i64);

    let location_json = json!({
        "lat": req.location.lat,
        "lng": req.location.lng
    });

    let query = r#"
        INSERT INTO reports (id, type, location, photo_url, reported_at, expires_at, reporter_id)
        VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $5, NOW(), $6, $7)
        RETURNING id, type, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, photo_url, reported_at, expires_at, reporter_id
    "#;

    let row = sqlx::query(query)
        .bind(&report_id)
        .bind(&req.report_type)
        .bind(req.location.lat)
        .bind(req.location.lng)
        .bind(&req.photo_url)
        .bind(expires_at)
        .bind(&reporter_id)
        .fetch_one(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let report = Report {
        id: row.get("id"),
        report_type: row.get("type"),
        location: location_json,
        photo_url: row.get("photo_url"),
        reported_at: row.get("reported_at"),
        expires_at: row.get("expires_at"),
        reporter_id: row.get("reporter_id"),
    };

    Ok(Json(ApiResponse::success(report)))
}

// Billboard Handlers

#[derive(Deserialize)]
pub struct BillboardsQuery {
    pub lat: f64,
    pub lng: f64,
    #[serde(default = "default_radius")]
    pub radius: f64,
}

pub async fn get_billboards(
    State(state): State<Arc<AppState>>,
    Query(params): Query<BillboardsQuery>,
) -> Result<Json<ApiResponse<Vec<Billboard>>>, StatusCode> {
    let query = r#"
        SELECT 
            id,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lng,
            is_purchased,
            purchased_by,
            ad_image_url,
            ad_target_url,
            display_start,
            display_end
        FROM billboards
        WHERE ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
        )
        ORDER BY ST_Distance(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )
        LIMIT 50
    "#;

    let rows = sqlx::query(query)
        .bind(params.lat)
        .bind(params.lng)
        .bind(params.radius)
        .fetch_all(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let billboards: Vec<Billboard> = rows
        .into_iter()
        .map(|row| {
            let lat: f64 = row.try_get("lat").unwrap_or(0.0);
            let lng: f64 = row.try_get("lng").unwrap_or(0.0);
            let location_json = json!({
                "lat": lat,
                "lng": lng
            });
            Billboard {
                id: row.get("id"),
                location: location_json,
                is_purchased: row.get("is_purchased"),
                purchased_by: row.get("purchased_by"),
                ad_image_url: row.get("ad_image_url"),
                ad_target_url: row.get("ad_target_url"),
                display_start: row.get("display_start"),
                display_end: row.get("display_end"),
            }
        })
        .collect();

    Ok(Json(ApiResponse::success(billboards)))
}

pub async fn purchase_billboard(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<BillboardPurchaseRequest>,
) -> Result<Json<BillboardPurchaseResponse>, StatusCode> {
    if req.billboard_id != id {
        return Ok(Json(BillboardPurchaseResponse {
            success: false,
            data: None,
            error: Some(BillboardPurchaseError {
                error: "invalid_request".to_string(),
                message: "Billboard ID mismatch.".to_string(),
            }),
        }));
    }

    // Use transaction for atomic purchase
    let mut tx = state
        .db
        .pool()
        .begin()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Check if billboard is available
    let check_query = r#"
        SELECT id, is_purchased, display_end
        FROM billboards
        WHERE id = $1
        FOR UPDATE
    "#;

    let row = sqlx::query(check_query)
        .bind(&req.billboard_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = match row {
        Some(r) => r,
        None => {
            return Ok(Json(BillboardPurchaseResponse {
                success: false,
                data: None,
                error: Some(BillboardPurchaseError {
                    error: "not_found".to_string(),
                    message: "Billboard not found.".to_string(),
                }),
            }));
        }
    };

    let is_purchased: bool = row.get("is_purchased");
    let display_end: Option<chrono::DateTime<Utc>> = row.get("display_end");

    // Check if already purchased and not expired
    if is_purchased {
        if let Some(end) = display_end {
            if end > Utc::now() {
                tx.rollback().await.ok();
                return Ok(Json(BillboardPurchaseResponse {
                    success: false,
                    data: None,
                    error: Some(BillboardPurchaseError {
                        error: "already_purchased".to_string(),
                        message: "Billboard is already purchased.".to_string(),
                    }),
                }));
            }
        }
    }

    // Purchase the billboard
    let update_query = r#"
        UPDATE billboards
        SET is_purchased = true,
            purchased_by = $1,
            ad_image_url = $2,
            ad_target_url = $3,
            display_start = $4,
            display_end = $5
        WHERE id = $6
        RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, is_purchased, purchased_by, ad_image_url, ad_target_url, display_start, display_end
    "#;

    let row = sqlx::query(update_query)
        .bind(&req.user_id)
        .bind(&req.ad_image_url)
        .bind(&req.ad_target_url)
        .bind(req.display_start)
        .bind(req.display_end)
        .bind(&req.billboard_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let lat: f64 = row.try_get("lat").unwrap_or(0.0);
    let lng: f64 = row.try_get("lng").unwrap_or(0.0);
    let location_json = json!({
        "lat": lat,
        "lng": lng
    });

    let billboard = Billboard {
        id: row.get("id"),
        location: location_json,
        is_purchased: row.get("is_purchased"),
        purchased_by: row.get("purchased_by"),
        ad_image_url: row.get("ad_image_url"),
        ad_target_url: row.get("ad_target_url"),
        display_start: row.get("display_start"),
        display_end: row.get("display_end"),
    };

    Ok(Json(BillboardPurchaseResponse {
        success: true,
        data: Some(billboard),
        error: None,
    }))
}

// Route Handler

pub async fn get_route(
    State(state): State<Arc<AppState>>,
    Query(params): Query<RouteRequest>,
) -> Result<Json<ApiResponse<Route3DHighlight>>, StatusCode> {
    // TODO: Integrate with OSRM/GraphHopper for actual routing
    // For now, return a mock route with 3D highlight data

    let osrm_url = format!(
        "{}/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson",
        state.config.osrm_url,
        params.from.lng,
        params.from.lat,
        params.to.lng,
        params.to.lat
    );

    // Try to fetch from OSRM
    let response = reqwest::get(&osrm_url).await.ok();
    let segments = if let Some(resp) = response {
        if resp.status().is_success() {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                // Parse OSRM response and convert to Route3DHighlight
                parse_osrm_response(&json)
            } else {
                create_mock_route(&params.from, &params.to)
            }
        } else {
            create_mock_route(&params.from, &params.to)
        }
    } else {
        create_mock_route(&params.from, &params.to)
    };

    Ok(Json(ApiResponse::success(Route3DHighlight { segments })))
}

fn parse_osrm_response(json: &serde_json::Value) -> Vec<RouteSegment> {
    // Parse OSRM route response and convert to Route3DHighlight format
    // This is a simplified version - full implementation would parse the full geometry
    vec![]
}

fn create_mock_route(from: &Location, to: &Location) -> Vec<RouteSegment> {
    // Create a simple mock route for testing
    vec![RouteSegment {
        coords: vec![
            RouteCoord {
                lat: from.lat,
                lng: from.lng,
                alt: 0.0,
            },
            RouteCoord {
                lat: to.lat,
                lng: to.lng,
                alt: 0.0,
            },
        ],
        is_highlighted: true,
        color: "#0000FF".to_string(),
        lane_index: None,
    }]
}

