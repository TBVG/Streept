use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};

use serde::{Deserialize, Serialize};

use crate::models::SceneContext;

/// A deterministic, server-side scene tile.  The file format is intentionally
/// simple so an offline OSM extraction pipeline can generate it without
/// coupling the runtime API to Overpass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneTile {
    pub id: String,
    pub center_lat: f64,
    pub center_lng: f64,
    pub radius_m: f64,
    pub scene: SceneContext,
}

#[derive(Debug, Clone)]
pub struct SceneTileStore {
    tiles: Arc<HashMap<String, SceneContext>>,
}

impl SceneTileStore {
    pub fn from_env() -> Self {
        let path = std::env::var("STREEPT_SCENE_TILES_FILE").ok().map(PathBuf::from);
        Self::from_path(path)
    }

    pub fn from_path(path: Option<PathBuf>) -> Self {
        let Some(path) = path else {
            return Self { tiles: Arc::new(HashMap::new()) };
        };

        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) => {
                tracing::warn!(path = %path.display(), error = %err, "scene tile file unavailable; runtime fallback will be used");
                return Self { tiles: Arc::new(HashMap::new()) };
            }
        };

        let parsed: Vec<SceneTile> = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(path = %path.display(), error = %err, "scene tile file invalid; runtime fallback will be used");
                return Self { tiles: Arc::new(HashMap::new()) };
            }
        };

        let mut tiles = HashMap::with_capacity(parsed.len());
        for tile in parsed {
            if tile.id.is_empty() || !tile.center_lat.is_finite() || !tile.center_lng.is_finite() {
                continue;
            }
            tiles.insert(tile.id, tile.scene);
        }
        tracing::info!(count = tiles.len(), path = %path.display(), "loaded server-side scene tiles");
        Self { tiles: Arc::new(tiles) }
    }

    pub fn get(&self, id: &str) -> Option<SceneContext> {
        self.tiles.get(id).cloned()
    }

    pub fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }
}

/// Web-Mercator tile address used only as a stable cache/source key.
pub fn tile_id(lat: f64, lng: f64, zoom: u8) -> Option<String> {
    if !lat.is_finite() || !lng.is_finite() || lat.abs() > 90.0 || lng.abs() > 180.0 || zoom > 22 {
        return None;
    }
    let n = 2_f64.powi(i32::from(zoom));
    let x = ((lng + 180.0) / 360.0 * n).floor().clamp(0.0, n - 1.0) as u32;
    let lat_rad = lat.to_radians();
    let y_float = (1.0 - (lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / std::f64::consts::PI) / 2.0 * n;
    let y = y_float.floor().clamp(0.0, n - 1.0) as u32;
    Some(format!("{}/{}/{}", zoom, x, y))
}
