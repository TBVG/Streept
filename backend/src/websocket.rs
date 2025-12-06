use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tracing::info;

pub async fn handle_websocket(socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();

    // Send initial connection message
    let _ = sender.send(Message::Text("Connected".to_string())).await;

    // Handle incoming messages
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("Received: {}", text);
                // Echo back for now
                let _ = sender.send(Message::Text(text)).await;
            }
            Ok(Message::Close(_)) => {
                info!("WebSocket closed");
                break;
            }
            _ => {}
        }
    }
}

