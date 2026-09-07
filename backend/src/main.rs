use axum::{http::{HeaderName, HeaderValue, StatusCode}, response::Json, routing::get, Router};
use tower_http::set_header::SetResponseHeaderLayer;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use navigation_backend::{config::Config, database::Database, handlers, models, routes, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Load configuration
    dotenv::dotenv().ok();
    let config = Config::from_env()?;

    // Capture configuration values needed after AppState takes ownership.
    let allowed_origin = config.cors_origin.clone();

    // Initialize database
    let db = Database::new(&config.database_url).await?;
    db.run_migrations().await?;

    // Build application state
    let (ws_tx, _) = tokio::sync::broadcast::channel::<models::WsEvent>(1000);
    let app_state = AppState {
        db: Arc::new(db),
        config: Arc::new(config),
        ws_tx: Arc::new(ws_tx),
        scene_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        scene_tiles: Arc::new(navigation_backend::scene_tiles::SceneTileStore::from_env()),
        traffic_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        traffic_vehicles: Arc::new(navigation_backend::traffic_vehicles::TrafficVehicleStore::default()),
        route_requests: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        route_failures: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        traffic_requests: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        traffic_cache_hits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        route_cache: Arc::new(tokio::sync::RwLock::new(std::collections::HashMap::new())),
        http_client: reqwest::Client::builder()
            .pool_max_idle_per_host(16)
            .connect_timeout(std::time::Duration::from_secs(4))
            .timeout(std::time::Duration::from_secs(12))
            .build()?,
    };

    // Periodically release parking reservations whose TTL has elapsed,
    // independent of whether the reserving user's client ever calls the
    // heartbeat endpoint again (e.g. they closed the app). Without this,
    // an abandoned reservation stays hidden from everyone else forever.
    let sweep_state = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            match handlers::sweep_stale_parking_occupancy(&sweep_state).await {
                Ok(released) if released > 0 => {
                    tracing::info!("Auto-checked-out {} stale parking occupant(s)", released);
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::error!("Failed to sweep stale parking occupancy: {}", e);
                }
            }

            // Purge expired reports/billboards so these tables don't grow
            // unbounded. Both cleanup functions already existed in the
            // migration but were never actually invoked anywhere.
            if let Err(e) = sqlx::query("SELECT cleanup_expired_reports()")
                .execute(sweep_state.db.pool())
                .await
            {
                tracing::error!("Failed to clean up expired reports: {}", e);
            }
            if let Err(e) = sqlx::query("SELECT cleanup_expired_billboards()")
                .execute(sweep_state.db.pool())
                .await
            {
                tracing::error!("Failed to clean up expired billboards: {}", e);
            }
        }
    });

    // Build router
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin.parse::<HeaderValue>().map_err(|_| anyhow::anyhow!("Invalid CORS_ORIGIN"))?)
        .allow_methods([axum::http::Method::GET, axum::http::Method::POST, axum::http::Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/ready", get(readiness_check))
        .route("/metrics", get(metrics_check))
        .nest("/api", routes::create_api_router())
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff")
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("referrer-policy"), HeaderValue::from_static("no-referrer")
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY")
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("permissions-policy"), HeaderValue::from_static("geolocation=(self), microphone=(), usb=()")
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-permitted-cross-domain-policies"), HeaderValue::from_static("none")
        ))
        .layer(cors)
        .with_state(app_state);

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Server listening on http://{}", addr);
    // with_connect_info is required for the ConnectInfo<SocketAddr> extractor
    // the rate limiter uses to key limits by peer IP. Note: this is the raw
    // TCP peer address — behind a reverse proxy/load balancer, this would
    // need to read X-Forwarded-For instead to see the real client IP.
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;

    Ok(())
}

async fn health_check() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "streept-backend" }))
}

async fn metrics_check(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<Value> {
    use std::sync::atomic::Ordering;
    Json(json!({
        "service": "streept-backend",
        "route_requests": state.route_requests.load(Ordering::Relaxed),
        "route_failures": state.route_failures.load(Ordering::Relaxed),
        "traffic_requests": state.traffic_requests.load(Ordering::Relaxed),
        "traffic_cache_hits": state.traffic_cache_hits.load(Ordering::Relaxed),
        "route_cache_entries": state.route_cache.read().await.len(),
    }))
}

async fn readiness_check(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<Value>, StatusCode> {
    sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(state.db.pool())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(json!({ "status": "ready", "database": "ok" })))
}
