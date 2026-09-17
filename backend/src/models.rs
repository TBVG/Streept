use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// Parking Models — capacity-based lots, occupancy detected automatically
// (see handlers::checkin_parking/checkout_parking), not manually reserved.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ParkingLot {
    pub id: String,
    pub name: Option<String>,
    pub location: serde_json::Value, // { lat: f64, lng: f64 }
    pub total_spaces: i32,
    pub occupied_spaces: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingCheckinRequest {
    pub lot_id: String,
    pub location: Option<Location>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingHeartbeatRequest {
    pub location: Option<Location>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParkedCar {
    pub id: String,
    pub lot_id: String,
    pub location: Location,
    pub parked_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParkingActionError {
    pub error: String,
    pub message: String,
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
    pub confirmations: i32,
    pub dismissals: i32,
    #[serde(default)]
    pub confidence: Option<f64>,
}

/// Provider-neutral lane-positioned vehicle telemetry.
///
/// This is an observation contract, not a synthetic traffic generator: an
/// external telemetry provider must supply these observations before they are
/// broadcast to clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficVehicleIngestRequest {
    pub vehicles: Vec<TrafficVehicle>,
}

#[derive(Debug, Serialize)]
pub struct TrafficVehicleIngestResponse {
    pub accepted: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficVehicle {
    pub id: String,
    pub location: Location,
    pub way_id: Option<i64>,
    pub segment_id: Option<String>,
    pub lane_index: Option<i32>,
    pub speed_mps: Option<f64>,
    pub heading_degrees: Option<f64>,
    pub observed_at: DateTime<Utc>,
    pub confidence: f64,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateReportRequest {
    #[serde(rename = "type")]
    pub report_type: String,
    pub location: Location,
    pub photo_url: Option<String>,
    pub expires_in_minutes: Option<u64>, // Default to 30 if not provided
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Location {
    pub lat: f64,
    pub lng: f64,
}

impl Location {
    /// Great-circle distance to another point, in meters.
    pub fn distance_meters(&self, other: &Location) -> f64 {
        const EARTH_RADIUS_M: f64 = 6_371_000.0;
        let lat1 = self.lat.to_radians();
        let lat2 = other.lat.to_radians();
        let d_lat = (other.lat - self.lat).to_radians();
        let d_lng = (other.lng - self.lng).to_radians();
        let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lng / 2.0).sin().powi(2);
        2.0 * EARTH_RADIUS_M * h.sqrt().asin()
    }
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
    pub click_count: i32,
    /// "pending" | "approved" | "rejected". A purchase always starts as
    /// "pending" — there's no automated image-moderation here, just a
    /// manual admin approval step (see moderate_billboard). Only
    /// "approved" ads are shown to other users (get_billboards) or
    /// rendered in the 3D pane.
    pub moderation_status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillboardPurchaseRequest {
    pub billboard_id: String,
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

// Spatial Intelligence Models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpatialObservationInput {
    pub id: String,
    pub at: DateTime<Utc>,
    pub observation_type: String,
    pub route_generation: u64,
    pub maneuver_key: Option<String>,
    pub way_id: Option<i64>,
    pub maneuver: String,
    pub lane_alignment: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SpatialObservationBatchRequest {
    pub observations: Vec<SpatialObservationInput>,
}

#[derive(Debug, Serialize)]
pub struct SpatialObservationBatchResponse {
    pub accepted: usize,
}

#[derive(Debug, Serialize)]
pub struct RoadIntelligenceAggregate {
    pub way_id: i64,
    pub observations: i64,
    pub completed: i64,
    pub missed: i64,
    pub lane_misalignments: i64,
    pub hazards: i64,
    pub miss_rate: f64,
    pub lane_misalignment_rate: f64,
    pub hazard_rate: f64,
    pub score: f64,
    pub confidence: f64,
}

#[derive(Debug, Serialize)]
pub struct RoadIntelligenceTemporalBucket {
    pub way_id: i64,
    pub weekday: i32,
    pub hour: i32,
    pub observations: i64,
    pub score: f64,
    pub confidence: f64,
}


// Route Models
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteOptions {
    /// One or more candidate routes, ordered as OSRM returns them (first
    /// is its default/preferred route). The frontend picks one to
    /// actually navigate — nothing here designates a "selected" route,
    /// that's client-side UI state.
    pub routes: Vec<Route3DHighlight>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Route3DHighlight {
    /// Only real OSRM geometry is eligible for navigation.
    pub provider: Option<String>,
    pub segments: Vec<RouteSegment>,
    /// Upcoming turns/junctions worth showing in the 3D pane. This is the
    /// list the frontend watches proximity against to decide when to flip
    /// into split view — not every OSRM maneuver, just the ones a driver
    /// would actually want a 3D look at (turns, roundabouts, merges, forks).
    pub maneuvers: Vec<Maneuver>,
    /// Total route duration, seconds. From OSRM's own estimate (traffic-
    /// unaware — it's based on road speed limits/type, not live
    /// conditions).
    pub duration_seconds: Option<f64>,
    pub distance_meters: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteSegment {
    pub coords: Vec<RouteCoord>,
    pub is_highlighted: bool,
    pub color: String,
    pub lane_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteCoord {
    pub lat: f64,
    pub lng: f64,
    pub alt: f64,
}

/// One lane at an intersection, and whether it's usable for the upcoming
/// maneuver. From OSRM's `intersections[].lanes` — only present when the
/// underlying OSM data has lane-level tagging, which isn't everywhere.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneInfo {
    /// Directions this lane permits, e.g. ["left"], ["through", "right"].
    pub indications: Vec<String>,
    /// Whether this lane actually leads where the route needs to go —
    /// this is the one a driver should actually be in.
    pub valid: bool,
    /// Whether the lane marking allows a move into the adjacent lane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change: Option<String>,
    /// Signed destination/exit information where the routing engine exposes it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
}

/// A single turn-by-turn maneuver, derived from OSRM's `steps[].maneuver`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Maneuver {
    /// OSRM maneuver type: "turn", "roundabout", "merge", "fork",
    /// "end of road", "rotary", "on ramp", "off ramp", "depart", "arrive", etc.
    #[serde(rename = "type")]
    pub maneuver_type: String,
    /// Direction qualifier: "left", "right", "sharp left", "slight right",
    /// "straight", "uturn", etc. Not present for every maneuver type.
    pub modifier: Option<String>,
    pub location: Location,
    /// Compass bearing (0-360) the driver is facing just before reaching
    /// the maneuver — used to orient the 3D camera toward the junction
    /// the way the driver will actually approach it.
    pub bearing_before: f64,
    /// Human-readable instruction text from OSRM, e.g. "Turn left onto Main St".
    pub instruction: String,
    /// Whether this maneuver is complex enough to warrant a 3D cutaway.
    /// False for simple "depart"/"arrive"/"continue straight" steps.
    pub is_complex: bool,
    /// Lane guidance for the intersection just before this maneuver, if
    /// OSRM/the underlying map data provides it. Absent (not just empty)
    /// when there's no lane data, so the frontend can distinguish "no
    /// lane info available" from "any lane works."
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lanes: Option<Vec<LaneInfo>>,
}

// Immersive turn-preview scene data. This is deliberately small and local to
// the upcoming maneuver so the frontend does not need to query public OSM
// infrastructure on every GPS update.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneContext {
    pub buildings: Vec<SceneBuilding>,
    pub roads: Vec<SceneRoad>,
    pub signals: Vec<ScenePoint>,
    pub crossings: Vec<ScenePoint>,
    pub stops: Vec<ScenePoint>,
    pub trees: Vec<ScenePoint>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub street_lamps: Vec<ScenePoint>,
    /// OSM turn-restriction relations near the scene. Kept optional/defaulted
    /// so older pre-generated scene tiles remain wire-compatible.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub restrictions: Vec<SceneRestriction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRestriction {
    pub osm_id: u64,
    /// OSM restriction value, e.g. no_right_turn or only_straight_on.
    pub restriction: String,
    /// Ordered member way IDs tagged role=from.
    #[serde(default)]
    pub from_way_ids: Vec<u64>,
    /// Ordered member way IDs tagged role=to.
    #[serde(default)]
    pub to_way_ids: Vec<u64>,
    /// Via nodes are the simple-junction form we can enforce directly.
    #[serde(default)]
    pub via_node_ids: Vec<u64>,
    /// Via ways are retained for future multi-way restriction matching.
    #[serde(default)]
    pub via_way_ids: Vec<u64>,
    /// Optional OSM `except` modes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub except: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneBuilding {
    pub geometry: Vec<SceneCoord>,
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneRoad {
    /// Stable OSM way identifier retained from scene extraction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osm_id: Option<u64>,
    /// Ordered OSM node IDs corresponding to `geometry`. These anchors let
    /// lane topology connect roads at real shared nodes rather than proximity.
    #[serde(default)]
    pub node_ids: Vec<u64>,
    pub geometry: Vec<SceneCoord>,
    pub highway: Option<String>,
    pub name: Option<String>,
    pub lanes: Option<u32>,
    pub oneway: bool,
    /// OSM oneway=-1 means travel is allowed only in reverse node order.
    #[serde(default)]
    pub oneway_reverse: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub smoothness: Option<String>,
    #[serde(default)]
    pub lit: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maxspeed: Option<String>,
    pub bridge: bool,
    pub tunnel: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_lanes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_lanes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_lanes: Option<Vec<String>>,
    pub toll: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct SceneCoord {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ScenePoint {
    pub lat: f64,
    pub lng: f64,
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

// Real-time WebSocket event types. Broadcast whenever a report or parking
// spot is created/changed/removed by an interactive user action (not by
// the passive background expiry sweep — see websocket.rs for why that's a
// deliberate scope limit for now).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum WsEvent {
    #[serde(rename = "report_created")]
    ReportCreated { report: Report },
    #[serde(rename = "report_updated")]
    ReportUpdated { report: Report },
    #[serde(rename = "report_removed")]
    ReportRemoved { id: String, location: Location },
    #[serde(rename = "parking_updated")]
    ParkingUpdated { parking: ParkingLot },
    #[serde(rename = "parking_car_updated")]
    ParkingCarUpdated { car: ParkedCar },
    #[serde(rename = "parking_car_removed")]
    ParkingCarRemoved { id: String, lot_id: String, location: Location },
    #[serde(rename = "traffic_vehicle_updated")]
    TrafficVehicleUpdated { vehicle: TrafficVehicle },
    #[serde(rename = "traffic_vehicle_removed")]
    TrafficVehicleRemoved { id: String, location: Location },
}

impl WsEvent {
    /// Where this event happened, for geo-filtering which connected
    /// clients actually care about it — no point pushing a report in
    /// Chicago to someone driving in Seattle.
    pub fn location(&self) -> Location {
        match self {
            WsEvent::ReportCreated { report } | WsEvent::ReportUpdated { report } => {
                serde_json::from_value(report.location.clone())
                    .unwrap_or(Location { lat: 0.0, lng: 0.0 })
            }
            WsEvent::ReportRemoved { location, .. } => *location,
            WsEvent::ParkingUpdated { parking } => {
                serde_json::from_value(parking.location.clone())
                    .unwrap_or(Location { lat: 0.0, lng: 0.0 })
            }
            WsEvent::ParkingCarUpdated { car } => car.location,
            WsEvent::ParkingCarRemoved { location, .. } => *location,
            WsEvent::TrafficVehicleUpdated { vehicle } => vehicle.location,
            WsEvent::TrafficVehicleRemoved { location, .. } => *location,
        }
    }
}

// Auth Models

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(skip_serializing)] // never send the hash back to a client
    pub password_hash: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthErrorBody {
    pub error: String,
    pub message: String,
}

/// JWT payload. `sub` is the user id (matches the `id` used throughout the
/// rest of the app — parking.occupied_by, reports.reporter_id, etc.).
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub is_admin: bool,
    pub exp: usize,
}
