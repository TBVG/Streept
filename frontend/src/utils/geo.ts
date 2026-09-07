import { Location, RouteCoord } from '../types';

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: Location, b: Location): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Given an origin, a compass bearing (degrees, 0 = north, clockwise), and a
 * distance in meters, returns the destination point along that great circle.
 * Used to place the 3D camera a short distance "behind" a turn, looking
 * toward it the way an approaching driver would see it.
 */
export function destinationPoint(
  origin: Location,
  bearingDeg: number,
  distanceMeters: number
): RouteCoord {
  const lat1 = (origin.lat * Math.PI) / 180;
  const lng1 = (origin.lng * Math.PI) / 180;
  const brng = (bearingDeg * Math.PI) / 180;
  const angularDist = distanceMeters / EARTH_RADIUS_M;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI, alt: 0 };
}

/**
 * Projects a point onto a polyline (route), returning the distance along
 * the polyline to the closest point, and the lateral distance off the line.
 * Uses a local flat-earth approximation (equirectangular projection around
 * the polyline's first point) — accurate enough for route-scale distances
 * (routes spanning a few km; error grows for very long routes).
 */
export interface PolylineProjection {
  distanceAlongMeters: number;
  distanceFromLineMeters: number;
  segmentIndex: number;
}

function toLocalMeters(origin: Location, p: Location): { x: number; y: number } {
  const latRad = (origin.lat * Math.PI) / 180;
  return {
    x: (p.lng - origin.lng) * Math.cos(latRad) * 111320,
    y: (p.lat - origin.lat) * 110540,
  };
}

export function projectOntoPolyline(
  point: Location,
  polyline: Location[]
): PolylineProjection | null {
  if (polyline.length < 2) {
    return null;
  }

  const origin = polyline[0];
  const p = toLocalMeters(origin, point);

  let cumulative = 0;
  let best: PolylineProjection | null = null;
  let bestLateral = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = toLocalMeters(origin, polyline[i]);
    const b = toLocalMeters(origin, polyline[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLen = Math.hypot(abx, aby);

    const t =
      segLen > 0
        ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (segLen * segLen)))
        : 0;
    const projX = a.x + t * abx;
    const projY = a.y + t * aby;
    const lateral = Math.hypot(p.x - projX, p.y - projY);

    if (lateral < bestLateral) {
      bestLateral = lateral;
      best = {
        distanceAlongMeters: cumulative + t * segLen,
        distanceFromLineMeters: lateral,
        segmentIndex: i,
      };
    }
    cumulative += segLen;
  }

  return best;
}

/** Compass bearing (degrees, 0-360) from point a to point b. */
export function bearingDegrees(a: Location, b: Location): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}


/** Signed lateral offset to the nearest polyline segment. Positive is left of travel. */
export function signedLateralOffset(point: Location, polyline: Location[], segmentIndex: number): number {
  if (polyline.length < 2) return 0;
  const i = Math.max(0, Math.min(polyline.length - 2, segmentIndex));
  const a = polyline[i];
  const b = polyline[i + 1];
  const latRad = (a.lat * Math.PI) / 180;
  const scaleX = Math.cos(latRad) * 111320;
  const scaleY = 110540;
  const px = (point.lng - a.lng) * scaleX;
  const py = (point.lat - a.lat) * scaleY;
  const bx = (b.lng - a.lng) * scaleX;
  const by = (b.lat - a.lat) * scaleY;
  const len = Math.hypot(bx, by);
  if (len <= 0) return 0;
  return (bx * py - by * px) / len;
}
