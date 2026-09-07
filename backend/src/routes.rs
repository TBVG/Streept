use axum::{
    extract::{ws::WebSocketUpgrade, State},
    middleware::from_fn,
    routing::{get, post},
    Router,
};

use crate::geocode;
use crate::handlers;
use crate::rate_limit;
use crate::websocket;
use crate::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        .route(
            "/auth/register",
            post(handlers::register).layer(from_fn(rate_limit::limit_register)),
        )
        .route(
            "/auth/login",
            post(handlers::login).layer(from_fn(rate_limit::limit_login)),
        )
        .route("/geocode", get(geocode::geocode_search).layer(from_fn(rate_limit::limit_geocode)))
        .route("/parking", get(handlers::get_parking))
        .route("/parking/cars", get(handlers::get_parked_cars))
        .route("/traffic", get(handlers::get_live_traffic))
        .route("/traffic/vehicles", get(handlers::get_live_traffic_vehicles))
        .route("/traffic/vehicles/ingest", post(handlers::ingest_live_traffic_vehicles))
        .route("/offline/plan", get(handlers::get_offline_plan))
        .route("/scene-context", get(handlers::get_scene_context))
        .route("/scene-tile", get(handlers::get_scene_tile))
        .route(
            "/parking/checkin",
            post(handlers::checkin_parking).layer(from_fn(rate_limit::limit_parking_reserve)),
        )
        .route("/parking/heartbeat", post(handlers::parking_heartbeat))
        .route("/parking/checkout", post(handlers::checkout_parking))
        .route("/reports", get(handlers::get_reports))
        .route(
            "/reports",
            post(handlers::create_report).layer(from_fn(rate_limit::limit_report_creation)),
        )
        .route(
            "/reports/:id/confirm",
            post(handlers::confirm_report).layer(from_fn(rate_limit::limit_report_vote)),
        )
        .route(
            "/reports/:id/dismiss",
            post(handlers::dismiss_report).layer(from_fn(rate_limit::limit_report_vote)),
        )
        .route("/billboards", get(handlers::get_billboards))
        .route(
            "/billboards/:id/purchase",
            post(handlers::purchase_billboard).layer(from_fn(rate_limit::limit_billboard_purchase)),
        )
        .route("/billboards/:id/click", post(handlers::click_billboard))
        .route("/billboards/:id/moderate", post(handlers::moderate_billboard))
        .route("/route", get(handlers::get_route))
        .route("/ws", get(handle_websocket_upgrade))
}

async fn handle_websocket_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> axum::response::Response {
    ws.on_upgrade(move |socket| websocket::handle_websocket(socket, state))
}

