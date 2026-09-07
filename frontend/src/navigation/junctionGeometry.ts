import { Maneuver, RouteCoord, SceneRoad } from '../types';
import { bearingDegrees } from '../utils/geo';

export type JunctionGeometryKind = 'turn' | 'roundabout' | 'merge' | 'split' | 'ramp' | 'uturn';

export interface JunctionConnectorGeometry {
  kind: JunctionGeometryKind;
  points: RouteCoord[];
  lengthMeters: number;
  confidence: number;
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/_/g, '-');
}

export function classifyJunctionGeometry(maneuver: Maneuver, incoming?: SceneRoad, outgoing?: SceneRoad): JunctionGeometryKind {
  const type = norm(maneuver.type);
  const modifier = norm(maneuver.modifier);
  if (type === 'roundabout' || type === 'rotary') return 'roundabout';
  if (type === 'merge') return 'merge';
  if (type === 'on-ramp' || type === 'off-ramp' || incoming?.highway?.includes('ramp') || outgoing?.highway?.includes('ramp')) return 'ramp';
  if (type === 'fork' || type === 'split') return 'split';
  if (modifier.includes('uturn') || type === 'uturn') return 'uturn';
  return 'turn';
}

function distanceMeters(a: RouteCoord, b: RouteCoord): number {
  const scale = Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * 110540, (b.lng - a.lng) * 111320 * scale);
}

function cumulativeLength(points: RouteCoord[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += distanceMeters(points[i - 1], points[i]);
  return total;
}

function interpolate(a: RouteCoord, b: RouteCoord, t: number): RouteCoord {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, alt: a.alt + (b.alt - a.alt) * t };
}

function bezier(a: RouteCoord, c1: RouteCoord, c2: RouteCoord, b: RouteCoord, steps: number): RouteCoord[] {
  const out: RouteCoord[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      lat: u*u*u*a.lat + 3*u*u*t*c1.lat + 3*u*t*t*c2.lat + t*t*t*b.lat,
      lng: u*u*u*a.lng + 3*u*u*t*c1.lng + 3*u*t*t*c2.lng + t*t*t*b.lng,
      alt: u*u*u*a.alt + 3*u*u*t*c1.alt + 3*u*t*t*c2.alt + t*t*t*b.alt,
    });
  }
  return out;
}

/**
 * Creates a smooth, physically continuous connector through a junction. The
 * control points follow the incoming/outgoing tangents instead of inserting a
 * straight midpoint, which prevents visible kinks in the 3D lane corridor.
 */

function angleDelta(from: number, to: number, direction: 1 | -1): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (direction > 0 && d < 0) d += Math.PI * 2;
  if (direction < 0 && d > 0) d -= Math.PI * 2;
  return d;
}

function bearingToRadians(bearing: number): number {
  return bearing * Math.PI / 180;
}



function roundaboutArc(incoming: RouteCoord[], outgoing: RouteCoord[]): JunctionConnectorGeometry | null {
  const start = incoming[incoming.length - 1];
  const finish = outgoing[0];
  const before = incoming[incoming.length - 2];
  const after = outgoing[1];
  if (!start || !finish || !before || !after) return null;

  const startBearing = bearingDegrees(before, start);
  const endBearing = bearingDegrees(finish, after);
  const scale = Math.max(0.2, Math.cos(start.lat * Math.PI / 180));
  const toLocal = (point: RouteCoord) => ({
    x: (point.lng - start.lng) * 111320 * scale,
    y: (point.lat - start.lat) * 110540,
  });
  const fromLocal = (x: number, y: number): RouteCoord => ({
    lat: start.lat + y / 110540,
    lng: start.lng + x / (111320 * scale),
    alt: start.alt ?? 0,
  });
  const a = toLocal(start);
  const b = toLocal(finish);
  const startNormal = { x: Math.sin(bearingToRadians(startBearing)), y: -Math.cos(bearingToRadians(startBearing)) };
  const endNormal = { x: Math.sin(bearingToRadians(endBearing)), y: -Math.cos(bearingToRadians(endBearing)) };
  const det = startNormal.x * endNormal.y - startNormal.y * endNormal.x;
  let center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (Math.abs(det) > 0.08) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = (dx * endNormal.y - dy * endNormal.x) / det;
    center = { x: a.x + startNormal.x * t, y: a.y + startNormal.y * t };
  } else {
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const normal = { x: -Math.cos(bearingToRadians(startBearing)), y: Math.sin(bearingToRadians(startBearing)) };
    center = { x: (a.x + b.x) / 2 + normal.x * Math.max(8, chord * 0.55), y: (a.y + b.y) / 2 + normal.y * Math.max(8, chord * 0.55) };
  }

  let radius = (Math.hypot(a.x - center.x, a.y - center.y) + Math.hypot(b.x - center.x, b.y - center.y)) / 2;
  radius = Math.max(7, Math.min(45, radius));
  const thetaStart = Math.atan2(a.x - center.x, a.y - center.y);
  const thetaEnd = Math.atan2(b.x - center.x, b.y - center.y);
  const ccwTangent = ((thetaStart * 180 / Math.PI + 90) + 360) % 360;
  const cwTangent = ((thetaStart * 180 / Math.PI - 90) + 360) % 360;
  const angularError = (x: number, y: number) => Math.abs(((x - y + 540) % 360) - 180);
  const direction: 1 | -1 = angularError(startBearing, ccwTangent) <= angularError(startBearing, cwTangent) ? 1 : -1;
  const sweep = angleDelta(thetaStart, thetaEnd, direction);
  const samples = Math.max(14, Math.min(36, Math.ceil(Math.abs(sweep) * radius / 3)));
  const points: RouteCoord[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const theta = thetaStart + sweep * t;
    points.push(fromLocal(center.x + Math.sin(theta) * radius, center.y + Math.cos(theta) * radius));
  }
  points[0] = start;
  points[points.length - 1] = finish;
  return {
    kind: 'roundabout',
    points,
    lengthMeters: cumulativeLength(points),
    confidence: Math.abs(sweep) > Math.PI * 1.75 ? 0.78 : 0.94,
  };
}

export function buildJunctionConnector(
  incoming: RouteCoord[],
  outgoing: RouteCoord[],
  _maneuver: Maneuver,
  kind: JunctionGeometryKind,
): JunctionConnectorGeometry {
  if (incoming.length < 2 || outgoing.length < 2) {
    return { kind, points: [...incoming, ...outgoing], lengthMeters: cumulativeLength([...incoming, ...outgoing]), confidence: 0.35 };
  }

  const start = incoming[incoming.length - 1];
  const finish = outgoing[0];
  const startBearing = bearingDegrees(incoming[incoming.length - 2], start);
  const endBearing = bearingDegrees(finish, outgoing[1]);
  const span = Math.max(8, Math.min(28, distanceMeters(start, finish) * (kind === 'roundabout' ? 0.9 : 1.2)));

  // A tangent length derived from the connector span keeps short intersections
  // tight while giving merges/roundabouts enough curvature to look natural.
  const tangent = kind === 'uturn' ? span * 1.25 : kind === 'roundabout' ? span * 0.85 : span;
  const c1 = interpolate(start, { ...start, lat: start.lat + Math.cos(startBearing * Math.PI/180) * tangent / 110540, lng: start.lng + Math.sin(startBearing * Math.PI/180) * tangent / (111320 * Math.max(0.2, Math.cos(start.lat*Math.PI/180))) }, 1);
  const c2 = interpolate(finish, { ...finish, lat: finish.lat - Math.cos(endBearing * Math.PI/180) * tangent / 110540, lng: finish.lng - Math.sin(endBearing * Math.PI/180) * tangent / (111320 * Math.max(0.2, Math.cos(finish.lat*Math.PI/180))) }, 1);
  const arc = kind === 'roundabout' ? roundaboutArc(incoming, outgoing) : null;
  const bridge = arc?.points ?? bezier(start, c1, c2, finish, 10);
  const points = [...incoming.slice(0, -1), ...bridge, ...outgoing.slice(1)];
  const turn = Math.abs(((endBearing - startBearing + 540) % 360) - 180);
  const confidence = arc?.confidence ?? (kind === 'merge' || kind === 'split' ? 0.9 : turn > 155 ? 0.78 : 0.94);
  return { kind, points, lengthMeters: cumulativeLength(points), confidence };
}
