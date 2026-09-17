use axum::{extract::Query, http::StatusCode, response::Json};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

use crate::models::{ApiResponse, Location};

// Search-as-you-type is handled by Photon, which is specifically designed for
// fast autocomplete. Results are cached so repeated typing/queries do not
// repeatedly hit public services.
const CACHE_TTL: Duration = Duration::from_secs(300);
const PHOTON_TIMEOUT: Duration = Duration::from_secs(5);

fn cache() -> &'static Mutex<HashMap<String, (Instant, Vec<GeocodeResult>)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<GeocodeResult>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeocodeResult {
    pub display_name: String,
    pub location: Location,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GeocodeQuery {
    pub q: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct PhotonResponse {
    features: Vec<PhotonFeature>,
}

#[derive(Debug, Deserialize)]
struct PhotonFeature {
    geometry: PhotonGeometry,
    properties: PhotonProperties,
}

#[derive(Debug, Deserialize)]
struct PhotonGeometry {
    coordinates: Vec<f64>,
}

#[derive(Debug, Deserialize)]
struct PhotonProperties {
    name: Option<String>,
    street: Option<String>,
    housenumber: Option<String>,
    postcode: Option<String>,
    city: Option<String>,
    district: Option<String>,
    state: Option<String>,
    country: Option<String>,
    osm_key: Option<String>,
    osm_value: Option<String>,
    r#type: Option<String>,
}

fn photon_display_name(p: &PhotonProperties) -> Option<String> {
    let primary = p.name.as_deref().or(p.street.as_deref())?;
    let mut parts = vec![primary.to_string()];
    if let Some(h) = &p.housenumber { if p.name.is_some() { parts.push(h.clone()); } }
    for value in [&p.district, &p.city, &p.state, &p.country] {
        if let Some(v) = value { if !v.is_empty() && !parts.iter().any(|x| x == v) { parts.push(v.clone()); } }
    }
    if let Some(postcode) = &p.postcode { if !parts.iter().any(|x| x == postcode) { parts.push(postcode.clone()); } }
    Some(parts.join(", "))
}

async fn photon_search(query: &str, lat: Option<f64>, lng: Option<f64>) -> Result<Vec<GeocodeResult>, ()> {
    let client = reqwest::Client::builder().timeout(PHOTON_TIMEOUT).build().map_err(|_| ())?;

    // Photon supports location bias, but a very strong/poorly chosen bias can
    // make a globally famous destination disappear when the driver is far
    // away. Run a lightly biased query plus an un-biased query and merge the
    // results. This keeps "Times Square" discoverable from anywhere while
    // still putting nearby places first.
    let mut queries: Vec<Vec<(&str, String)>> = Vec::new();
    let mut biased = vec![
        ("q", query.to_string()),
        ("limit", "8".to_string()),
        ("lang", "en".to_string()),
    ];
    if let (Some(lat), Some(lng)) = (lat, lng) {
        biased.push(("lat", lat.to_string()));
        biased.push(("lon", lng.to_string()));
        biased.push(("zoom", "10".to_string()));
        biased.push(("location_bias_scale", "0.15".to_string()));
    }
    queries.push(biased);

    // Always keep one global query as a fallback. This is especially
    // important for destination searches where the requested place can be
    // thousands of kilometres from the current GPS fix.
    queries.push(vec![
        ("q", query.to_string()),
        ("limit", "8".to_string()),
        ("lang", "en".to_string()),
    ]);

    let mut merged = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for params in queries {
        let response = client
            .get("https://photon.komoot.io/api")
            .query(&params)
            .header("User-Agent", "Streept/0.1 (+https://streept.app)")
            .send().await.map_err(|_| ())?;
        if !response.status().is_success() { continue; }

        let payload: PhotonResponse = response.json().await.map_err(|_| ())?;
        for f in payload.features {
            if f.geometry.coordinates.len() < 2 { continue; }
            let lng = f.geometry.coordinates[0];
            let lat = f.geometry.coordinates[1];
            if !lat.is_finite() || !lng.is_finite() { continue; }
            let Some(display_name) = photon_display_name(&f.properties) else { continue; };
            let key = format!("{display_name}|{lat:.5}|{lng:.5}");
            if seen.insert(key) {
                merged.push(GeocodeResult {
                    display_name,
                    location: Location { lat, lng },
                    category: f.properties.osm_value.clone().or_else(|| f.properties.osm_key.clone()),
                    r#type: f.properties.r#type.clone(),
                });
            }
            if merged.len() >= 8 { return Ok(merged); }
        }
    }

    Ok(merged)
}

pub async fn geocode_search(
    Query(params): Query<GeocodeQuery>,
) -> Result<Json<ApiResponse<Vec<GeocodeResult>>>, StatusCode> {
    let query = params.q.trim();
    if query.len() < 2 { return Ok(Json(ApiResponse::success(vec![]))); }
    let cache_key = format!("{}|{}|{}", query.to_lowercase(), params.lat.map(|v| format!("{v:.3}")).unwrap_or_default(), params.lng.map(|v| format!("{v:.3}")).unwrap_or_default());

    if let Some((cached_at, results)) = cache().lock().unwrap_or_else(|p| p.into_inner()).get(&cache_key) {
        if cached_at.elapsed() < CACHE_TTL { return Ok(Json(ApiResponse::success(results.clone()))); }
    }

    let results = match photon_search(query, params.lat, params.lng).await {
        Ok(results) => results,
        Err(_) => return Err(StatusCode::BAD_GATEWAY),
    };

    cache().lock().unwrap_or_else(|p| p.into_inner()).insert(cache_key, (Instant::now(), results.clone()));
    Ok(Json(ApiResponse::success(results)))
}
