//! Rust-owned spatial navigation decision runtime.
//!
//! This module is deliberately renderer-agnostic. It accepts the current
//! navigation evidence and returns the physical context, guidance policy and
//! driver-facing decision. React/Cesium/Leaflet do not participate in these
//! decisions.

use serde::{Deserialize, Serialize};

use crate::models::{Location, Maneuver, Route3DHighlight, SceneContext, SceneRoad};
use super::geometry::point_to_polyline_distance_meters;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationDecisionRequest {
    pub location: Option<Location>,
    pub route: Option<Route3DHighlight>,
    pub scene: Option<SceneContext>,
    pub current_way_id: Option<i64>,
    pub current_lane_index: Option<i32>,
    #[serde(default)]
    pub reports: Vec<NavigationReportInput>,
    #[serde(default)]
    pub traffic_vehicles: Vec<TrafficVehicleInput>,
    pub speed_mps: Option<f64>,
    #[serde(default)]
    pub route_reacquire: bool,
    #[serde(default)]
    pub restriction_prohibited: bool,
    #[serde(default)]
    pub restriction_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationReportInput {
    pub location: Location,
    #[serde(rename = "type")]
    pub report_type: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrafficVehicleInput {
    pub location: Location,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustHazardIntelligence {
    pub level: String,
    pub nearby_critical_reports: usize,
    pub nearby_traffic_jams: usize,
    pub nearby_closed_lanes: usize,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustLaneIntelligence {
    pub current_lane_index: Option<i32>,
    pub recommended_lane_indices: Vec<i32>,
    pub lane_alignment: String,
    pub lane_change_direction: String,
    pub required_lane_changes: i32,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustIntersectionIntelligence {
    pub complexity: String,
    pub preparation_distance_meters: f64,
    pub confidence: f64,
    pub behavior: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustSpatialIntelligence {
    pub road_class: String,
    pub road_name: Option<String>,
    pub way_id: Option<i64>,
    pub lane_count: Option<i32>,
    pub one_way: Option<bool>,
    pub speed_limit_kph: Option<f64>,
    pub maneuver: String,
    pub maneuver_distance_meters: Option<f64>,
    pub next_maneuver: Option<Maneuver>,
    pub nearby_signals: usize,
    pub nearby_crossings: usize,
    pub nearby_stops: usize,
    pub nearby_reports: usize,
    pub nearby_traffic_vehicles: usize,
    pub hazard_intelligence: RustHazardIntelligence,
    pub lane_intelligence: RustLaneIntelligence,
    pub intersection_intelligence: RustIntersectionIntelligence,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustSpatialGuidance {
    pub action: String,
    pub confidence: f64,
    pub priority: String,
    pub reason: String,
    pub target_speed_mps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RustDriverDecision {
    pub action: String,
    pub priority: String,
    pub confidence: f64,
    pub reason: String,
    pub target_speed_mps: Option<f64>,
    pub lane_change_direction: String,
    pub target_lane_index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationDecisionResponse {
    pub spatial_intelligence: RustSpatialIntelligence,
    pub spatial_guidance: RustSpatialGuidance,
    pub driver_decision: RustDriverDecision,
}

fn clamp01(value: f64) -> f64 { value.max(0.0).min(1.0) }

fn classify_road(highway: Option<&str>) -> &'static str {
    match highway {
        Some("motorway" | "motorway_link" | "trunk" | "trunk_link") => "highway",
        Some("primary" | "primary_link" | "secondary" | "secondary_link" | "tertiary" | "tertiary_link") => "arterial",
        Some(_) => "local",
        None => "unknown",
    }
}

fn parse_speed(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    let mut number = String::new();
    let mut seen = false;
    for ch in value.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            number.push(ch);
            seen = true;
        } else if seen { break; }
    }
    let mut speed = number.parse::<f64>().ok()?;
    if value.to_ascii_lowercase().contains("mph") { speed *= 1.609344; }
    if speed > 0.0 { Some(speed) } else { None }
}

fn route_polyline(route: &Route3DHighlight) -> Vec<Location> {
    route.segments.iter().flat_map(|segment| segment.coords.iter().map(|point| Location { lat: point.lat, lng: point.lng })).collect()
}

fn next_maneuver(route: Option<&Route3DHighlight>, location: Location) -> Option<(Maneuver, f64)> {
    let route = route?;
    let polyline = route_polyline(route);
    if polyline.len() < 2 || route.maneuvers.is_empty() { return None; }
    let current = super::geometry::project_onto_polyline(&location, &polyline)?;
    let mut best: Option<(usize, Maneuver, f64)> = None;
    for (index, maneuver) in route.maneuvers.iter().enumerate() {
        let projection = super::geometry::project_onto_polyline(&maneuver.location, &polyline);
        let Some(projection) = projection else { continue; };
        let delta = projection.distance_along_meters - current.distance_along_meters;
        if delta < -18.0 { continue; }
        if best.as_ref().map(|(_, _, distance)| delta < *distance).unwrap_or(true) {
            best = Some((index, maneuver.clone(), delta.max(0.0)));
        }
    }
    best.map(|(_, maneuver, distance)| (maneuver, distance))
}

fn nearest_road(location: Location, roads: &[SceneRoad]) -> Option<SceneRoad> {
    let mut best: Option<(SceneRoad, f64)> = None;
    for road in roads {
        let points = road.geometry.iter().map(|point| Location { lat: point.lat, lng: point.lng }).collect::<Vec<_>>();
        if points.len() < 2 { continue; }
        let distance = point_to_polyline_distance_meters(&location, &points).unwrap_or(f64::INFINITY);
        if best.as_ref().map(|(_, current)| distance < *current).unwrap_or(true) {
            best = Some((road.clone(), distance));
        }
    }
    best.map(|(road, _)| road)
}

fn maneuver_context(maneuver: Option<&Maneuver>) -> &'static str {
    let Some(maneuver) = maneuver else { return "none"; };
    let kind = maneuver.maneuver_type.to_ascii_lowercase();
    if kind.contains("roundabout") || kind.contains("rotary") { "roundabout" }
    else if kind.contains("merge") { "merge" }
    else if kind.contains("fork") { "fork" }
    else if kind.contains("ramp") { "ramp" }
    else if maneuver.is_complex { "complex" }
    else { "turn" }
}

fn count_nearby(location: Location, points: impl Iterator<Item = Location>, radius: f64) -> usize {
    points.filter(|point| location.distance_meters(point) <= radius).count()
}

fn hazard_intelligence(reports: &[NavigationReportInput], traffic_count: usize) -> RustHazardIntelligence {
    let critical = reports.iter().filter(|r| matches!(r.report_type.as_str(), "accident" | "closed_lane" | "hazard")).count();
    let jams = reports.iter().filter(|r| r.report_type == "traffic_jam").count();
    let closed = reports.iter().filter(|r| r.report_type == "closed_lane").count();
    let level = if critical > 0 { "critical" } else if jams > 0 { "elevated" } else { "none" };
    let report_confidence = if reports.is_empty() { 0.0 } else {
        reports.iter().map(|r| clamp01(r.confidence.unwrap_or(0.7))).sum::<f64>() / reports.len() as f64
    };
    let confidence = if level == "none" { 0.0 } else { (report_confidence.max(if traffic_count > 0 { 0.5 } else { 0.0 })).max(0.35).min(1.0) };
    RustHazardIntelligence { level: level.into(), nearby_critical_reports: critical, nearby_traffic_jams: jams, nearby_closed_lanes: closed, confidence }
}

fn lane_intelligence(road: Option<&SceneRoad>, maneuver: Option<&Maneuver>, current: Option<i32>) -> RustLaneIntelligence {
    let Some(current) = current else { return RustLaneIntelligence { current_lane_index: None, recommended_lane_indices: vec![], lane_alignment: "unknown".into(), lane_change_direction: "unknown".into(), required_lane_changes: 0, confidence: 0.0 }; };
    let Some(road) = road else { return RustLaneIntelligence { current_lane_index: Some(current), recommended_lane_indices: vec![], lane_alignment: "unknown".into(), lane_change_direction: "unknown".into(), required_lane_changes: 0, confidence: 0.0 }; };
    let count = road.lanes.unwrap_or_else(|| maneuver.and_then(|m| m.lanes.as_ref().map(|l| l.len() as u32)).unwrap_or(1)).clamp(1, 8) as i32;
    let modifier = maneuver.and_then(|m| m.modifier.as_deref()).unwrap_or("straight").to_ascii_lowercase();
    let mut recommended = Vec::new();
    let lanes = road.turn_lanes.as_ref().or_else(|| road.destination_lanes.as_ref());
    if let Some(lanes) = lanes {
        for (index, value) in lanes.iter().enumerate() {
            let value = value.to_ascii_lowercase();
            let wants = match modifier.as_str() {
                "left" | "sharp left" | "slight left" => value.contains("left"),
                "right" | "sharp right" | "slight right" => value.contains("right"),
                "uturn" => value.contains("reverse") || value.contains("uturn"),
                _ => value.contains("through") || value.contains("straight"),
            };
            if wants { recommended.push(index as i32); }
        }
    }
    if recommended.is_empty() && count == 1 { recommended.push(0); }
    if recommended.is_empty() {
        return RustLaneIntelligence { current_lane_index: Some(current), recommended_lane_indices: vec![], lane_alignment: "unknown".into(), lane_change_direction: "unknown".into(), required_lane_changes: 0, confidence: 0.35 };
    }
    let target = *recommended.iter().min_by_key(|lane| (*lane - current).abs()).unwrap();
    let changes = (target - current).abs();
    let alignment = if changes == 0 { "aligned" } else { "misaligned" };
    let direction = if changes == 0 { "stay" } else if target < current { "left" } else { "right" };
    RustLaneIntelligence { current_lane_index: Some(current), recommended_lane_indices: recommended, lane_alignment: alignment.into(), lane_change_direction: direction.into(), required_lane_changes: changes, confidence: if road.change_lanes.is_some() { 0.9 } else { 0.75 } }
}

fn intersection_intelligence(maneuver: Option<&Maneuver>, distance: Option<f64>) -> RustIntersectionIntelligence {
    let Some(maneuver) = maneuver else { return RustIntersectionIntelligence { complexity: "simple".into(), preparation_distance_meters: 0.0, confidence: 0.0, behavior: "unknown".into() }; };
    let kind = maneuver.maneuver_type.to_ascii_lowercase();
    let behavior = if kind.contains("roundabout") { "roundabout-entry" }
        else if kind.contains("merge") { "merge" }
        else if kind.contains("fork") { "split" }
        else if kind.contains("ramp") { "ramp-merge" }
        else if kind.contains("uturn") { "uturn" }
        else { "turn" };
    let complex = maneuver.is_complex || !matches!(behavior, "turn");
    let buffer = if complex { 180.0 } else { 120.0 };
    RustIntersectionIntelligence { complexity: if complex { "complex" } else { "simple" }.into(), preparation_distance_meters: distance.unwrap_or(buffer).min(buffer), confidence: 0.78, behavior: behavior.into() }
}

pub fn analyze(request: NavigationDecisionRequest) -> NavigationDecisionResponse {
    let location = request.location.unwrap_or(Location { lat: 0.0, lng: 0.0 });
    let road = request.scene.as_ref().and_then(|scene| {
        request.current_way_id.and_then(|id| scene.roads.iter().find(|road| road.osm_id == Some(id as u64)).cloned())
            .or_else(|| nearest_road(location, &scene.roads))
    });
    let next = next_maneuver(request.route.as_ref(), location);
    let maneuver_distance = next.as_ref().map(|(_, distance)| *distance);
    let maneuver = next.as_ref().map(|(maneuver, _)| maneuver);
    let traffic_count = count_nearby(location, request.traffic_vehicles.iter().map(|v| v.location), 120.0);
    let reports_count = count_nearby(location, request.reports.iter().map(|r| r.location), 150.0);
    let nearby_signals = request.scene.as_ref().map(|s| count_nearby(location, s.signals.iter().map(|p| Location { lat: p.lat, lng: p.lng }), 80.0)).unwrap_or(0);
    let nearby_crossings = request.scene.as_ref().map(|s| count_nearby(location, s.crossings.iter().map(|p| Location { lat: p.lat, lng: p.lng }), 80.0)).unwrap_or(0);
    let nearby_stops = request.scene.as_ref().map(|s| count_nearby(location, s.stops.iter().map(|p| Location { lat: p.lat, lng: p.lng }), 100.0)).unwrap_or(0);
    let road_distance = road.as_ref().map(|r| {
        let points = r.geometry.iter().map(|p| Location { lat: p.lat, lng: p.lng }).collect::<Vec<_>>();
        point_to_polyline_distance_meters(&location, &points).unwrap_or(200.0)
    }).unwrap_or(200.0);
    let road_evidence = (1.0 - road_distance / 80.0).max(0.0).min(1.0);
    let maneuver_evidence = maneuver_distance.map(|d| (1.0 - d / 500.0).max(0.0).min(1.0)).unwrap_or(0.0);
    let confidence = (road_evidence * 0.55 + maneuver_evidence * 0.25 + if request.scene.is_some() { 0.2 } else { 0.0 }).clamp(0.0, 1.0);
    let hazard = hazard_intelligence(&request.reports, traffic_count);
    let lane = lane_intelligence(road.as_ref(), maneuver, request.current_lane_index);
    let intersection = intersection_intelligence(maneuver, maneuver_distance);
    let speed_limit = parse_speed(road.as_ref().and_then(|r| r.maxspeed.as_deref()));
    let spatial = RustSpatialIntelligence {
        road_class: classify_road(road.as_ref().and_then(|r| r.highway.as_deref())).into(),
        road_name: road.as_ref().and_then(|r| r.name.clone()),
        way_id: road.as_ref().and_then(|r| r.osm_id).map(|id| id as i64).or(request.current_way_id),
        lane_count: road.as_ref().and_then(|r| r.lanes.map(|v| v as i32)),
        one_way: road.as_ref().map(|r| r.oneway),
        speed_limit_kph: speed_limit,
        maneuver: maneuver_context(maneuver).into(),
        maneuver_distance_meters: maneuver_distance,
        next_maneuver: maneuver.cloned(),
        nearby_signals,
        nearby_crossings,
        nearby_stops,
        nearby_reports: reports_count,
        nearby_traffic_vehicles: traffic_count,
        hazard_intelligence: hazard.clone(),
        lane_intelligence: lane.clone(),
        intersection_intelligence: intersection.clone(),
        confidence,
    };

    let mut guidance = RustSpatialGuidance { action: "continue".into(), confidence, priority: "normal".into(), reason: "no-immediate-spatial-hazard".into(), target_speed_mps: None };
    if spatial.hazard_intelligence.level == "critical" {
        guidance = RustSpatialGuidance { action: "high-alert".into(), confidence: spatial.hazard_intelligence.confidence, priority: "critical".into(), reason: if spatial.hazard_intelligence.nearby_closed_lanes > 0 { "closed-lane-nearby" } else { "road-hazard-nearby" }.into(), target_speed_mps: None };
    } else if confidence < 0.35 {
        guidance = RustSpatialGuidance { action: "uncertain".into(), confidence, priority: "elevated".into(), reason: "limited-spatial-confidence".into(), target_speed_mps: None };
    } else {
        let complex = matches!(spatial.maneuver.as_str(), "complex" | "roundabout" | "fork" | "ramp");
        let imminent = maneuver_distance.map(|d| d <= if complex { 180.0 } else { 120.0 }).unwrap_or(false);
        let very_imminent = maneuver_distance.map(|d| d <= if complex { 80.0 } else { 55.0 }).unwrap_or(false);
        let target_limit = speed_limit.map(|kph| kph / 3.6);
        let speed_too_high = match (request.speed_mps, target_limit) { (Some(speed), Some(limit)) => speed > limit * 1.08, _ => false };
        if speed_too_high { guidance = RustSpatialGuidance { action: "slow".into(), confidence, priority: "elevated".into(), reason: "above-known-speed-limit".into(), target_speed_mps: target_limit }; }
        else if very_imminent && complex { guidance = RustSpatialGuidance { action: "high-alert".into(), confidence, priority: "critical".into(), reason: "complex-maneuver-ahead".into(), target_speed_mps: target_limit.map(|v| v.min(12.0)) }; }
        else if imminent && spatial.maneuver != "none" { guidance = RustSpatialGuidance { action: "prepare".into(), confidence, priority: "elevated".into(), reason: "maneuver-ahead".into(), target_speed_mps: None }; }
        else if spatial.hazard_intelligence.level == "elevated" { guidance = RustSpatialGuidance { action: "prepare".into(), confidence: confidence.min(spatial.hazard_intelligence.confidence.max(confidence)), priority: "elevated".into(), reason: "traffic-hazard-nearby".into(), target_speed_mps: None }; }
        else if lane.lane_alignment == "misaligned" && lane.required_lane_changes > 0 { guidance = RustSpatialGuidance { action: "prepare".into(), confidence: confidence.min(lane.confidence), priority: "elevated".into(), reason: "recommended-lane-change".into(), target_speed_mps: None }; }
        else if nearby_signals > 0 || nearby_crossings > 0 { guidance = RustSpatialGuidance { action: "prepare".into(), confidence, priority: "elevated".into(), reason: "nearby-road-user-control".into(), target_speed_mps: None }; }
    }

    let base_confidence = clamp01(spatial.confidence.min(guidance.confidence));
    let driver = if request.restriction_prohibited && request.restriction_confidence >= 0.65 {
        RustDriverDecision { action: "reroute".into(), priority: "critical".into(), confidence: clamp01(request.restriction_confidence), reason: "prohibited-turn-or-route-restriction".into(), target_speed_mps: None, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    } else if hazard.level == "critical" {
        RustDriverDecision { action: "high-alert".into(), priority: "critical".into(), confidence: clamp01(hazard.confidence.max(base_confidence)), reason: if hazard.nearby_closed_lanes > 0 { "closed-lane-nearby" } else { "road-hazard-nearby" }.into(), target_speed_mps: guidance.target_speed_mps, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    } else if intersection.complexity == "complex" && maneuver_distance.map(|d| d <= intersection.preparation_distance_meters).unwrap_or(false) {
        RustDriverDecision { action: "prepare".into(), priority: "elevated".into(), confidence: clamp01(base_confidence.min(intersection.confidence)), reason: format!("complex-{}-approach", intersection.behavior), target_speed_mps: guidance.target_speed_mps, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    } else if request.route_reacquire || guidance.action == "uncertain" || base_confidence < 0.35 {
        RustDriverDecision { action: "uncertain".into(), priority: "elevated".into(), confidence: base_confidence, reason: if request.route_reacquire { "route-reacquisition" } else { "limited-spatial-confidence" }.into(), target_speed_mps: None, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    } else if lane.lane_alignment == "misaligned" && lane.required_lane_changes > 0 && lane.confidence >= 0.55 {
        RustDriverDecision { action: "lane-change".into(), priority: "elevated".into(), confidence: base_confidence.min(lane.confidence), reason: "recommended-lane-change".into(), target_speed_mps: guidance.target_speed_mps, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    } else {
        RustDriverDecision { action: guidance.action.clone(), priority: guidance.priority.clone(), confidence: base_confidence, reason: guidance.reason.clone(), target_speed_mps: guidance.target_speed_mps, lane_change_direction: lane.lane_change_direction.clone(), target_lane_index: lane.recommended_lane_indices.first().copied() }
    };

    NavigationDecisionResponse { spatial_intelligence: spatial, spatial_guidance: guidance, driver_decision: driver }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{RouteCoord, RouteSegment};

    fn straight_route() -> Route3DHighlight {
        Route3DHighlight {
            provider: Some("osrm".into()),
            segments: vec![RouteSegment {
                coords: vec![
                    RouteCoord { lat: 0.0, lng: 0.0, alt: 0.0 },
                    RouteCoord { lat: 0.0, lng: 0.01, alt: 0.0 },
                ],
                is_highlighted: true,
                color: "#00ff88".into(),
                lane_index: None,
            }],
            maneuvers: vec![Maneuver {
                maneuver_type: "turn".into(),
                modifier: Some("right".into()),
                location: Location { lat: 0.0, lng: 0.008 },
                bearing_before: 90.0,
                instruction: "Turn right".into(),
                is_complex: false,
                lanes: None,
            }],
            duration_seconds: Some(60.0),
            distance_meters: Some(1000.0),
        }
    }

    #[test]
    fn runtime_detects_upcoming_maneuver() {
        let result = analyze(NavigationDecisionRequest {
            location: Some(Location { lat: 0.0, lng: 0.007 }),
            route: Some(straight_route()),
            scene: None,
            current_way_id: None,
            current_lane_index: None,
            reports: vec![],
            traffic_vehicles: vec![],
            speed_mps: Some(8.0),
            route_reacquire: false,
            restriction_prohibited: false,
            restriction_confidence: 0.0,
        });
        assert_eq!(result.spatial_intelligence.maneuver, "turn");
        assert!(result.spatial_intelligence.maneuver_distance_meters.unwrap() > 0.0);
        assert_eq!(result.spatial_guidance.action, "prepare");
    }

    #[test]
    fn critical_road_report_becomes_high_alert() {
        let result = analyze(NavigationDecisionRequest {
            location: Some(Location { lat: 0.0, lng: 0.004 }),
            route: Some(straight_route()),
            scene: None,
            current_way_id: None,
            current_lane_index: None,
            reports: vec![NavigationReportInput {
                location: Location { lat: 0.0, lng: 0.004 },
                report_type: "closed_lane".into(),
                confidence: Some(0.95),
            }],
            traffic_vehicles: vec![],
            speed_mps: Some(10.0),
            route_reacquire: false,
            restriction_prohibited: false,
            restriction_confidence: 0.0,
        });
        assert_eq!(result.spatial_guidance.action, "high-alert");
        assert_eq!(result.driver_decision.action, "high-alert");
    }
}


/// Stateful navigation session. The route/scene topology is installed once;
/// subsequent GPS ticks carry only changing observations. This keeps the
/// hot navigation path small and avoids repeatedly serializing route geometry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationSessionStart {
    pub route: Option<Route3DHighlight>,
    pub scene: Option<SceneContext>,
    pub current_way_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationSessionObservation {
    pub location: Option<Location>,
    pub current_way_id: Option<i64>,
    pub current_lane_index: Option<i32>,
    #[serde(default)]
    pub reports: Vec<NavigationReportInput>,
    #[serde(default)]
    pub traffic_vehicles: Vec<TrafficVehicleInput>,
    pub speed_mps: Option<f64>,
    #[serde(default)]
    pub route_reacquire: bool,
    #[serde(default)]
    pub restriction_prohibited: bool,
    #[serde(default)]
    pub restriction_confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationSessionContextUpdate {
    pub route: Option<Route3DHighlight>,
    pub scene: Option<SceneContext>,
    pub current_way_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NavigationSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct NavigationSession {
    pub route: Option<Route3DHighlight>,
    pub scene: Option<SceneContext>,
    pub current_way_id: Option<i64>,
}

impl NavigationSession {
    pub fn new(start: NavigationSessionStart) -> Self {
        Self { route: start.route, scene: start.scene, current_way_id: start.current_way_id }
    }

    pub fn update_context(&mut self, update: NavigationSessionContextUpdate) {
        if update.route.is_some() {
            self.route = update.route;
        }
        if update.scene.is_some() {
            self.scene = update.scene;
        }
        if update.current_way_id.is_some() {
            self.current_way_id = update.current_way_id;
        }
    }

    pub fn decide(&mut self, observation: NavigationSessionObservation) -> NavigationDecisionResponse {
        if observation.current_way_id.is_some() {
            self.current_way_id = observation.current_way_id;
        }
        analyze(NavigationDecisionRequest {
            location: observation.location,
            route: self.route.clone(),
            scene: self.scene.clone(),
            current_way_id: self.current_way_id,
            current_lane_index: observation.current_lane_index,
            reports: observation.reports,
            traffic_vehicles: observation.traffic_vehicles,
            speed_mps: observation.speed_mps,
            route_reacquire: observation.route_reacquire,
            restriction_prohibited: observation.restriction_prohibited,
            restriction_confidence: observation.restriction_confidence,
        })
    }
}
