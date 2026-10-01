//! Rust-first navigation decision engine.
//!
//! The browser remains responsible for rendering and interaction, but route
//! risk, route scoring, and explainable route choice live here so the core
//! navigation decisions have one deterministic implementation.

use serde::{Deserialize, Serialize};

use crate::models::{Location, Maneuver, Route3DHighlight};


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationAnalysisRequest {
    pub routes: Vec<Route3DHighlight>,
    #[serde(default)]
    pub reports: Vec<NavigationReport>,
    #[serde(default)]
    pub way_ids_by_route: Vec<Vec<i64>>,
    #[serde(default)]
    pub community: Vec<RoadIntelligenceInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationReport {
    #[serde(rename = "type")]
    pub report_type: String,
    pub location: Location,
    pub reported_at: String,
    pub expires_at: String,
    #[serde(default)]
    pub confirmations: i32,
    #[serde(default)]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadIntelligenceInput {
    pub way_id: i64,
    pub observations: i64,
    pub score: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDecisionProfile {
    pub route_index: usize,
    pub base_score: f64,
    pub learned_difficulty: f64,
    pub learned_confidence: f64,
    pub difficult_roads: usize,
    pub high_attention_roads: usize,
    pub maneuver_complexity: f64,
    pub recommendation_score: f64,
    pub reason: String,
    pub way_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationAnalysisResponse {
    pub routes: Vec<Route3DHighlight>,
    pub profiles: Vec<RouteDecisionProfile>,
    pub ranked_indices: Vec<usize>,
}

const HIGH_RISK_CLOSED_LANE: f64 = 90.0;
const HIGH_RISK_ACCIDENT: f64 = 75.0;
const HIGH_RISK_CONSTRUCTION: f64 = 55.0;
const HIGH_RISK_TRAFFIC_JAM: f64 = 45.0;
const HIGH_RISK_HAZARD: f64 = 35.0;
const HIGH_RISK_COP: f64 = 5.0;

fn clamp(value: f64, min: f64, max: f64) -> f64 { value.max(min).min(max) }

fn risk_for(report_type: &str) -> f64 {
    match report_type {
        "closed_lane" => HIGH_RISK_CLOSED_LANE,
        "accident" => HIGH_RISK_ACCIDENT,
        "construction" => HIGH_RISK_CONSTRUCTION,
        "traffic_jam" => HIGH_RISK_TRAFFIC_JAM,
        "hazard" => HIGH_RISK_HAZARD,
        "cop" => HIGH_RISK_COP,
        _ => 0.0,
    }
}

fn parse_time(value: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(value).ok().map(|v| v.with_timezone(&chrono::Utc))
}

fn hazard_penalty(route: &Route3DHighlight, reports: &[NavigationReport]) -> f64 {
    let points = route.segments.iter().flat_map(|segment| {
        segment.coords.iter().map(|point| Location { lat: point.lat, lng: point.lng })
    }).collect::<Vec<_>>();
    if points.len() < 2 { return 0.0; }

    let now = chrono::Utc::now();
    let mut penalty = 0.0;
    for report in reports {
        let Some(reported_at) = parse_time(&report.reported_at) else { continue };
        let Some(expires_at) = parse_time(&report.expires_at) else { continue };
        let ttl = (expires_at - reported_at).num_milliseconds() as f64;
        let age = (now - reported_at).num_milliseconds() as f64;
        let freshness = if ttl > 0.0 { clamp(1.0 - age / ttl, 0.0, 1.0) } else { 0.2 };
        if freshness <= 0.0 { continue; }
        let Some(distance) = super::geometry::point_to_polyline_distance_meters(&report.location, &points) else { continue };
        if distance > 80.0 { continue; }
        let proximity = clamp(1.0 - distance / 80.0, 0.0, 1.0);
        let confirmation_boost = 1.0 + clamp(report.confirmations.max(0) as f64 * 0.04, 0.0, 0.5);
        let confidence = clamp(report.confidence.unwrap_or(0.55), 0.25, 1.0);
        penalty += risk_for(&report.report_type) * freshness * proximity * confirmation_boost * confidence;
    }
    penalty
}

fn score_route(route: &Route3DHighlight, reports: &[NavigationReport]) -> f64 {
    let time = route.duration_seconds.unwrap_or(3600.0);
    let distance = route.distance_meters.unwrap_or(100_000.0);
    let complex = route.maneuvers.iter().filter(|m| m.is_complex).count() as f64;
    let turns = route.maneuvers.len() as f64;
    time + distance * 0.035 + turns * 4.0 + complex * 10.0 + hazard_penalty(route, reports) * 1.4
}

fn maneuver_complexity(maneuvers: &[Maneuver]) -> f64 {
    clamp(
        maneuvers.len() as f64 * 4.0 + maneuvers.iter().filter(|m| m.is_complex).count() as f64 * 12.0,
        0.0,
        100.0,
    )
}

fn learned_difficulty(way_ids: &[i64], community: &[RoadIntelligenceInput]) -> (f64, f64, usize, usize) {
    let mut weighted = 0.0;
    let mut weight = 0.0;
    let mut difficult = 0usize;
    let mut high_attention = 0usize;

    for way_id in way_ids {
        let Some(item) = community.iter().find(|candidate| candidate.way_id == *way_id) else { continue };
        if item.observations <= 0 || item.confidence <= 0.0 { continue; }
        let confidence = clamp(item.confidence, 0.0, 1.0);
        let evidence = clamp(item.observations as f64 / 12.0, 0.0, 1.0);
        let w = confidence * (0.35 + evidence * 0.65);
        weighted += clamp(item.score, 0.0, 100.0) * w;
        weight += w;
        if item.score >= 70.0 && confidence >= 0.45 { difficult += 1; }
        if item.score >= 85.0 && confidence >= 0.65 { high_attention += 1; }
    }

    let score = if weight > 0.0 { weighted / weight } else { 0.0 };
    let confidence = clamp(weight / (way_ids.len().max(1) as f64 * 0.75), 0.0, 1.0);
    (score, confidence, difficult, high_attention)
}

pub fn analyze(request: NavigationAnalysisRequest) -> NavigationAnalysisResponse {
    let profiles = request.routes.iter().enumerate().map(|(route_index, route)| {
        let way_ids = request.way_ids_by_route.get(route_index).cloned().unwrap_or_default();
        let (learned_score, learned_confidence, difficult, high_attention) = learned_difficulty(&way_ids, &request.community);
        let complexity = maneuver_complexity(&route.maneuvers);
        let base = score_route(route, &request.reports);
        let learned_penalty = learned_score * (0.35 + learned_confidence * 0.65);
        let recommendation_score = base + learned_penalty * 0.9 + complexity * 0.7;
        let reason = if high_attention > 0 {
            format!("{} learned high-attention road{} ahead", high_attention, if high_attention == 1 { "" } else { "s" })
        } else if difficult > 0 {
            format!("{} learned difficult road{} ahead", difficult, if difficult == 1 { "" } else { "s" })
        } else if complexity >= 30.0 {
            "Higher maneuver complexity".to_string()
        } else {
            "Fast, straightforward route".to_string()
        };
        RouteDecisionProfile {
            route_index,
            base_score: base,
            learned_difficulty: learned_score.round(),
            learned_confidence,
            difficult_roads: difficult,
            high_attention_roads: high_attention,
            maneuver_complexity: complexity.round(),
            recommendation_score,
            reason,
            way_ids,
        }
    }).collect::<Vec<_>>();

    let mut ranked_indices = (0..profiles.len()).collect::<Vec<_>>();
    ranked_indices.sort_by(|a, b| {
        profiles[*a].recommendation_score.partial_cmp(&profiles[*b].recommendation_score).unwrap_or(std::cmp::Ordering::Equal)
    });

    let routes = ranked_indices.iter().map(|index| request.routes[*index].clone()).collect();
    let ranked_profiles = ranked_indices.iter().map(|index| profiles[*index].clone()).collect();
    NavigationAnalysisResponse { routes, profiles: ranked_profiles, ranked_indices }
}
