import { Maneuver, Route3DHighlight, RouteCoord, SceneContext } from '../types';
import { bearingDegrees, destinationPoint } from '../utils/geo';
import { analyzeLanePath, buildLaneTopology } from './laneIntelligence';
import { buildLaneConnectorTopology, LaneConnectorTopology } from './laneConnectorTopology';
import { buildRouteLanePlan, RouteLanePlan } from './laneIntelligence';
import { buildLaneRoutePlan, LaneRoutePlan } from './laneRouting';
import { classifyJunctionBehavior, JunctionBehavior } from './junctionBehavior';
import { buildLaneChangeTrajectory, LaneChangeTrajectory } from './laneChangeTrajectory';
import { deriveSceneWaySequence } from './turnRestrictionGraph';

export interface SceneGuidancePlan {
  maneuverIndex: number;
  routeStartIndex: number;
  routeEndIndex: number;
  laneCount: number;
  currentLaneIndex: number | null;
  targetLaneIndex: number | null;
  laneChanges: number;
  laneDirection: 'stay' | 'left' | 'right' | 'mixed';
  laneConfidence: number;
  turnBearing: number;
  approachBearing: number;
  exitBearing: number;
  approachDistanceMeters: number;
  exitDistanceMeters: number;
  connectorTopology: LaneConnectorTopology;
  routeLanePlan: RouteLanePlan;
  laneRoutePlan: LaneRoutePlan;
  junctionBehavior: JunctionBehavior;
  laneChangeTrajectory: LaneChangeTrajectory | null;
}

function nearestRouteIndex(coords: RouteCoord[], maneuver: Maneuver): number {
  let bestIndex = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) {
    const d = Math.hypot(coords[i].lat - maneuver.location.lat, coords[i].lng - maneuver.location.lng);
    if (d < best) { best = d; bestIndex = i; }
  }
  return bestIndex;
}

function routeDistance(coords: RouteCoord[], start: number, end: number): number {
  let total = 0;
  for (let i = Math.min(start, end); i < Math.max(start, end); i += 1) {
    total += Math.hypot(
      (coords[i + 1].lat - coords[i].lat) * 110540,
      (coords[i + 1].lng - coords[i].lng) * 111320 * Math.max(0.2, Math.cos(coords[i].lat * Math.PI / 180)),
    );
  }
  return total;
}

/** Build the renderer-facing geometry plan from the route and lane topology.
 * It intentionally contains no Cesium/React code so the same guidance can be
 * rendered by WebGL, native, or a deterministic test renderer. */
export function buildSceneGuidancePlan(route: Route3DHighlight, maneuver: Maneuver, currentLaneIndex: number | null = null, currentLaneConfidence = 1, scene: SceneContext | null = null, physicalTargetLaneIndex: number | null = null): SceneGuidancePlan | null {
  const coords = route.segments.flatMap((segment) => segment.coords);
  if (coords.length < 2) return null;
  const maneuverIndex = nearestRouteIndex(coords, maneuver);
  const topology = buildLaneTopology(maneuver);
  const lanePath = analyzeLanePath(maneuver, currentLaneIndex, currentLaneConfidence);
  const approachIndex = Math.max(0, maneuverIndex - (maneuver.is_complex ? 18 : 12));
  const exitIndex = Math.min(coords.length - 1, maneuverIndex + (maneuver.is_complex ? 14 : 9));
  const before = coords[Math.max(0, maneuverIndex - 8)] ?? coords[0];
  const at = coords[maneuverIndex] ?? coords[0];
  const after = coords[Math.min(coords.length - 1, maneuverIndex + 10)] ?? coords[coords.length - 1];
  const approachBearing = bearingDegrees(before, at);
  const exitBearing = bearingDegrees(at, after);
  const junctionBehavior = classifyJunctionBehavior(maneuver);
  let laneChangeTrajectory: LaneChangeTrajectory | null = null;
  if (scene && currentLaneIndex != null && lanePath.targetLaneIndex != null && currentLaneIndex !== lanePath.targetLaneIndex) {
    const waySequence = deriveSceneWaySequence(coords.slice(0, maneuverIndex + 1), scene.roads);
    const candidateWayId = waySequence[waySequence.length - 1] ?? null;
    const candidateRoad = candidateWayId != null
      ? scene.roads.find((road) => road.osm_id === candidateWayId) ?? null
      : null;
    const road = candidateRoad ?? scene.roads
      .filter((item) => item.geometry.length >= 2)
      .sort((a, b) => {
        const da = Math.min(...a.geometry.map((point) => Math.hypot((point.lat - at.lat) * 110540, (point.lng - at.lng) * 111320 * Math.max(0.2, Math.cos(at.lat * Math.PI / 180)))));
        const db = Math.min(...b.geometry.map((point) => Math.hypot((point.lat - at.lat) * 110540, (point.lng - at.lng) * 111320 * Math.max(0.2, Math.cos(at.lat * Math.PI / 180)))));
        return da - db;
      })[0] ?? null;
    if (road) {
      // Final lane remains the maneuver intent; the physical renderer/execution
      // target may be staged to one adjacent lane at a time.
      const physicalTarget = physicalTargetLaneIndex ?? lanePath.targetLaneIndex;
      const runway = Math.max(32, Math.min(80, routeDistance(coords, approachIndex, maneuverIndex)));
      if (physicalTarget != null && currentLaneIndex !== physicalTarget) {
        laneChangeTrajectory = buildLaneChangeTrajectory(road, currentLaneIndex, physicalTarget, runway);
      }
    }
  }
  return {
    maneuverIndex,
    routeStartIndex: approachIndex,
    routeEndIndex: exitIndex,
    laneCount: Math.max(1, topology.length),
    currentLaneIndex,
    targetLaneIndex: lanePath.targetLaneIndex,
    laneChanges: lanePath.requiredLaneChanges,
    laneDirection: lanePath.direction,
    laneConfidence: lanePath.confidence,
    turnBearing: exitBearing,
    approachBearing,
    exitBearing,
    approachDistanceMeters: routeDistance(coords, approachIndex, maneuverIndex),
    exitDistanceMeters: routeDistance(coords, maneuverIndex, exitIndex),
    connectorTopology: buildLaneConnectorTopology(coords, maneuver, approachIndex, maneuverIndex, currentLaneIndex, lanePath.targetLaneIndex),
    routeLanePlan: buildRouteLanePlan(route.maneuvers ?? [], currentLaneIndex, currentLaneConfidence),
    laneRoutePlan: buildLaneRoutePlan(route, currentLaneIndex, currentLaneConfidence, scene),
    junctionBehavior,
    laneChangeTrajectory,
  };
}

export function laneCenterOffsetMeters(laneIndex: number, laneCount: number, roadWidthMeters = 6.6): number {
  if (laneCount < 1) return 0;
  return -roadWidthMeters / 2 + (roadWidthMeters * (laneIndex + 0.5) / laneCount);
}

export function sceneLanePoint(point: RouteCoord, bearing: number, laneIndex: number, laneCount: number, roadWidthMeters = 6.6) {
  return destinationPoint(point, (bearing + 90) % 360, laneCenterOffsetMeters(laneIndex, laneCount, roadWidthMeters));
}
