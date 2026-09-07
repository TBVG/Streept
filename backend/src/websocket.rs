use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tracing::{info, warn};

use crate::models::Location;
use crate::AppState;

// How close an event needs to be to a client's last-known location to be
// worth forwarding to them — matches the default radius used by the
// equivalent REST endpoints (get_reports/get_parking), so "what you'd see
// on next poll" and "what gets pushed to you live" stay consistent.
const SUBSCRIBE_RADIUS_METERS: f64 = 1000.0;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    /// Sent by the frontend whenever the driver's position updates
    /// meaningfully, so the server knows what "nearby" means for this
    /// connection. Without this, every connected client would get every
    /// event globally — fine for a demo, not for a real deployment.
    Subscribe { lat: f64, lng: f64 },
}

pub async fn handle_websocket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();

    // No location yet — until the client sends a `subscribe` message, we
    // don't forward anything (rather than guessing, or flooding them with
    // every event everywhere).
    let mut client_location: Option<Location> = None;

    let _ = sender.send(Message::Text("Connected".to_string())).await;

    loop {
        tokio::select! {
            // Broadcast events flowing out to this client.
            event = rx.recv() => {
                match event {
                    Ok(event) => {
                        let Some(loc) = client_location else { continue };
                        if loc.distance_meters(&event.location()) > SUBSCRIBE_RADIUS_METERS {
                            continue;
                        }
                        match serde_json::to_string(&event) {
                            Ok(json) => {
                                if sender.send(Message::Text(json)).await.is_err() {
                                    break; // client disconnected
                                }
                            }
                            Err(e) => warn!("Failed to serialize WsEvent: {}", e),
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        // This connection fell behind the broadcast channel's
                        // buffer and missed some events. Not fatal — the
                        // client's own polling (loadNearbyData) is the
                        // source of truth on reconnect/refresh; this just
                        // means a brief gap in live updates.
                        warn!("WebSocket client lagged, skipped {} events", skipped);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // Messages coming in from the client.
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ClientMessage>(&text) {
                            Ok(ClientMessage::Subscribe { lat, lng }) => {
                                client_location = Some(Location { lat, lng });
                            }
                            Err(e) => warn!("Unrecognized WebSocket client message: {}", e),
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("WebSocket closed");
                        break;
                    }
                    Some(Err(e)) => {
                        warn!("WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}


