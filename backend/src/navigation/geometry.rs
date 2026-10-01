use crate::models::Location;

fn distance_meters(a: &Location, b: &Location) -> f64 {
    const LAT_SCALE: f64 = 110_540.0;
    let lng_scale = 111_320.0 * a.lat.to_radians().cos().abs().max(0.2);
    ((a.lat - b.lat) * LAT_SCALE).hypot((a.lng - b.lng) * lng_scale)
}

pub fn point_to_polyline_distance_meters(point: &Location, polyline: &[Location]) -> Option<f64> {
    if polyline.len() < 2 { return None; }
    let mut best = f64::INFINITY;
    for pair in polyline.windows(2) {
        let a = pair[0];
        let b = pair[1];
        let lat_scale = 110_540.0;
        let lng_scale = 111_320.0 * point.lat.to_radians().cos().abs().max(0.2);
        let ax = a.lng * lng_scale;
        let ay = a.lat * lat_scale;
        let bx = b.lng * lng_scale;
        let by = b.lat * lat_scale;
        let px = point.lng * lng_scale;
        let py = point.lat * lat_scale;
        let dx = bx - ax;
        let dy = by - ay;
        let denom = dx * dx + dy * dy;
        let t = if denom > 0.0 { ((px - ax) * dx + (py - ay) * dy) / denom } else { 0.0 };
        let t = t.clamp(0.0, 1.0);
        let snapped = Location { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
        best = best.min(distance_meters(point, &snapped));
    }
    best.is_finite().then_some(best)
}

#[derive(Debug, Clone, Copy)]
pub struct PolylineProjection {
    pub distance_along_meters: f64,
    pub distance_from_line_meters: f64,
    pub segment_index: usize,
}

pub fn project_onto_polyline(point: &Location, polyline: &[Location]) -> Option<PolylineProjection> {
    if polyline.len() < 2 { return None; }
    let mut best: Option<PolylineProjection> = None;
    let mut cumulative = 0.0;
    for (index, pair) in polyline.windows(2).enumerate() {
        let a = pair[0];
        let b = pair[1];
        let lat_scale = 110_540.0;
        let lng_scale = 111_320.0 * point.lat.to_radians().cos().abs().max(0.2);
        let ax = a.lng * lng_scale;
        let ay = a.lat * lat_scale;
        let bx = b.lng * lng_scale;
        let by = b.lat * lat_scale;
        let px = point.lng * lng_scale;
        let py = point.lat * lat_scale;
        let dx = bx - ax;
        let dy = by - ay;
        let len = dx.hypot(dy);
        let denom = dx * dx + dy * dy;
        let t = if denom > 0.0 { ((px - ax) * dx + (py - ay) * dy) / denom } else { 0.0 };
        let t = t.clamp(0.0, 1.0);
        let sx = ax + dx * t;
        let sy = ay + dy * t;
        let lateral = (px - sx).hypot(py - sy);
        let candidate = PolylineProjection {
            distance_along_meters: cumulative + len * t,
            distance_from_line_meters: lateral,
            segment_index: index,
        };
        if best.map(|current| candidate.distance_from_line_meters < current.distance_from_line_meters).unwrap_or(true) {
            best = Some(candidate);
        }
        cumulative += len;
    }
    best
}
