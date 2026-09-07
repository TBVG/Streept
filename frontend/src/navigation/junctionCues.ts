import { Maneuver, Route3DHighlight } from '../types';
import { JunctionBehavior } from './junctionBehavior';

export type JunctionCueZone = 'approach' | 'decision' | 'exit';

export interface JunctionCueZoneSpec {
  zone: JunctionCueZone;
  startIndex: number;
  endIndex: number;
  emphasis: number;
}

export interface JunctionCuePlan {
  complexity: 'simple' | 'complex';
  zones: JunctionCueZoneSpec[];
  showBranchAlternatives: boolean;
  showDecisionLabel: boolean;
  branchEmphasis: number;
}

function routeDistance(coords: { lat: number; lng: number }[], start: number, end: number): number {
  let total = 0;
  for (let i = Math.min(start, end); i < Math.max(start, end); i += 1) {
    total += Math.hypot(
      (coords[i + 1].lat - coords[i].lat) * 110540,
      (coords[i + 1].lng - coords[i].lng) * 111320 * Math.max(0.2, Math.cos(coords[i].lat * Math.PI / 180)),
    );
  }
  return total;
}

function indexAtDistance(coords: { lat: number; lng: number }[], anchor: number, distance: number, direction: -1 | 1): number {
  let index = anchor;
  let travelled = 0;
  while (index + direction >= 0 && index + direction < coords.length && travelled < distance) {
    travelled += routeDistance(coords, index, index + direction);
    index += direction;
  }
  return index;
}

/**
 * Builds a small, renderer-neutral hierarchy around a maneuver. Complex
 * junctions receive an earlier approach window and stronger branch cues;
 * ordinary turns stay deliberately quiet.
 */
export function buildJunctionCuePlan(route: Route3DHighlight, maneuver: Maneuver, behavior: JunctionBehavior): JunctionCuePlan | null {
  const coords = route.segments.flatMap((segment) => segment.coords);
  if (coords.length < 2) return null;
  let maneuverIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  coords.forEach((point, index) => {
    const distance = Math.hypot((point.lat - maneuver.location.lat) * 110540, (point.lng - maneuver.location.lng) * 111320);
    if (distance < best) { best = distance; maneuverIndex = index; }
  });

  const complexKinds = new Set(['roundabout-entry', 'roundabout-exit', 'merge', 'split', 'ramp-merge', 'ramp-exit', 'uturn']);
  const complex = maneuver.is_complex || complexKinds.has(behavior.kind);
  const approachMeters = complex ? 70 : 38;
  const decisionMeters = complex ? 24 : 14;
  const exitMeters = complex ? 55 : 30;
  const approachStart = indexAtDistance(coords, maneuverIndex, approachMeters, -1);
  const decisionStart = indexAtDistance(coords, maneuverIndex, decisionMeters, -1);
  const decisionEnd = indexAtDistance(coords, maneuverIndex, decisionMeters, 1);
  const exitEnd = indexAtDistance(coords, maneuverIndex, exitMeters, 1);

  return {
    complexity: complex ? 'complex' : 'simple',
    zones: [
      { zone: 'approach', startIndex: approachStart, endIndex: Math.max(approachStart, decisionStart), emphasis: complex ? 0.42 : 0.20 },
      { zone: 'decision', startIndex: Math.min(decisionStart, decisionEnd), endIndex: Math.max(decisionStart, decisionEnd), emphasis: complex ? 0.82 : 0.55 },
      { zone: 'exit', startIndex: Math.min(decisionEnd, exitEnd), endIndex: Math.max(decisionEnd, exitEnd), emphasis: complex ? 0.30 : 0.16 },
    ],
    showBranchAlternatives: complex,
    showDecisionLabel: complex,
    branchEmphasis: complex ? 0.95 : 0.82,
  };
}

export function junctionCueZoneDistance(plan: JunctionCuePlan, zone: JunctionCueZone, coords: { lat: number; lng: number }[]): number {
  const spec = plan.zones.find((item) => item.zone === zone);
  return spec ? routeDistance(coords, spec.startIndex, spec.endIndex) : 0;
}
