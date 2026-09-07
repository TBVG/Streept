use std::{collections::HashMap, time::{Duration, Instant}};
use tokio::sync::RwLock;

use crate::{models::TrafficVehicle, AppState};

const DEFAULT_TTL: Duration = Duration::from_secs(20);
const MAX_VEHICLES: usize = 2000;

#[derive(Clone)]
struct Entry {
    vehicle: TrafficVehicle,
    received_at: Instant,
}

/// In-memory convergence store for observations supplied by a real traffic
/// telemetry adapter. It deliberately has no simulation or random vehicle
/// generation path.
#[derive(Default)]
pub struct TrafficVehicleStore {
    entries: RwLock<HashMap<String, Entry>>,
}

impl TrafficVehicleStore {
    pub async fn upsert(&self, vehicle: TrafficVehicle, now: Instant) {
        let mut entries = self.entries.write().await;
        if entries.len() >= MAX_VEHICLES && !entries.contains_key(&vehicle.id) {
            if let Some(oldest) = entries.iter().min_by_key(|(_, e)| e.received_at).map(|(id, _)| id.clone()) {
                entries.remove(&oldest);
            }
        }
        entries.insert(vehicle.id.clone(), Entry { vehicle, received_at: now });
    }

    pub async fn remove(&self, id: &str) -> Option<TrafficVehicle> {
        self.entries.write().await.remove(id).map(|entry| entry.vehicle)
    }

    pub async fn nearby(&self, location: crate::models::Location, radius_meters: f64, now: Instant) -> Vec<TrafficVehicle> {
        self.prune(now).await;
        let entries = self.entries.read().await;
        entries.values()
            .filter(|entry| entry.vehicle.location.distance_meters(&location) <= radius_meters)
            .map(|entry| entry.vehicle.clone())
            .collect()
    }

    async fn prune(&self, now: Instant) {
        let mut entries = self.entries.write().await;
        entries.retain(|_, entry| now.duration_since(entry.received_at) <= DEFAULT_TTL);
    }
}

/// Adapter entry point for a real telemetry provider. The provider owns the
/// source of truth; this function only stores and broadcasts its observation.
pub async fn ingest_vehicle(state: &AppState, vehicle: TrafficVehicle) {
    state.traffic_vehicles.upsert(vehicle.clone(), Instant::now()).await;
    let _ = state.ws_tx.send(crate::models::WsEvent::TrafficVehicleUpdated { vehicle });
}

pub async fn remove_vehicle(state: &AppState, id: String, location: crate::models::Location) {
    state.traffic_vehicles.remove(&id).await;
    let _ = state.ws_tx.send(crate::models::WsEvent::TrafficVehicleRemoved { id, location });
}
