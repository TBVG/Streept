use std::{collections::HashMap, sync::{Arc, atomic::AtomicU64}, time::Instant};

pub mod auth;
pub mod config;
pub mod database;
pub mod geocode;
pub mod handlers;
pub mod models;
pub mod rate_limit;
pub mod routes;
pub mod scene_tiles;
pub mod websocket;
pub mod traffic_vehicles;

use config::Config;
use database::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub config: Arc<Config>,
    /// Broadcast channel for real-time report/parking events. Every
    /// connected WebSocket subscribes to this and geo-filters what it
    /// forwards to its own client (see websocket.rs).
    pub ws_tx: Arc<tokio::sync::broadcast::Sender<models::WsEvent>>,
    /// Short-lived server cache for maneuver-local OSM geometry.
    pub scene_cache: Arc<tokio::sync::RwLock<HashMap<String, (Instant, models::SceneContext)>>>,
    pub scene_tiles: Arc<scene_tiles::SceneTileStore>,
    pub traffic_cache: Arc<tokio::sync::RwLock<HashMap<String, (Instant, Vec<models::Report>)>>>,
    /// Provider-neutral live vehicle telemetry. Empty until a real telemetry
    /// adapter publishes observations; no synthetic vehicles are generated.
    pub traffic_vehicles: Arc<traffic_vehicles::TrafficVehicleStore>,
    pub route_requests: Arc<AtomicU64>,
    pub route_failures: Arc<AtomicU64>,
    pub traffic_requests: Arc<AtomicU64>,
    pub traffic_cache_hits: Arc<AtomicU64>,
    pub route_cache: Arc<tokio::sync::RwLock<HashMap<String, (Instant, models::RouteOptions)>>>,
    pub http_client: reqwest::Client,
}

impl AppState {
    /// Builds an AppState around an already-connected pool, without going
    /// through Database::new()'s own connection setup. Primarily for
    /// tests (e.g. #[sqlx::test] hands you a ready-made PgPool for an
    /// isolated, freshly-migrated test database) and other embedders that
    /// already have a pool.
    pub fn from_pool_for_test(pool: sqlx::PgPool, config: Config) -> Self {
        let (ws_tx, _) = tokio::sync::broadcast::channel::<models::WsEvent>(1000);
        AppState {
            db: Arc::new(Database::from_pool(pool)),
            config: Arc::new(config),
            ws_tx: Arc::new(ws_tx),
            scene_cache: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            scene_tiles: Arc::new(scene_tiles::SceneTileStore::from_env()),
            traffic_cache: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            traffic_vehicles: Arc::new(traffic_vehicles::TrafficVehicleStore::default()),
            route_requests: Arc::new(AtomicU64::new(0)),
            route_failures: Arc::new(AtomicU64::new(0)),
            traffic_requests: Arc::new(AtomicU64::new(0)),
            traffic_cache_hits: Arc::new(AtomicU64::new(0)),
            route_cache: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
            http_client: reqwest::Client::new(),
        }
    }
}
