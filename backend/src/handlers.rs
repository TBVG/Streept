use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
};
use chrono::{DateTime, Duration, Utc};
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{self, AuthUser};
use crate::models::*;
use crate::AppState;
use crate::traffic_vehicles;

// Auth Handlers

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<AuthErrorBody>)> {
    let auth_err = |status: StatusCode, error: &str, message: &str| {
        (
            status,
            Json(AuthErrorBody {
                error: error.to_string(),
                message: message.to_string(),
            }),
        )
    };

    let email = req.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 3 {
        return Err(auth_err(StatusCode::BAD_REQUEST, "invalid_email", "Please enter a valid email address."));
    }
    if req.password.len() < 8 {
        return Err(auth_err(
            StatusCode::BAD_REQUEST,
            "weak_password",
            "Password must be at least 8 characters.",
        ));
    }

    let password_hash = auth::hash_password(&req.password)
        .map_err(|_| auth_err(StatusCode::INTERNAL_SERVER_ERROR, "hash_failed", "Could not process password."))?;

    let user_id = Uuid::new_v4().to_string();
    let result = sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, display_name)
        VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(&user_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&req.display_name)
    .execute(state.db.pool())
    .await;

    if let Err(e) = result {
        // Postgres unique_violation is SQLSTATE 23505 — the idx_users_email
        // unique index is what would trigger this.
        if let Some(db_err) = e.as_database_error() {
            if db_err.code().as_deref() == Some("23505") {
                return Err(auth_err(
                    StatusCode::CONFLICT,
                    "email_taken",
                    "An account with this email already exists.",
                ));
            }
        }
        return Err(auth_err(StatusCode::INTERNAL_SERVER_ERROR, "db_error", "Could not create account."));
    }

    let token = auth::create_jwt(&user_id, false, &state.config.jwt_secret)
        .map_err(|_| auth_err(StatusCode::INTERNAL_SERVER_ERROR, "token_failed", "Could not create session."))?;

    Ok(Json(AuthResponse {
        token,
        user_id,
        display_name: req.display_name,
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, Json<AuthErrorBody>)> {
    let invalid_creds = || {
        (
            StatusCode::UNAUTHORIZED,
            Json(AuthErrorBody {
                error: "invalid_credentials".to_string(),
                message: "Incorrect email or password.".to_string(),
            }),
        )
    };

    let email = req.email.trim().to_lowercase();
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE LOWER(email) = $1")
        .bind(&email)
        .fetch_optional(state.db.pool())
        .await
        .map_err(|_| invalid_creds())?
        .ok_or_else(invalid_creds)?;

    if !auth::verify_password(&req.password, &user.password_hash) {
        return Err(invalid_creds());
    }

    let token = auth::create_jwt(&user.id, user.is_admin, &state.config.jwt_secret).map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(AuthErrorBody {
                error: "token_failed".to_string(),
                message: "Could not create session.".to_string(),
            }),
        )
    })?;

    Ok(Json(AuthResponse {
        token,
        user_id: user.id,
        display_name: user.display_name,
    }))
}



#[derive(Deserialize)]
pub struct TrafficQuery {
    pub lat: f64,
    pub lng: f64,
    pub radius: Option<f64>,
}

/// Returns fresh lane-positioned vehicle observations from the configured
/// telemetry provider. The store is empty until a real provider ingests data.
/// Provider webhook for real lane-positioned vehicle telemetry.
/// Ingestion is disabled unless VEHICLE_INGEST_TOKEN is configured.
pub async fn ingest_live_traffic_vehicles(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<TrafficVehicleIngestRequest>,
) -> Result<Json<ApiResponse<TrafficVehicleIngestResponse>>, StatusCode> {
    let Some(expected) = state.config.vehicle_ingest_token.as_deref() else {
        return Err(StatusCode::NOT_FOUND);
    };
    let supplied = headers
        .get("x-vehicle-ingest-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if supplied != expected {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if req.vehicles.len() > 1000 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "batch_too_large",
            "message": "At most 1000 vehicle observations may be ingested per request"
        }))));
    }
    let mut accepted = 0usize;
    for vehicle in req.vehicles {
        if !vehicle.location.lat.is_finite()
            || !vehicle.location.lng.is_finite()
            || vehicle.location.lat.abs() > 90.0
            || vehicle.location.lng.abs() > 180.0
            || !vehicle.confidence.is_finite()
            || !(0.0..=1.0).contains(&vehicle.confidence)
            || vehicle.id.trim().is_empty()
            || vehicle.source.trim().is_empty()
        {
            continue;
        }
        traffic_vehicles::ingest_vehicle(&state, vehicle).await;
        accepted += 1;
    }
    Ok(Json(ApiResponse::success(TrafficVehicleIngestResponse { accepted })))
}

pub async fn get_live_traffic_vehicles(
    State(state): State<AppState>,
    Query(params): Query<TrafficQuery>,
) -> Result<Json<ApiResponse<Vec<crate::models::TrafficVehicle>>>, StatusCode> {
    if !params.lat.is_finite() || !params.lng.is_finite() || params.lat.abs() > 90.0 || params.lng.abs() > 180.0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }
    let radius = params.radius.unwrap_or(2500.0).clamp(250.0, 10000.0);
    let vehicles = state.traffic_vehicles.nearby(
        crate::models::Location { lat: params.lat, lng: params.lng },
        radius,
        std::time::Instant::now(),
    ).await;
    Ok(Json(ApiResponse::success(vehicles)))
}

/// Returns active community road incidents around a point. This is intentionally
/// built from the same report source used by Streept today so the client has a
/// stable traffic contract that can later be backed by a dedicated traffic
/// ingestion pipeline without changing the navigation UI.
pub async fn get_live_traffic(
    State(state): State<AppState>,
    Query(params): Query<TrafficQuery>,
) -> Result<Json<ApiResponse<Vec<Report>>>, StatusCode> {
    if !params.lat.is_finite() || !params.lng.is_finite() || params.lat.abs() > 90.0 || params.lng.abs() > 180.0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }
    let radius = params.radius.unwrap_or(2500.0).clamp(250.0, 10000.0);
    use std::sync::atomic::Ordering;
    state.traffic_requests.fetch_add(1, Ordering::Relaxed);
    let key = format!("{:.2}:{:.2}:{:.0}", params.lat, params.lng, radius);
    const TRAFFIC_CACHE_TTL: std::time::Duration = std::time::Duration::from_secs(15);
    {
        let cache = state.traffic_cache.read().await;
        if let Some((created, reports)) = cache.get(&key) {
            if created.elapsed() < TRAFFIC_CACHE_TTL {
                state.traffic_cache_hits.fetch_add(1, Ordering::Relaxed);
                return Ok(Json(ApiResponse::success(reports.clone())));
            }
        }
    }
    let rows = sqlx::query(
        r#"
        SELECT id, type, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
               photo_url, reported_at, expires_at, reporter_id, confirmations, dismissals
        FROM reports
        WHERE expires_at > NOW()
          AND type IN ('accident', 'traffic_jam', 'construction', 'closed_lane', 'hazard')
          AND ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
          )
        ORDER BY reported_at DESC
        LIMIT 120
        "#,
    )
    .bind(params.lng)
    .bind(params.lat)
    .bind(radius)
    .fetch_all(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let reports: Vec<Report> = rows.into_iter().map(|row| {
        let confirmations: i32 = row.get("confirmations");
        let dismissals: i32 = row.get("dismissals");
        let reported_at: DateTime<Utc> = row.get("reported_at");
        let age_minutes = (Utc::now() - reported_at).num_minutes().max(0) as f64;
        let vote_confidence = ((confirmations.max(0) + 1) as f64) / ((confirmations.max(0) + dismissals.max(0) + 2) as f64);
        let freshness = (-age_minutes / 90.0).exp();
        Report {
            id: row.get("id"),
            report_type: row.get("type"),
            location: json!({ "lat": row.get::<f64, _>("lat"), "lng": row.get::<f64, _>("lng") }),
            photo_url: row.get("photo_url"),
            reported_at,
            expires_at: row.get("expires_at"),
            reporter_id: "anonymous".to_string(),
            confirmations,
            dismissals,
            confidence: Some((0.65 * vote_confidence + 0.35 * freshness).clamp(0.0, 1.0)),
        }
    }).collect();

    {
        let mut cache = state.traffic_cache.write().await;
        cache.insert(key, (std::time::Instant::now(), reports.clone()));
        if cache.len() > 256 {
            let oldest = cache.iter().min_by_key(|(_, value)| value.0).map(|(k, _)| k.clone());
            if let Some(oldest) = oldest { cache.remove(&oldest); }
        }
    }

    Ok(Json(ApiResponse::success(reports)))
}

// Immersive turn-preview scene context

#[derive(Deserialize)]
pub struct SceneContextQuery {
    pub lat: f64,
    pub lng: f64,
    pub radius: Option<f64>,
}


#[derive(Deserialize)]
pub struct SceneTileQuery {
    pub lat: f64,
    pub lng: f64,
    pub zoom: Option<u8>,
}

/// Returns a pre-generated scene tile when a server-side OSM extraction is
/// configured. This endpoint never contacts public OSM services.
pub async fn get_scene_tile(
    State(state): State<AppState>,
    Query(params): Query<SceneTileQuery>,
) -> Result<Json<ApiResponse<SceneContext>>, StatusCode> {
    let zoom = params.zoom.unwrap_or(17).clamp(14, 20);
    let id = match crate::scene_tiles::tile_id(params.lat, params.lng, zoom) {
        Some(id) => id,
        None => return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        })))),
    };

    match state.scene_tiles.get(&id) {
        Some(scene) => Ok(Json(ApiResponse::success(scene))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// Returns a small, maneuver-local OSM scene. The backend caches rounded
/// coordinates for a few minutes so multiple browsers do not repeatedly hit
/// the public Overpass service for the same junction.
pub async fn get_scene_context(
    State(state): State<AppState>,
    Query(params): Query<SceneContextQuery>,
) -> Result<Json<ApiResponse<SceneContext>>, StatusCode> {
    if !params.lat.is_finite() || !params.lng.is_finite() || params.lat.abs() > 90.0 || params.lng.abs() > 180.0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }

    let radius = params.radius.unwrap_or(220.0).clamp(100.0, 300.0);
    let key = format!("{:.4}:{:.4}:{:.0}", params.lat, params.lng, radius);
    const TTL: std::time::Duration = std::time::Duration::from_secs(600);

    {
        let cache = state.scene_cache.read().await;
        if let Some((created, scene)) = cache.get(&key) {
            if created.elapsed() < TTL {
                return Ok(Json(ApiResponse::success(scene.clone())));
            }
        }
    }

    // Prefer a pre-generated server-side tile. The public Overpass request
    // below is retained only as a development fallback for deployments that
    // have not installed an OSM scene extract yet.
    let tile_zoom = 17u8;
    if let Some(tile_id) = crate::scene_tiles::tile_id(params.lat, params.lng, tile_zoom) {
        if let Some(scene) = state.scene_tiles.get(&tile_id) {
            let mut cache = state.scene_cache.write().await;
            cache.insert(key, (std::time::Instant::now(), scene.clone()));
            return Ok(Json(ApiResponse::success(scene)));
        }
    }

    let query = format!(
        "[out:json][timeout:12];(way[building](around:{r},{lat},{lng});way[\"building:part\"](around:{r},{lat},{lng});way[highway](around:{r},{lat},{lng});relation[restriction](around:{r},{lat},{lng});node[natural=tree](around:{r},{lat},{lng});node[highway=street_lamp](around:{r},{lat},{lng});node[highway=traffic_signals](around:{p},{lat},{lng});node[highway=crossing](around:{p},{lat},{lng});node[highway=stop](around:{p},{lat},{lng}););out body geom;",
        r = radius,
        p = (radius * 0.6).max(80.0),
        lat = params.lat,
        lng = params.lng,
    );

    let response = reqwest::Client::new()
        .post("https://overpass-api.de/api/interpreter")
        .timeout(std::time::Duration::from_secs(15))
        .header(reqwest::header::USER_AGENT, "Streept/0.1 immersive-navigation")
        .form(&[("data", query.as_str())])
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    if !response.status().is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }

    let payload: serde_json::Value = response.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    let elements = payload.get("elements").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut scene = SceneContext {
        buildings: Vec::new(),
        roads: Vec::new(),
        signals: Vec::new(),
        crossings: Vec::new(),
        stops: Vec::new(),
        trees: Vec::new(),
        street_lamps: Vec::new(),
        restrictions: Vec::new(),
    };

    for element in elements {
        let kind = element.get("type").and_then(|v| v.as_str()).unwrap_or_default();
        let tags = element.get("tags").and_then(|v| v.as_object());
        if kind == "way" {
            let geometry = element.get("geometry").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let coords: Vec<SceneCoord> = geometry.iter().filter_map(|p| {
                Some(SceneCoord {
                    lat: p.get("lat")?.as_f64()?,
                    lng: p.get("lon")?.as_f64()?,
                })
            }).collect();
            if coords.len() < 2 { continue; }

            if let Some(tags) = tags {
                if tags.get("building").is_some() || tags.get("building:part").is_some() {
                    scene.buildings.push(SceneBuilding {
                        geometry: coords,
                        height: parse_osm_height(tags),
                    });
                } else if let Some(highway) = tags.get("highway").and_then(|v| v.as_str()) {
                    let osm_id = element.get("id").and_then(|v| v.as_u64());
                    let node_ids = element.get("nodes")
                        .and_then(|v| v.as_array())
                        .map(|nodes| nodes.iter().filter_map(|n| n.as_u64()).collect::<Vec<_>>())
                        .unwrap_or_default();
                    scene.roads.push(SceneRoad {
                        osm_id,
                        node_ids,
                        geometry: coords,
                        highway: Some(highway.to_string()),
                        name: tags.get("name").and_then(|v| v.as_str()).map(str::to_string),
                        lanes: tags.get("lanes").and_then(|v| v.as_str()).and_then(|v| v.parse::<u32>().ok()),
                        oneway: matches!(tags.get("oneway").and_then(|v| v.as_str()), Some("yes" | "true" | "1")),
                        oneway_reverse: matches!(tags.get("oneway").and_then(|v| v.as_str()), Some("-1")),
                        surface: tags.get("surface").and_then(|v| v.as_str()).map(str::to_string),
                        smoothness: tags.get("smoothness").and_then(|v| v.as_str()).map(str::to_string),
                        lit: matches!(tags.get("lit").and_then(|v| v.as_str()), Some("yes" | "true" | "1")),
                        maxspeed: tags.get("maxspeed").and_then(|v| v.as_str()).map(str::to_string),
                        bridge: matches!(tags.get("bridge").and_then(|v| v.as_str()), Some("yes" | "true" | "1")),
                        tunnel: matches!(tags.get("tunnel").and_then(|v| v.as_str()), Some("yes" | "true" | "1")),
                        turn_lanes: parse_lane_tag(tags, "turn:lanes"),
                        change_lanes: parse_lane_tag(tags, "change:lanes"),
                        destination_lanes: parse_lane_tag(tags, "destination:lanes"),
                        toll: matches!(tags.get("toll").and_then(|v| v.as_str()), Some("yes" | "true" | "1")),
                    });
                }
            }
        } else if kind == "relation" {
            if tags.and_then(|t| t.get("type")).and_then(|v| v.as_str()) != Some("restriction") {
                continue;
            }
            let restriction = match tags.and_then(|t| t.get("restriction")).and_then(|v| v.as_str()) {
                Some(value) if value.starts_with("no_") || value.starts_with("only_") => value.to_string(),
                _ => continue,
            };
            let mut from_way_ids = Vec::new();
            let mut to_way_ids = Vec::new();
            let mut via_node_ids = Vec::new();
            let mut via_way_ids = Vec::new();
            if let Some(members) = element.get("members").and_then(|v| v.as_array()) {
                for member in members {
                    let role = member.get("role").and_then(|v| v.as_str()).unwrap_or_default();
                    let member_type = member.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                    let id = match member.get("ref").and_then(|v| v.as_u64()) {
                        Some(id) => id,
                        None => continue,
                    };
                    match (role, member_type) {
                        ("from", "way") => from_way_ids.push(id),
                        ("to", "way") => to_way_ids.push(id),
                        ("via", "node") => via_node_ids.push(id),
                        ("via", "way") => via_way_ids.push(id),
                        _ => {}
                    }
                }
            }
            if from_way_ids.is_empty() || to_way_ids.is_empty() {
                continue;
            }
            scene.restrictions.push(SceneRestriction {
                osm_id: element.get("id").and_then(|v| v.as_u64()).unwrap_or(0),
                restriction,
                from_way_ids,
                to_way_ids,
                via_node_ids,
                via_way_ids,
                except: tags.and_then(|t| t.get("except")).and_then(|v| v.as_str()).map(str::to_string),
            });
        } else if kind == "node" {
            let point = match (element.get("lat").and_then(|v| v.as_f64()), element.get("lon").and_then(|v| v.as_f64())) {
                (Some(lat), Some(lng)) => ScenePoint { lat, lng },
                _ => continue,
            };
            if tags.and_then(|t| t.get("natural")).and_then(|v| v.as_str()) == Some("tree") {
                scene.trees.push(point);
                continue;
            }
            if tags.and_then(|t| t.get("highway")).and_then(|v| v.as_str()) == Some("street_lamp") {
                scene.street_lamps.push(point);
                continue;
            }
            match tags.and_then(|t| t.get("highway")).and_then(|v| v.as_str()) {
                Some("traffic_signals") => scene.signals.push(point),
                Some("crossing") => scene.crossings.push(point),
                Some("stop") => scene.stops.push(point),
                _ => {}
            }
        }
    }

    // Keep the browser scene bounded even in dense city centers.
    scene.buildings.truncate(700);
    scene.roads.truncate(300);
    scene.signals.truncate(40);
    scene.crossings.truncate(40);
    scene.stops.truncate(30);
    scene.trees.truncate(160);
    scene.street_lamps.truncate(80);
    scene.restrictions.truncate(120);

    {
        let mut cache = state.scene_cache.write().await;
        cache.retain(|_, (created, _)| created.elapsed() < TTL);
        cache.insert(key, (std::time::Instant::now(), scene.clone()));
    }

    Ok(Json(ApiResponse::success(scene)))
}

fn parse_osm_height(tags: &serde_json::Map<String, serde_json::Value>) -> Option<f64> {
    let explicit = tags.get("height").and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok());
    if explicit.is_some_and(|h| h > 2.0 && h < 250.0) { return explicit; }
    let levels = tags.get("building:levels").and_then(|v| v.as_str()).and_then(|v| v.parse::<f64>().ok());
    levels.filter(|v| *v > 0.0 && *v < 80.0).map(|v| (v * 3.1).max(3.0))
}

fn parse_lane_tag(tags: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<Vec<String>> {
    let value = tags.get(key).and_then(|v| v.as_str())?;
    let lanes: Vec<String> = value
        .split('|')
        .map(|lane| lane.trim().to_string())
        .collect();
    if lanes.is_empty() { None } else { Some(lanes) }
}


// Parking Handlers

#[derive(Deserialize)]
pub struct ParkingQuery {
    pub destination: String, // Format: "lat,lng"
}

#[derive(Deserialize)]
pub struct ParkingNearbyQuery {
    pub lat: f64,
    pub lng: f64,
    pub radius: Option<f64>,
}

pub async fn get_parking(
    State(state): State<AppState>,
    Query(params): Query<ParkingQuery>,
) -> Result<Json<ApiResponse<Vec<ParkingLot>>>, StatusCode> {
    let coords: Vec<&str> = params.destination.split(',').collect();
    if coords.len() != 2 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_destination",
            "message": "Destination must be in format 'lat,lng'"
        }))));
    }

    let lat: f64 = coords[0].trim().parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let lng: f64 = coords[1].trim().parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    if !valid_location(Location { lat, lng }) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_destination",
            "message": "Destination coordinates are outside the valid geographic range."
        }))));
    }

    let query = r#"
        SELECT
            id,
            name,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lng,
            total_spaces,
            occupied_spaces
        FROM parking_spaces
        WHERE ST_DWithin(
            location::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            1000
        )
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

    let lots: Vec<ParkingLot> = rows
        .into_iter()
        .map(|row| {
            let lat: f64 = row.try_get("lat").unwrap_or(0.0);
            let lng: f64 = row.try_get("lng").unwrap_or(0.0);
            ParkingLot {
                id: row.get("id"),
                name: row.get("name"),
                location: json!({ "lat": lat, "lng": lng }),
                total_spaces: row.get("total_spaces"),
                occupied_spaces: row.get("occupied_spaces"),
            }
        })
        .collect();

    Ok(Json(ApiResponse::success(lots)))
}

pub async fn get_parked_cars(
    State(state): State<AppState>,
    Query(params): Query<ParkingNearbyQuery>,
) -> Result<Json<ApiResponse<Vec<ParkedCar>>>, StatusCode> {
    if !valid_location(Location { lat: params.lat, lng: params.lng }) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }
    let radius = params.radius.unwrap_or(1200.0).clamp(50.0, 2500.0);
    let rows = sqlx::query(
        r#"
        SELECT public_id::text as id, lot_id,
               ST_Y(parked_location::geometry) as lat,
               ST_X(parked_location::geometry) as lng,
               checked_in_at as parked_at
        FROM parking_occupancy
        WHERE parked_location IS NOT NULL
          AND last_seen_at > NOW() - INTERVAL '3 hours'
          AND ST_DWithin(
              parked_location,
              ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
              $3
          )
        ORDER BY ST_Distance(
            parked_location,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        )
        LIMIT 300
        "#
    )
    .bind(params.lat)
    .bind(params.lng)
    .bind(radius)
    .fetch_all(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let cars = rows.into_iter().map(|row| ParkedCar {
        id: row.get("id"),
        lot_id: row.get("lot_id"),
        location: Location {
            lat: row.try_get("lat").unwrap_or(0.0),
            lng: row.try_get("lng").unwrap_or(0.0),
        },
        parked_at: row.get("parked_at"),
    }).collect();

    Ok(Json(ApiResponse::success(cars)))
}

async fn fetch_lot(state: &AppState, lot_id: &str) -> Result<Option<ParkingLot>, StatusCode> {
    let row = sqlx::query(
        r#"
        SELECT id, name, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, total_spaces, occupied_spaces
        FROM parking_spaces WHERE id = $1
        "#,
    )
    .bind(lot_id)
    .fetch_optional(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(row.map(|row| {
        let lat: f64 = row.try_get("lat").unwrap_or(0.0);
        let lng: f64 = row.try_get("lng").unwrap_or(0.0);
        ParkingLot {
            id: row.get("id"),
            name: row.get("name"),
            location: json!({ "lat": lat, "lng": lng }),
            total_spaces: row.get("total_spaces"),
            occupied_spaces: row.get("occupied_spaces"),
        }
    }))
}

/// Marks the authenticated user as parked at a lot — called automatically
/// by the frontend when it detects the driver has stopped near a mapped
/// lot (see the parking-detection logic in NavigationView.tsx), not via a
/// manual "reserve" action. Idempotent: calling this again for the same
/// lot the user's already checked into just refreshes their heartbeat.
pub async fn checkin_parking(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<ParkingCheckinRequest>,
) -> Result<Json<ApiResponse<ParkingLot>>, StatusCode> {
    if req.location.is_some_and(|location| !valid_location(location)) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "Parking location is outside the valid geographic range."
        }))));
    }
    let mut tx = state.db.pool().begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // A person can only actually be in one place at a time. If they had a
    // *different* prior occupancy record (most likely: they left without
    // their client explicitly checking out, and this new check-in is what
    // tells us), release that one first so its lot's count doesn't stay
    // stuck occupied forever.
    let previous = sqlx::query("SELECT lot_id FROM parking_occupancy WHERE user_id = $1 FOR UPDATE")
        .bind(&auth_user.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut previous_lot_id: Option<String> = None;
    if let Some(row) = previous {
        let lot_id: String = row.get("lot_id");
        if lot_id != req.lot_id {
            sqlx::query("UPDATE parking_spaces SET occupied_spaces = GREATEST(0, occupied_spaces - 1) WHERE id = $1")
                .bind(&lot_id)
                .execute(&mut *tx)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            previous_lot_id = Some(lot_id);
        }
    }

    let upsert = sqlx::query(
        r#"
        INSERT INTO parking_occupancy (user_id, lot_id, checked_in_at, last_seen_at, parked_location)
        VALUES ($1, $2, NOW(), NOW(), CASE WHEN $3::double precision IS NULL OR $4::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography END)
        ON CONFLICT (user_id) DO UPDATE SET lot_id = EXCLUDED.lot_id, last_seen_at = NOW(), parked_location = EXCLUDED.parked_location
        "#,
    )
    .bind(&auth_user.id)
    .bind(&req.lot_id)
    .bind(req.location.map(|loc| loc.lat))
    .bind(req.location.map(|loc| loc.lng))
    .execute(&mut *tx)
    .await;

    if upsert.is_err() {
        tx.rollback().await.ok();
        return Ok(Json(ApiResponse::error(json!({
            "error": "not_found",
            "message": "Parking lot not found."
        }))));
    }

    // Only increment if this is a genuinely new check-in to this lot (not
    // just a repeat heartbeat for a lot they're already checked into).
    let was_already_here = previous_lot_id.is_none()
        && sqlx::query("SELECT 1 FROM parking_occupancy WHERE user_id = $1 AND lot_id = $2 AND checked_in_at < NOW() - INTERVAL '1 second'")
            .bind(&auth_user.id)
            .bind(&req.lot_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .is_some();

    if !was_already_here {
        sqlx::query("UPDATE parking_spaces SET occupied_spaces = occupied_spaces + 1 WHERE id = $1")
            .bind(&req.lot_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Broadcast both the new lot's updated count and, if applicable, the
    // old lot's (now-lower) count too.
    if let Some(old_lot_id) = &previous_lot_id {
        if let Ok(Some(old_lot)) = fetch_lot(&state, old_lot_id).await {
            let _ = state.ws_tx.send(WsEvent::ParkingUpdated { parking: old_lot });
        }
    }

    match fetch_lot(&state, &req.lot_id).await? {
        Some(lot) => {
            let _ = state.ws_tx.send(WsEvent::ParkingUpdated { parking: lot.clone() });
            if let Some(location) = req.location {
                let id: String = sqlx::query_scalar("SELECT public_id::text FROM parking_occupancy WHERE user_id = $1")
                    .bind(&auth_user.id).fetch_one(state.db.pool()).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let checked_in_at: DateTime<Utc> = sqlx::query_scalar("SELECT checked_in_at FROM parking_occupancy WHERE user_id = $1")
                    .bind(&auth_user.id).fetch_one(state.db.pool()).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
                let _ = state.ws_tx.send(WsEvent::ParkingCarUpdated { car: ParkedCar { id, lot_id: req.lot_id.clone(), location, parked_at: checked_in_at } });
            }
            Ok(Json(ApiResponse::success(lot)))
        }
        None => Ok(Json(ApiResponse::error(json!({
            "error": "not_found",
            "message": "Parking lot not found."
        })))),
    }
}

/// Keeps a check-in alive while parked — sent periodically (much less
/// often than the old reservation heartbeat, since "parked and stationary
/// for a while" is the expected normal state here, not something to race
/// against a short TTL).
pub async fn parking_heartbeat(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<ParkingHeartbeatRequest>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    if req.location.is_some_and(|location| !valid_location(location)) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "Parking location is outside the valid geographic range."
        }))));
    }
    let result = sqlx::query("UPDATE parking_occupancy SET last_seen_at = NOW(), parked_location = CASE WHEN $2::double precision IS NULL OR $3::double precision IS NULL THEN parked_location ELSE ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography END WHERE user_id = $1")
        .bind(&auth_user.id)
        .bind(req.location.map(|loc| loc.lat))
        .bind(req.location.map(|loc| loc.lng))
        .execute(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "not_checked_in",
            "message": "No active parking check-in found for this user."
        }))));
    }

    Ok(Json(ApiResponse::success(())))
}

/// Marks the authenticated user as having left — called automatically when
/// the frontend detects the driver moving away from where they were
/// parked (sustained speed above a threshold), not via a manual button.
pub async fn checkout_parking(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let mut tx = state.db.pool().begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = sqlx::query("DELETE FROM parking_occupancy WHERE user_id = $1 RETURNING lot_id, public_id::text as public_id, ST_Y(parked_location::geometry) as lat, ST_X(parked_location::geometry) as lng")
        .bind(&auth_user.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(row) = row else {
        tx.rollback().await.ok();
        return Ok(Json(ApiResponse::error(json!({
            "error": "not_checked_in",
            "message": "No active parking check-in found for this user."
        }))));
    };
    let lot_id: String = row.get("lot_id");
    let public_id: String = row.get("public_id");
    let parked_location = match (row.try_get::<Option<f64>, _>("lat"), row.try_get::<Option<f64>, _>("lng")) {
        (Ok(Some(lat)), Ok(Some(lng))) => Some(Location { lat, lng }),
        _ => None,
    };

    sqlx::query("UPDATE parking_spaces SET occupied_spaces = GREATEST(0, occupied_spaces - 1) WHERE id = $1")
        .bind(&lot_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Ok(Some(lot)) = fetch_lot(&state, &lot_id).await {
        let _ = state.ws_tx.send(WsEvent::ParkingUpdated { parking: lot });
    }
    if let Some(location) = parked_location {
        let _ = state.ws_tx.send(WsEvent::ParkingCarRemoved { id: public_id, lot_id, location });
    }

    Ok(Json(ApiResponse::success(())))
}

/// Auto-checks-out anyone whose client hasn't sent a heartbeat in a while
/// (app closed, phone died, etc. without an explicit checkout). Intended
/// to be run on a periodic timer from main.rs, independent of any
/// individual request.
pub async fn sweep_stale_parking_occupancy(state: &AppState) -> Result<u64, sqlx::Error> {
    let mut tx = state.db.pool().begin().await?;

    let stale_lot_ids: Vec<String> = sqlx::query(
        "SELECT lot_id FROM parking_occupancy WHERE last_seen_at < NOW() - INTERVAL '3 hours'",
    )
    .fetch_all(&mut *tx)
    .await?
    .into_iter()
    .map(|row| row.get("lot_id"))
    .collect();

    let result = sqlx::query("DELETE FROM parking_occupancy WHERE last_seen_at < NOW() - INTERVAL '3 hours'")
        .execute(&mut *tx)
        .await?;

    for lot_id in &stale_lot_ids {
        sqlx::query("UPDATE parking_spaces SET occupied_spaces = GREATEST(0, occupied_spaces - 1) WHERE id = $1")
            .bind(lot_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;

    for lot_id in &stale_lot_ids {
        if let Ok(Some(lot)) = fetch_lot(state, lot_id).await {
            let _ = state.ws_tx.send(WsEvent::ParkingUpdated { parking: lot });
        }
    }

    Ok(result.rows_affected())
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

pub async fn ingest_spatial_observations(
    State(state): State<AppState>,
    Json(req): Json<SpatialObservationBatchRequest>,
) -> Result<Json<ApiResponse<SpatialObservationBatchResponse>>, StatusCode> {
    const MAX_BATCH: usize = 50;
    const ALLOWED_TYPES: [&str; 4] = [
        "maneuver_completed", "maneuver_missed", "hazard_observed", "lane_misalignment",
    ];
    const ALLOWED_ALIGNMENT: [&str; 3] = ["aligned", "misaligned", "unknown"];

    if req.observations.is_empty() {
        return Ok(Json(ApiResponse::success(SpatialObservationBatchResponse { accepted: 0 })));
    }
    if req.observations.len() > MAX_BATCH {
        return Ok(Json(ApiResponse::error(json!({
            "error": "batch_too_large",
            "message": "A maximum of 50 observations may be uploaded at once."
        }))));
    }

    let mut tx = state.db.pool().begin().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut accepted = 0usize;
    for observation in req.observations {
        if observation.id.trim().is_empty() || observation.id.len() > 255
            || !ALLOWED_TYPES.contains(&observation.observation_type.as_str())
            || !ALLOWED_ALIGNMENT.contains(&observation.lane_alignment.as_str())
            || observation.maneuver.len() > 120
            || observation.maneuver_key.as_ref().is_some_and(|v| v.len() > 255)
            || !observation.confidence.is_finite()
            || !(0.0..=1.0).contains(&observation.confidence)
            || observation.at > Utc::now() + Duration::minutes(10)
            || observation.at < Utc::now() - Duration::days(30)
        {
            return Ok(Json(ApiResponse::error(json!({
                "error": "invalid_observation",
                "message": "Observation contains invalid or unsafe fields."
            }))));
        }

        let result = sqlx::query(
            r#"INSERT INTO spatial_observations
               (id, observed_at, observation_type, route_generation, maneuver_key, way_id, maneuver, lane_alignment, confidence)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (id) DO NOTHING"#,
        )
        .bind(observation.id)
        .bind(observation.at)
        .bind(observation.observation_type)
        .bind(i64::try_from(observation.route_generation).unwrap_or(i64::MAX))
        .bind(observation.maneuver_key)
        .bind(observation.way_id)
        .bind(observation.maneuver)
        .bind(observation.lane_alignment)
        .bind(observation.confidence)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        accepted += result.rows_affected() as usize;
    }
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(ApiResponse::success(SpatialObservationBatchResponse { accepted })))
}

#[derive(Deserialize)]
pub struct RoadIntelligenceBatchQuery {
    pub way_ids: String,
    #[serde(default = "default_intelligence_days")]
    pub days: i64,
}

pub async fn get_road_intelligence_batch(
    State(state): State<AppState>,
    Query(params): Query<RoadIntelligenceBatchQuery>,
) -> Result<Json<ApiResponse<Vec<RoadIntelligenceAggregate>>>, StatusCode> {
    let days = params.days.clamp(1, 30);
    let way_ids: Vec<i64> = params.way_ids.split(',')
        .filter_map(|v| v.trim().parse::<i64>().ok())
        .filter(|v| *v > 0)
        .take(128)
        .collect();
    if way_ids.is_empty() {
        return Ok(Json(ApiResponse::success(Vec::new())));
    }
    let rows = sqlx::query(
        r#"SELECT way_id,
            COUNT(*)::bigint AS observations,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_completed')::bigint AS completed,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_missed')::bigint AS missed,
            COUNT(*) FILTER (WHERE observation_type = 'lane_misalignment')::bigint AS lane_misalignments,
            COUNT(*) FILTER (WHERE observation_type = 'hazard_observed')::bigint AS hazards,
            COALESCE(AVG(confidence), 0.0)::double precision AS avg_confidence
           FROM spatial_observations
           WHERE way_id = ANY($1) AND observed_at >= NOW() - ($2 * INTERVAL '1 day')
           GROUP BY way_id"#
    )
    .bind(&way_ids)
    .bind(days)
    .fetch_all(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = rows.into_iter().map(|row| {
        let way_id: i64 = row.get("way_id");
        let observations: i64 = row.try_get("observations").unwrap_or(0);
        let completed: i64 = row.try_get("completed").unwrap_or(0);
        let missed: i64 = row.try_get("missed").unwrap_or(0);
        let lane_misalignments: i64 = row.try_get("lane_misalignments").unwrap_or(0);
        let hazards: i64 = row.try_get("hazards").unwrap_or(0);
        let avg_confidence: f64 = row.try_get::<f64, _>("avg_confidence").unwrap_or(0.0).clamp(0.0_f64, 1.0_f64);
        let decision_count = completed + missed;
        let miss_rate = missed as f64 / decision_count.max(1) as f64;
        let lane_rate = lane_misalignments as f64 / observations.max(1) as f64;
        let hazard_rate = hazards as f64 / observations.max(1) as f64;
        let score = (100.0 * (0.55 * miss_rate + 0.25 * lane_rate + 0.20 * hazard_rate)).round();
        let confidence = ((observations as f64 / 20.0).min(1.0) * avg_confidence).clamp(0.0, 1.0);
        RoadIntelligenceAggregate { way_id, observations, completed, missed, lane_misalignments, hazards, miss_rate, lane_misalignment_rate: lane_rate, hazard_rate, score, confidence }
    }).collect();
    Ok(Json(ApiResponse::success(result)))
}

#[derive(Deserialize)]
pub struct RoadIntelligenceQuery {
    pub way_id: i64,
    #[serde(default = "default_intelligence_days")]
    pub days: i64,
}

fn default_intelligence_days() -> i64 { 30 }

#[derive(Deserialize)]
pub struct RoadIntelligenceTemporalQuery {
    pub way_ids: String,
    #[serde(default = "default_intelligence_days")]
    pub days: i64,
}

pub async fn get_road_intelligence_temporal(
    State(state): State<AppState>,
    Query(params): Query<RoadIntelligenceTemporalQuery>,
) -> Result<Json<ApiResponse<Vec<RoadIntelligenceTemporalBucket>>>, StatusCode> {
    let days = params.days.clamp(1, 30);
    let way_ids: Vec<i64> = params.way_ids.split(',')
        .filter_map(|v| v.trim().parse::<i64>().ok())
        .filter(|v| *v > 0)
        .take(128)
        .collect();
    if way_ids.is_empty() {
        return Ok(Json(ApiResponse::success(Vec::new())));
    }
    let rows = sqlx::query(
        r#"SELECT way_id,
            EXTRACT(DOW FROM observed_at)::int AS weekday,
            EXTRACT(HOUR FROM observed_at)::int AS hour,
            COUNT(*)::bigint AS observations,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_missed')::bigint AS missed,
            COUNT(*) FILTER (WHERE observation_type = 'lane_misalignment')::bigint AS lane_misalignments,
            COUNT(*) FILTER (WHERE observation_type = 'hazard_observed')::bigint AS hazards,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_completed')::bigint AS completed,
            COALESCE(AVG(confidence), 0.0)::double precision AS avg_confidence
           FROM spatial_observations
           WHERE way_id = ANY($1) AND observed_at >= NOW() - ($2 * INTERVAL '1 day')
           GROUP BY way_id, EXTRACT(DOW FROM observed_at), EXTRACT(HOUR FROM observed_at)"#
    )
    .bind(&way_ids)
    .bind(days)
    .fetch_all(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = rows.into_iter().map(|row| {
        let way_id: i64 = row.get("way_id");
        let weekday: i32 = row.try_get("weekday").unwrap_or(0);
        let hour: i32 = row.try_get("hour").unwrap_or(0);
        let observations: i64 = row.try_get("observations").unwrap_or(0);
        let missed: i64 = row.try_get("missed").unwrap_or(0);
        let completed: i64 = row.try_get("completed").unwrap_or(0);
        let lane_misalignments: i64 = row.try_get("lane_misalignments").unwrap_or(0);
        let hazards: i64 = row.try_get("hazards").unwrap_or(0);
        let avg_confidence: f64 = row.try_get::<f64, _>("avg_confidence").unwrap_or(0.0).clamp(0.0_f64, 1.0_f64);
        let decisions = (completed + missed).max(1) as f64;
        let miss_rate = missed as f64 / decisions;
        let lane_rate = lane_misalignments as f64 / observations.max(1) as f64;
        let hazard_rate = hazards as f64 / observations.max(1) as f64;
        let score = (100.0 * (0.55 * miss_rate + 0.25 * lane_rate + 0.20 * hazard_rate)).round();
        let confidence = ((observations as f64 / 8.0).min(1.0) * avg_confidence).clamp(0.0, 1.0);
        RoadIntelligenceTemporalBucket { way_id, weekday, hour, observations, score, confidence }
    }).collect();
    Ok(Json(ApiResponse::success(result)))
}

pub async fn get_road_intelligence(
    State(state): State<AppState>,
    Query(params): Query<RoadIntelligenceQuery>,
) -> Result<Json<ApiResponse<RoadIntelligenceAggregate>>, StatusCode> {
    if params.way_id <= 0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_way_id", "message": "way_id must be positive"
        }))));
    }
    let days = params.days.clamp(1, 30);
    let row = sqlx::query(
        r#"SELECT
            COUNT(*)::bigint AS observations,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_completed')::bigint AS completed,
            COUNT(*) FILTER (WHERE observation_type = 'maneuver_missed')::bigint AS missed,
            COUNT(*) FILTER (WHERE observation_type = 'lane_misalignment')::bigint AS lane_misalignments,
            COUNT(*) FILTER (WHERE observation_type = 'hazard_observed')::bigint AS hazards,
            COALESCE(AVG(confidence), 0.0)::double precision AS avg_confidence
           FROM spatial_observations
           WHERE way_id = $1 AND observed_at >= NOW() - ($2 * INTERVAL '1 day')"#,
    )
    .bind(params.way_id)
    .bind(days)
    .fetch_one(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let observations: i64 = row.try_get("observations").unwrap_or(0);
    let completed: i64 = row.try_get("completed").unwrap_or(0);
    let missed: i64 = row.try_get("missed").unwrap_or(0);
    let lane_misalignments: i64 = row.try_get("lane_misalignments").unwrap_or(0);
    let hazards: i64 = row.try_get("hazards").unwrap_or(0);
    let avg_confidence: f64 = row.try_get::<f64, _>("avg_confidence").unwrap_or(0.0).clamp(0.0_f64, 1.0_f64);
    let decision_count = completed + missed;
    let miss_rate = missed as f64 / decision_count.max(1) as f64;
    let lane_rate = lane_misalignments as f64 / observations.max(1) as f64;
    let hazard_rate = hazards as f64 / observations.max(1) as f64;
    let score = (100.0 * (0.55 * miss_rate + 0.25 * lane_rate + 0.20 * hazard_rate)).round();
    let confidence = ((observations as f64 / 20.0).min(1.0) * avg_confidence).clamp(0.0, 1.0);

    Ok(Json(ApiResponse::success(RoadIntelligenceAggregate {
        way_id: params.way_id, observations, completed, missed, lane_misalignments, hazards,
        miss_rate, lane_misalignment_rate: lane_rate, hazard_rate, score, confidence,
    })))
}

pub async fn get_reports(
    State(state): State<AppState>,
    Query(params): Query<ReportsQuery>,
) -> Result<Json<ApiResponse<Vec<Report>>>, StatusCode> {
    if !valid_location(Location { lat: params.lat, lng: params.lng }) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }
    let radius = params.radius.clamp(50.0, 5000.0);
    let query = r#"
        SELECT 
            id,
            type,
            ST_Y(location::geometry) as lat,
            ST_X(location::geometry) as lng,
            photo_url,
            reported_at,
            expires_at,
            reporter_id,
            confirmations,
            dismissals
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
        .bind(radius)
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
                reporter_id: "anonymous".to_string(),
                confirmations: row.get("confirmations"),
                dismissals: row.get("dismissals"),
                confidence: None,
            }
        })
        .collect();

    Ok(Json(ApiResponse::success(reports)))
}

pub async fn create_report(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateReportRequest>,
) -> Result<Json<ApiResponse<Report>>, StatusCode> {
    const MIN_REPORT_TTL_MINUTES: u64 = 5;
    const MAX_REPORT_TTL_MINUTES: u64 = 24 * 60;
    const ALLOWED_REPORT_TYPES: [&str; 6] = ["cop", "hazard", "construction", "accident", "traffic_jam", "closed_lane"];

    if !valid_location(req.location) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "Report coordinates are outside the valid geographic range."
        }))));
    }
    if !ALLOWED_REPORT_TYPES.contains(&req.report_type.as_str()) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_report_type",
            "message": "Unsupported report type."
        }))));
    }
    let expires_in = req.expires_in_minutes.unwrap_or(30);
    if !(MIN_REPORT_TTL_MINUTES..=MAX_REPORT_TTL_MINUTES).contains(&expires_in) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_expiry",
            "message": "Report expiry must be between 5 minutes and 24 hours."
        }))));
    }
    if req.photo_url.as_deref().is_some_and(|url| !valid_https_url(url, 2048)) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_photo_url",
            "message": "photo_url must be a valid https:// URL."
        }))));
    }

    let report_id = Uuid::new_v4().to_string();
    let reporter_id = auth_user.id;
    let expires_at = Utc::now() + Duration::minutes(expires_in as i64);

    let location_json = json!({
        "lat": req.location.lat,
        "lng": req.location.lng
    });

    let query = r#"
        INSERT INTO reports (id, type, location, photo_url, reported_at, expires_at, reporter_id)
        VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), $5, NOW(), $6, $7)
        RETURNING id, type, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, photo_url, reported_at, expires_at, reporter_id, confirmations, dismissals
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
        reporter_id: "anonymous".to_string(),
        confirmations: row.get("confirmations"),
        dismissals: row.get("dismissals"),
        confidence: None,
    };

    // Best-effort: a lack of subscribers (no clients connected) or a full
    // channel buffer isn't a reason to fail the request itself.
    let _ = state.ws_tx.send(WsEvent::ReportCreated { report: report.clone() });

    Ok(Json(ApiResponse::success(report)))
}

// How much a confirmation extends a report's expiry by — this is the actual
// crowd-verification mechanic: a report that keeps getting confirmed as
// drivers pass it stays alive, one that doesn't quietly times out on its
// original TTL.
const CONFIRM_EXTENSION_MINUTES: i64 = 10;
// If dismissals outnumber confirmations by this much, the report is likely
// gone/wrong — expire it immediately rather than waiting out the clock.
const DISMISS_THRESHOLD: i32 = 2;

async fn record_report_vote(
    state: &AppState,
    report_id: &str,
    voter_id: &str,
    vote_type: &str,
) -> Result<Report, StatusCode> {
    let mut tx = state
        .db
        .pool()
        .begin()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Upsert the vote — a voter can flip their vote, but only ever counts once.
    sqlx::query(
        r#"
        INSERT INTO report_votes (report_id, voter_id, vote_type)
        VALUES ($1, $2, $3)
        ON CONFLICT (report_id, voter_id)
        DO UPDATE SET vote_type = EXCLUDED.vote_type, created_at = NOW()
        "#,
    )
    .bind(report_id)
    .bind(voter_id)
    .bind(vote_type)
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Recompute counts from the votes table (rather than incrementing a
    // counter) so a changed vote is reflected correctly rather than double
    // counted.
    let counts = sqlx::query(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE vote_type = 'confirm') AS confirmations,
            COUNT(*) FILTER (WHERE vote_type = 'dismiss') AS dismissals
        FROM report_votes
        WHERE report_id = $1
        "#,
    )
    .bind(report_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let confirmations: i64 = counts.get("confirmations");
    let dismissals: i64 = counts.get("dismissals");

    // A fresh confirmation means "still there right now" — push expiry out.
    // Repeated dismissals past the threshold mean "not there" — expire now.
    let row = if vote_type == "confirm" {
        sqlx::query(
            r#"
            UPDATE reports
            SET confirmations = $2,
                dismissals = $3,
                expires_at = GREATEST(expires_at, NOW() + (INTERVAL '1 minute' * $4::double precision))
            WHERE id = $1
            RETURNING id, type, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, photo_url, reported_at, expires_at, reporter_id, confirmations, dismissals
            "#,
        )
        .bind(report_id)
        .bind(confirmations as i32)
        .bind(dismissals as i32)
        .bind(CONFIRM_EXTENSION_MINUTES as f64)
        .fetch_optional(&mut *tx)
        .await
    } else {
        let should_expire_now = (dismissals - confirmations) as i32 >= DISMISS_THRESHOLD;
        sqlx::query(
            r#"
            UPDATE reports
            SET confirmations = $2,
                dismissals = $3,
                expires_at = CASE WHEN $4 THEN NOW() ELSE expires_at END
            WHERE id = $1
            RETURNING id, type, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, photo_url, reported_at, expires_at, reporter_id, confirmations, dismissals
            "#,
        )
        .bind(report_id)
        .bind(confirmations as i32)
        .bind(dismissals as i32)
        .bind(should_expire_now)
        .fetch_optional(&mut *tx)
        .await
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::NOT_FOUND)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let lat: f64 = row.try_get("lat").unwrap_or(0.0);
    let lng: f64 = row.try_get("lng").unwrap_or(0.0);

    let report = Report {
        id: row.get("id"),
        report_type: row.get("type"),
        location: json!({ "lat": lat, "lng": lng }),
        photo_url: row.get("photo_url"),
        reported_at: row.get("reported_at"),
        expires_at: row.get("expires_at"),
        reporter_id: "anonymous".to_string(),
        confirmations: row.get("confirmations"),
        dismissals: row.get("dismissals"),
        confidence: None,
    };

    // If this vote pushed the report's expiry into the past (the
    // dismiss-threshold case), tell connected clients it's gone rather
    // than that it merely changed — they'd otherwise keep showing a report
    // that no longer passes get_reports' `expires_at > NOW()` filter.
    let event = if report.expires_at <= Utc::now() {
        WsEvent::ReportRemoved {
            id: report.id.clone(),
            location: Location {
                lat: report
                    .location
                    .get("lat")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
                lng: report
                    .location
                    .get("lng")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
            },
        }
    } else {
        WsEvent::ReportUpdated { report: report.clone() }
    };
    let _ = state.ws_tx.send(event);

    Ok(report)
}

pub async fn confirm_report(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Report>>, StatusCode> {
    let report = record_report_vote(&state, &id, &auth_user.id, "confirm").await?;
    Ok(Json(ApiResponse::success(report)))
}

pub async fn dismiss_report(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Report>>, StatusCode> {
    let report = record_report_vote(&state, &id, &auth_user.id, "dismiss").await?;
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
    State(state): State<AppState>,
    Query(params): Query<BillboardsQuery>,
) -> Result<Json<ApiResponse<Vec<Billboard>>>, StatusCode> {
    if !valid_location(Location { lat: params.lat, lng: params.lng }) {
        return Ok(Json(ApiResponse::error(json!({
            "error": "invalid_coordinates",
            "message": "lat/lng must be valid geographic coordinates"
        }))));
    }
    let radius = params.radius.clamp(50.0, 5000.0);
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
            display_end,
            click_count,
            moderation_status
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
        .bind(radius)
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
                click_count: row.get("click_count"),
                moderation_status: row.get("moderation_status"),
            }
        })
        .collect();

    // Only show ads that passed moderation — a purchased-but-pending or
    // rejected billboard shouldn't display anything to other users (it's
    // still shown as "available" for booking purposes elsewhere, but its ad
    // content is hidden here).
    let billboards: Vec<Billboard> = billboards
        .into_iter()
        .map(|mut b| {
            if b.is_purchased && b.moderation_status != "approved" {
                b.is_purchased = false;
                b.ad_image_url = None;
                b.ad_target_url = None;
            }
            b
        })
        .collect();

    Ok(Json(ApiResponse::success(billboards)))
}

// Billboard booking window constraints. Without these, a purchase request
// could book a billboard for decades (effective squatting) or with an
// inverted/expired window that would never actually display anything.
const MIN_DISPLAY_DURATION_MINUTES: i64 = 60; // 1 hour
const MAX_DISPLAY_DURATION_DAYS: i64 = 30;

fn validate_billboard_window(
    display_start: DateTime<Utc>,
    display_end: DateTime<Utc>,
) -> Result<(), BillboardPurchaseError> {
    if display_end <= display_start {
        return Err(BillboardPurchaseError {
            error: "invalid_window".to_string(),
            message: "display_end must be after display_start.".to_string(),
        });
    }
    // Small grace period for clock skew between client and server rather
    // than rejecting a start time that's technically a few seconds in the
    // past by the time the request lands.
    if display_start < Utc::now() - Duration::minutes(1) {
        return Err(BillboardPurchaseError {
            error: "invalid_window".to_string(),
            message: "display_start cannot be in the past.".to_string(),
        });
    }
    let duration = display_end - display_start;
    if duration < Duration::minutes(MIN_DISPLAY_DURATION_MINUTES) {
        return Err(BillboardPurchaseError {
            error: "invalid_window".to_string(),
            message: format!(
                "Display window must be at least {} minutes.",
                MIN_DISPLAY_DURATION_MINUTES
            ),
        });
    }
    if duration > Duration::days(MAX_DISPLAY_DURATION_DAYS) {
        return Err(BillboardPurchaseError {
            error: "invalid_window".to_string(),
            message: format!(
                "Display window cannot exceed {} days.",
                MAX_DISPLAY_DURATION_DAYS
            ),
        });
    }
    Ok(())
}

/// Very basic content-safety gate on the URLs themselves — this is not
/// content moderation (nothing inspects what the image actually shows),
/// just closing off obviously malicious schemes/protocols before a URL
/// ever gets stored and rendered back to other users' browsers.
fn validate_billboard_urls(ad_image_url: &str, ad_target_url: &str) -> Result<(), BillboardPurchaseError> {
    let bad_url = |field: &str| BillboardPurchaseError {
        error: "invalid_url".to_string(),
        message: format!("{} must be a valid https:// URL.", field),
    };
    if !ad_image_url.starts_with("https://") {
        return Err(bad_url("ad_image_url"));
    }
    if !ad_target_url.starts_with("https://") {
        return Err(bad_url("ad_target_url"));
    }
    Ok(())
}

pub async fn purchase_billboard(
    State(state): State<AppState>,
    auth_user: AuthUser,
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

    if let Err(validation_error) = validate_billboard_window(req.display_start, req.display_end) {
        return Ok(Json(BillboardPurchaseResponse {
            success: false,
            data: None,
            error: Some(validation_error),
        }));
    }

    if let Err(validation_error) = validate_billboard_urls(&req.ad_image_url, &req.ad_target_url) {
        return Ok(Json(BillboardPurchaseResponse {
            success: false,
            data: None,
            error: Some(validation_error),
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

    // Purchase the billboard. click_count resets to 0 — it tracks
    // engagement for the current booking, not the billboard's lifetime.
    // In the free beta, submissions go live immediately so the team can
    // test the advertising experience end-to-end. Paid billing and a more
    // sophisticated moderation workflow can be layered on later.
    let update_query = r#"
        UPDATE billboards
        SET is_purchased = true,
            purchased_by = $1,
            ad_image_url = $2,
            ad_target_url = $3,
            display_start = $4,
            display_end = $5,
            click_count = 0,
            moderation_status = 'approved'
        WHERE id = $6
        RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, is_purchased, purchased_by, ad_image_url, ad_target_url, display_start, display_end, click_count, moderation_status
    "#;

    let row = sqlx::query(update_query)
        .bind(&auth_user.id)
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
        click_count: row.get("click_count"),
        moderation_status: row.get("moderation_status"),
    };

    Ok(Json(BillboardPurchaseResponse {
        success: true,
        data: Some(billboard),
        error: None,
    }))
}

/// Records a click-through on a currently-displaying billboard's ad. This
/// is the "click-through tracking" the project docs list as a planned
/// feature — real ad billing would key off this, though there's no
/// pricing/billing model in this project yet.
pub async fn click_billboard(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<i32>>, StatusCode> {
    let query = r#"
        UPDATE billboards
        SET click_count = click_count + 1
        WHERE id = $1
        AND is_purchased = true
        AND moderation_status = 'approved'
        AND display_start <= NOW()
        AND display_end > NOW()
        RETURNING click_count
    "#;

    let row = sqlx::query(query)
        .bind(&id)
        .fetch_optional(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match row {
        Some(row) => {
            let click_count: i32 = row.get("click_count");
            Ok(Json(ApiResponse::success(click_count)))
        }
        None => Ok(Json(ApiResponse::error(json!({
            "error": "not_active",
            "message": "This billboard isn't currently displaying an ad."
        })))),
    }
}

#[derive(Deserialize)]
pub struct ModerateBillboardRequest {
    pub approve: bool,
}

/// Admin-only: approve or reject a billboard ad. Kept as a future safety
/// valve for when Streept opens the marketplace beyond the free beta.
pub async fn moderate_billboard(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(id): Path<String>,
    Json(req): Json<ModerateBillboardRequest>,
) -> Result<Json<ApiResponse<Billboard>>, StatusCode> {
    if !auth_user.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    let new_status = if req.approve { "approved" } else { "rejected" };

    let query = r#"
        UPDATE billboards
        SET moderation_status = $1
        WHERE id = $2
        AND is_purchased = true
        RETURNING id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng, is_purchased, purchased_by, ad_image_url, ad_target_url, display_start, display_end, click_count, moderation_status
    "#;

    let row = sqlx::query(query)
        .bind(new_status)
        .bind(&id)
        .fetch_optional(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::NOT_FOUND)?;
    let lat: f64 = row.try_get("lat").unwrap_or(0.0);
    let lng: f64 = row.try_get("lng").unwrap_or(0.0);

    Ok(Json(ApiResponse::success(Billboard {
        id: row.get("id"),
        location: json!({ "lat": lat, "lng": lng }),
        is_purchased: row.get("is_purchased"),
        purchased_by: row.get("purchased_by"),
        ad_image_url: row.get("ad_image_url"),
        ad_target_url: row.get("ad_target_url"),
        display_start: row.get("display_start"),
        display_end: row.get("display_end"),
        click_count: row.get("click_count"),
        moderation_status: row.get("moderation_status"),
    })))
}

// Route Handler

#[derive(Deserialize)]
pub struct RouteQuery {
    pub from: String, // Format: "lat,lng"
    pub to: String,   // Format: "lat,lng"
}

fn parse_lat_lng(s: &str) -> Option<Location> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 2 {
        return None;
    }
    let lat: f64 = parts[0].trim().parse().ok()?;
    let lng: f64 = parts[1].trim().parse().ok()?;
    Some(Location { lat, lng })
}

fn valid_location(location: Location) -> bool {
    location.lat.is_finite()
        && location.lng.is_finite()
        && location.lat.abs() <= 90.0
        && location.lng.abs() <= 180.0
}

fn valid_https_url(value: &str, max_len: usize) -> bool {
    let value = value.trim();
    value.len() <= max_len
        && value.starts_with("https://")
        && !value.contains('\n')
        && !value.contains('\r')
        && value[8..].contains('.')
}


#[derive(Deserialize)]
pub struct OfflinePlanQuery { pub from: String, pub to: String }

pub async fn get_offline_plan(
    State(_state): State<AppState>,
    Query(params): Query<OfflinePlanQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let from = parse_lat_lng(&params.from).ok_or(StatusCode::BAD_REQUEST)?;
    let to = parse_lat_lng(&params.to).ok_or(StatusCode::BAD_REQUEST)?;
    let distance_km = from.distance_meters(&to) / 1000.0;
    if distance_km > 800.0 {
        return Ok(Json(ApiResponse::error(json!({
            "error": "region_too_large",
            "message": "Choose a smaller driving region for offline preparation."
        }))));
    }
    Ok(Json(ApiResponse::success(json!({
        "version": 1,
        "scope": "trip",
        "from": from,
        "to": to,
        "distance_km": distance_km,
        "providers": {
            "routing": "configurable",
            "scene": "configurable",
            "traffic": "live-only"
        },
        "note": "The client stores the route and maneuver-local scenes locally; live traffic is not treated as offline truth."
    }))))
}

pub async fn get_route(
    State(state): State<AppState>,
    Query(params): Query<RouteQuery>,
) -> Result<Json<ApiResponse<RouteOptions>>, StatusCode> {
    use std::sync::atomic::Ordering;
    state.route_requests.fetch_add(1, Ordering::Relaxed);
    let from = parse_lat_lng(&params.from).ok_or(StatusCode::BAD_REQUEST)?;
    let to = parse_lat_lng(&params.to).ok_or(StatusCode::BAD_REQUEST)?;
    if !from.lat.is_finite() || !from.lng.is_finite() || !to.lat.is_finite() || !to.lng.is_finite()
        || from.lat.abs() > 90.0 || to.lat.abs() > 90.0 || from.lng.abs() > 180.0 || to.lng.abs() > 180.0 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let cache_key = format!("{:.5},{:.5}:{:.5},{:.5}", from.lat, from.lng, to.lat, to.lng);
    {
        let cache = state.route_cache.read().await;
        if let Some((created, cached)) = cache.get(&cache_key) {
            if created.elapsed() < std::time::Duration::from_secs(state.config.route_cache_ttl_seconds.max(1)) {
                return Ok(Json(ApiResponse::success(cached.clone())));
            }
        }
    }

    let route_path = format!(
        "/route/v1/driving/{},{};{},{}?overview=full&geometries=geojson&steps=true&alternatives=2",
        from.lng, from.lat, to.lng, to.lat
    );
    let providers = std::iter::once(state.config.osrm_url.trim_end_matches('/').to_string())
        .chain(state.config.routing_fallback_url.iter().map(|url| url.trim_end_matches('/').to_string()))
        .collect::<Vec<_>>();
    let mut parsed_routes = None;
    for provider in providers {
        let url = format!("{}{}", provider, route_path);
        match state.http_client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
                Ok(json) => if let Some(parsed) = parse_osrm_response(&json) {
                    parsed_routes = Some(parsed);
                    break;
                } else {
                    tracing::warn!(provider = %provider, "routing provider returned no usable route geometry");
                },
                Err(err) => tracing::warn!(provider = %provider, error = %err, "routing provider returned invalid JSON"),
            },
            Ok(resp) => tracing::warn!(provider = %provider, status = %resp.status(), "routing provider request failed"),
            Err(err) => tracing::warn!(provider = %provider, error = %err, "routing provider request failed"),
        }
    }
    let routes = match parsed_routes {
        Some(routes) => routes,
        None => {
            state.route_failures.fetch_add(1, Ordering::Relaxed);
            return Err(StatusCode::BAD_GATEWAY);
        }
    };
    let result = RouteOptions { routes };
    {
        let mut cache = state.route_cache.write().await;
        cache.retain(|_, (created, _)| created.elapsed() < std::time::Duration::from_secs(state.config.route_cache_ttl_seconds.max(1)));
        cache.insert(cache_key, (std::time::Instant::now(), result.clone()));
        if cache.len() > 512 {
            if let Some(oldest) = cache.iter().min_by_key(|(_, v)| v.0).map(|(k, _)| k.clone()) {
                cache.remove(&oldest);
            }
        }
    }
    Ok(Json(ApiResponse::success(result)))
}

/// OSRM maneuver types that are worth a 3D cutaway. "depart", "arrive",
/// "new name" (road renames with no actual turn), and "continue" are left
/// out — nothing complex is happening at those, so a 3D pop-up would just
/// be noise.
fn is_complex_maneuver(maneuver_type: &str, modifier: &Option<String>) -> bool {
    match maneuver_type {
        "turn" | "roundabout" | "rotary" | "roundabout turn" | "merge" | "fork"
        | "end of road" | "on ramp" | "off ramp" => {
            // A "turn" with modifier "straight" is really just a continuation,
            // not a real decision point — don't trigger 3D for those.
            !(maneuver_type == "turn" && modifier.as_deref() == Some("straight"))
        }
        _ => false,
    }
}

/// Parses lane guidance for a maneuver from OSRM's
/// `steps[].intersections[].lanes`. This is only present on the
/// intersection where the *maneuver actually happens* (the last one in the
/// step's intersections list), and only when the underlying OSM data has
/// lane-level tagging — most steps will have no lane data at all, which is
/// why this returns Option rather than an empty Vec.
fn parse_lanes(step: &serde_json::Value) -> Option<Vec<LaneInfo>> {
    let intersections = step.get("intersections")?.as_array()?;
    let last_intersection = intersections.last()?;
    let lanes_json = last_intersection.get("lanes")?.as_array()?;

    let lanes: Vec<LaneInfo> = lanes_json
        .iter()
        .filter_map(|lane| {
            let indications = lane
                .get("indications")?
                .as_array()?
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            let valid = lane.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);
            Some(LaneInfo { indications, valid, change: None, destination: None })
        })
        .collect();

    if lanes.is_empty() {
        None
    } else {
        Some(lanes)
    }
}

/// Parses an OSRM `/route` response (geometries=geojson, steps=true,
/// alternatives=N) into every candidate route it returned — geometry, turn
/// maneuvers (with lane guidance where available), and summary
/// duration/distance for each.
fn parse_osrm_response(json: &serde_json::Value) -> Option<Vec<Route3DHighlight>> {
    let route_jsons = json.get("routes")?.as_array()?;
    if route_jsons.is_empty() {
        return None;
    }

    let parsed: Vec<Route3DHighlight> = route_jsons.iter().filter_map(parse_single_osrm_route).collect();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn parse_single_osrm_route(route_json: &serde_json::Value) -> Option<Route3DHighlight> {
    let coordinates = route_json.get("geometry")?.get("coordinates")?.as_array()?;

    let coords: Vec<RouteCoord> = coordinates
        .iter()
        .filter_map(|c| {
            let arr = c.as_array()?;
            let lng = arr.get(0)?.as_f64()?;
            let lat = arr.get(1)?.as_f64()?;
            Some(RouteCoord { lat, lng, alt: 0.0 })
        })
        .collect();

    if coords.is_empty() {
        return None;
    }

    let duration_seconds = route_json.get("duration").and_then(|v| v.as_f64());
    let distance_meters = route_json.get("distance").and_then(|v| v.as_f64());

    let mut maneuvers = Vec::new();
    if let Some(legs) = route_json.get("legs").and_then(|l| l.as_array()) {
        for leg in legs {
            let Some(steps) = leg.get("steps").and_then(|s| s.as_array()) else {
                continue;
            };
            for step in steps {
                let Some(m) = step.get("maneuver") else {
                    continue;
                };
                let maneuver_type = m
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();
                let modifier = m
                    .get("modifier")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let Some(loc) = m.get("location").and_then(|l| l.as_array()) else {
                    continue;
                };
                let (Some(lng), Some(lat)) = (
                    loc.get(0).and_then(|v| v.as_f64()),
                    loc.get(1).and_then(|v| v.as_f64()),
                ) else {
                    continue;
                };
                let bearing_before = m
                    .get("bearing_before")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                let instruction = step
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|road| format!("{} onto {}", maneuver_type, road))
                    .unwrap_or_else(|| maneuver_type.clone());

                maneuvers.push(Maneuver {
                    is_complex: is_complex_maneuver(&maneuver_type, &modifier),
                    maneuver_type,
                    modifier,
                    location: Location { lat, lng },
                    bearing_before,
                    instruction,
                    lanes: parse_lanes(step),
                });
            }
        }
    }

    Some(Route3DHighlight {
        provider: Some("osrm".to_string()),
        segments: vec![RouteSegment {
            coords,
            is_highlighted: true,
            color: "#0000FF".to_string(),
            lane_index: None,
        }],
        maneuvers,
        duration_seconds,
        distance_meters,
    })
}

