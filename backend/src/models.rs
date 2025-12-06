use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// Parking Models
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ParkingSpace {
    pub id: String,
    pub location: serde_json::Value, // { lat: f64, lng: f64 }
    pub is_available: bool,
    pub occupied_by: Option<String>,
    pub occupied_at: Option<DateTime<Utc>>,
    pub photo_url: Option<String>,
    pub pending: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingReservationRequest {
    pub parking_id: String,
    pub user_id: String,
    pub photo_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingReservationResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<ParkingSpace>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ParkingReservationError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingReservationError {
    pub error: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingHeartbeatRequest {
    pub parking_id: String,
    pub user_id: String,
}

// Report Models
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Report {
    pub id: String,
    #[serde(rename = "type")]
    pub report_type: String, // "cop", "hazard", "construction", "accident", "traffic_jam", "closed_lane"
    pub location: serde_json::Value, // { lat: f64, lng: f64 }
    pub photo_url: Option<String>,
    pub reported_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub reporter_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateReportRequest {
    #[serde(rename = "type")]
    pub report_type: String,
    pub location: Location,
    pub photo_url: Option<String>,
    pub expires_in_minutes: Option<u64>, // Default to 30 if not provided
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Location {
    pub lat: f64,
    pub lng: f64,
}

// Billboard Models
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Billboard {
    pub id: String,
    pub location: serde_json::Value, // { lat: f64, lng: f64 }
    pub is_purchased: bool,
    pub purchased_by: Option<String>,
    pub ad_image_url: Option<String>,
    pub ad_target_url: Option<String>,
    pub display_start: Option<DateTime<Utc>>,
    pub display_end: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillboardPurchaseRequest {
    pub billboard_id: String,
    pub user_id: String,
    pub ad_image_url: String,
    pub ad_target_url: String,
    pub display_start: DateTime<Utc>,
    pub display_end: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillboardPurchaseResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Billboard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<BillboardPurchaseError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillboardPurchaseError {
    pub error: String,
    pub message: String,
}

// Route Models
#[derive(Debug, Serialize, Deserialize)]
pub struct RouteRequest {
    pub from: Location,
    pub to: Location,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Route3DHighlight {
    pub segments: Vec<RouteSegment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteSegment {
    pub coords: Vec<RouteCoord>,
    pub is_highlighted: bool,
    pub color: String,
    pub lane_index: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteCoord {
    pub lat: f64,
    pub lng: f64,
    pub alt: f64,
}

// Generic API Response
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<serde_json::Value>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(error: serde_json::Value) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

