use axum::{
    extract::ws::WebSocketUpgrade,
    routing::{get, post},
    Router,
};

use crate::handlers;
use crate::websocket;
use crate::AppState;

pub fn create_api_router() -> Router<AppState> {
    Router::new()
        .route("/parking", get(handlers::get_parking))
        .route("/parking/reserve", post(handlers::reserve_parking))
        .route("/parking/heartbeat", post(handlers::parking_heartbeat))
        .route("/reports", get(handlers::get_reports))
        .route("/reports", post(handlers::create_report))
        .route("/billboards", get(handlers::get_billboards))
        .route("/billboards/:id/purchase", post(handlers::purchase_billboard))
        .route("/route", get(handlers::get_route))
        .route("/ws", get(handle_websocket_upgrade))
}

async fn handle_websocket_upgrade(
    ws: WebSocketUpgrade,
) -> axum::response::Response {
    ws.on_upgrade(websocket::handle_websocket)
}

