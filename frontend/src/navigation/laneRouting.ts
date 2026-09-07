import { Maneuver, Route3DHighlight, RouteCoord, SceneContext } from '../types';
import { analyzeLanePath, buildLaneTopology, RouteLanePlan, RouteLanePlanStep } from './laneIntelligence';
import { buildLegalLaneTransitions, shortestLegalLaneSequence } from './laneIntersectionIntelligence';
import { classifyJunctionBehavior, laneChangeWindowBufferMeters } from './junctionBehavior';
import { deriveSceneWaySequence, evaluateNextWayRestriction } from './turnRestrictionGraph';
import { buildRoutePhysicalLaneGraph, laneTransition } from './laneGraph';
import { destinationMatchesLane, parseOsmLaneSemantics } from './osmLaneSemantics';
import { buildRouteLaneStrategy } from './routeLaneStrategy';
import { resolveComplexJunctionLane } from './complexJunctionLaneResolver';

export interface LaneChangeWindow {
  maneuverIndex: number;
  fromLaneIndex: number | null;
  targetLaneIndex: number | null;
  direction: 'stay' | 'left' | 'right' | 'mixed';
  laneChanges: number;
  distanceToManeuverMeters: number;
  earliestChangeMeters: number;
  latestChangeMeters: number;
  urgency: 'none' | 'prepare' | 'change-now' | 'too-late' | 'unknown';
  reachable: boolean;
  confidence: number;
}

export interface LaneRoutePlan {
  routePlan: RouteLanePlan;
  windows: LaneChangeWindow[];
  nextAction: LaneChangeWindow | null;
}

function distance(a: RouteCoord, b: RouteCoord): number {
  const latScale = 110540;
  const lngScale = 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * latScale, (b.lng - a.lng) * lngScale);
}

function routeDistance(coords: RouteCoord[], start: number, end: number): number {
  if (coords.length < 2 || start === end) return 0;
  let total = 0;
  const lo = Math.max(0, Math.min(start, end));
  const hi = Math.min(coords.length - 1, Math.max(start, end));
  for (let i = lo; i < hi; i += 1) total += distance(coords[i], coords[i + 1]);
  return total;
}

function nearestIndex(coords: RouteCoord[], maneuver: Maneuver): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) {
    const d = distance(coords[i], maneuver.location as RouteCoord);
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}

/**
 * Converts discrete OSRM lane recommendations into actionable lane-change
 * windows along the route. The planner deliberately works in meters from the
 * current position, making it usable by both the 2D guidance UI and Cesium.
 * It does not invent a maneuver when OSM/OSRM has no lane data.
 */
export function buildLaneRoutePlan(
  route: Route3DHighlight,
  currentLaneIndex: number | null = null,
  currentLaneConfidence = 1,
  scene: SceneContext | null = null,
  destinationText: string | null = null,
): LaneRoutePlan {
  const coords = route.segments.flatMap((segment) => segment.coords);
  const maneuvers = route.maneuvers ?? [];
  const sceneWaySequence = scene ? deriveSceneWaySequence(coords, scene.roads) : [];
  const physicalLaneGraph = buildRoutePhysicalLaneGraph(scene, sceneWaySequence, maneuvers);
  const routePlan = requireRoutePlan(maneuvers, currentLaneIndex, currentLaneConfidence, scene, sceneWaySequence, coords);
  if (coords.length < 2 || !maneuvers.length) return { routePlan, windows: [], nextAction: null };

  const maneuverPositions = maneuvers.map((m) => nearestIndex(coords, m));
  const windows: LaneChangeWindow[] = [];
  let previousPosition = 0;
  let previousTarget: number | null = currentLaneIndex;

  routePlan.steps.forEach((step, maneuverIndex) => {
    const maneuver = maneuvers[maneuverIndex];
    const position = maneuverPositions[maneuverIndex];
    const distanceToManeuverMeters = routeDistance(coords, previousPosition, position);
    const topology = buildLaneTopology(maneuver);
    const semanticRoad = scene && sceneWaySequence.length ? scene.roads.find((road) => road.osm_id === sceneWaySequence[Math.max(0, Math.min(sceneWaySequence.length - 1, maneuverIndex))]) : null;
    const destinationCandidates = semanticRoad && destinationText
      ? parseOsmLaneSemantics(semanticRoad, maneuver, Math.max(1, semanticRoad.lanes ?? maneuver.lanes?.length ?? 1))
          .filter((lane) => destinationMatchesLane(destinationText, lane.destination))
      : [];
    const target = destinationCandidates.length
      ? destinationCandidates[Math.floor(destinationCandidates.length / 2)].index
      : step.targetLaneIndex;
    const fromLane = previousTarget;
    let laneChanges = step.requiredLaneChanges;
    const legalPlan = buildLegalLaneTransitions(maneuver, topology.length);
    if (fromLane != null && target != null) {
      const legalSequence = shortestLegalLaneSequence(legalPlan, fromLane, target);
      if (!legalSequence) {
        laneChanges = Math.max(laneChanges, 1);
      } else {
        laneChanges = legalSequence.length - 1;
      }
    }
    const behavior = classifyJunctionBehavior(maneuver);
    const maneuverWaySequence = scene
      ? deriveSceneWaySequence(coords.slice(0, Math.min(coords.length, position + 8)), scene.roads)
      : [];
    const restrictionResult = scene && maneuverWaySequence.length > 1
      ? evaluateNextWayRestriction(scene.restrictions, maneuverWaySequence.slice(Math.max(0, maneuverWaySequence.length - 8), -1), maneuverWaySequence[maneuverWaySequence.length - 1] ?? null)
      : null;
    const currentWay = maneuverWaySequence[maneuverWaySequence.length - 2] ?? null;
    const nextWay = maneuverWaySequence[maneuverWaySequence.length - 1] ?? null;
    const physicalTransition = currentWay != null && nextWay != null
      ? laneTransition(physicalLaneGraph, currentWay, nextWay, fromLane)
      : null;
    const physicalBlocked = physicalTransition?.legal === false;
    const laneWidth = 3.3;

    // A lane change needs physical runway. Keep a conservative 45 m minimum
    // and add 25 m per additional lane. Never schedule a change after the
    // maneuver point; if the runway is shorter, mark it too-late instead.
    const requiredRunway = laneChanges > 0 ? laneChangeWindowBufferMeters(behavior, laneChanges) : 0;
    const junctionSafetyBuffer = behavior.laneChangeAllowedInsideJunction ? 8 : 18;
    const latestChangeMeters = laneChanges > 0
      ? Math.max(1, distanceToManeuverMeters - Math.min(junctionSafetyBuffer, Math.max(1, distanceToManeuverMeters * 0.5)))
      : 0;
    const earliestChangeMeters = Math.max(0, latestChangeMeters - Math.max(requiredRunway, laneChanges * laneWidth * 4));

    let urgency: LaneChangeWindow['urgency'] = 'none';
    if (laneChanges > 0) {
      if (!step.reachable || (fromLane != null && target != null && !shortestLegalLaneSequence(legalPlan, fromLane, target))) urgency = 'unknown';
      else if (distanceToManeuverMeters < 20) urgency = 'too-late';
      else if (distanceToManeuverMeters <= 85) urgency = 'change-now';
      else urgency = 'prepare';
    }

    windows.push({
      maneuverIndex,
      fromLaneIndex: fromLane,
      targetLaneIndex: target,
      direction: step.direction,
      laneChanges,
      distanceToManeuverMeters,
      earliestChangeMeters,
      latestChangeMeters,
      urgency,
      reachable: step.reachable && restrictionResult?.decision !== 'prohibited' && !physicalBlocked,
      confidence: Math.min(step.confidence, legalPlan.confidence, restrictionResult?.confidence ?? 1, physicalTransition?.confidence ?? 1),
    });

    if (target != null) previousTarget = target;
    previousPosition = position;
  });

  const nextAction = windows.find((window) => window.laneChanges > 0 && window.urgency !== 'none') ?? null;
  return { routePlan, windows, nextAction };
}

function requireRoutePlan(maneuvers: Maneuver[], currentLaneIndex: number | null, confidence: number, scene: SceneContext | null = null, sceneWaySequence: number[] = [], routeCoords: RouteCoord[] = []): RouteLanePlan {
  const strategy = buildRouteLaneStrategy(maneuvers, currentLaneIndex, confidence, 3);
  let previous = currentLaneIndex;
  let routeConfidence = Math.max(0, Math.min(1, confidence));
  let total = 0;
  let continuous = true;
  const steps: RouteLanePlanStep[] = [];

  maneuvers.forEach((maneuver, maneuverIndex) => {
    const topology = buildLaneTopology(maneuver);
    const strategyStep = strategy.steps[maneuverIndex];
    if (!topology.length) {
      steps.push({ maneuverIndex, laneCount: 0, targetLaneIndex: null, plannedLaneIndex: null, nextPlannedLaneIndex: null, lookaheadLaneChanges: 0, stabilityScore: 0, requiredLaneChanges: 0, direction: 'stay', reachable: false, confidence: routeConfidence * 0.8 });
      continuous = false;
      return;
    }

    const localCurrent = previous != null && previous < topology.length ? previous : null;
    const analysis = analyzeLanePath(maneuver, localCurrent, routeConfidence);
    const planned = strategyStep?.plannedLaneIndex != null && strategyStep.plannedLaneIndex < topology.length
      ? strategyStep.plannedLaneIndex
      : analysis.targetLaneIndex;
    const position = routeCoords.length ? nearestIndex(routeCoords, maneuver) : 0;
    const history = scene ? deriveSceneWaySequence(routeCoords.slice(0, Math.min(routeCoords.length, position + 8)), scene.roads) : sceneWaySequence;
    const fromWayId = history.length > 1 ? history[history.length - 2] : null;
    const toWayId = history.length > 0 ? history[history.length - 1] : null;
    const fromRoad = scene && fromWayId != null ? scene.roads.find((road) => road.osm_id === fromWayId) ?? null : null;
    const toRoad = scene && toWayId != null ? scene.roads.find((road) => road.osm_id === toWayId) ?? null : null;
    const nextManeuverPosition = maneuverIndex + 1 < maneuvers.length && routeCoords.length
      ? nearestIndex(routeCoords, maneuvers[maneuverIndex + 1])
      : null;
    const distanceToNextManeuverMeters = nextManeuverPosition == null ? null : routeDistance(routeCoords, position, nextManeuverPosition);
    const complexResolution = scene && localCurrent != null && fromRoad && toRoad
      ? resolveComplexJunctionLane(fromRoad, toRoad, maneuver, localCurrent, planned, scene.restrictions, history, distanceToNextManeuverMeters)
      : null;
    const resolvedPlanned = complexResolution?.targetLaneIndex != null && complexResolution.continuous
      ? complexResolution.targetLaneIndex
      : planned;
    const laneDelta = localCurrent == null || resolvedPlanned == null ? 0 : resolvedPlanned - localCurrent;
    const direction = laneDelta === 0 ? 'stay' : laneDelta < 0 ? 'left' : 'right';
    const reachable = analysis.reachable && (resolvedPlanned == null || topology[resolvedPlanned]?.recommended || topology[resolvedPlanned]?.indications.length > 0);
    const stepConfidence = Math.min(analysis.confidence, strategyStep?.confidence ?? 1, complexResolution?.confidence ?? 1) * (localCurrent == null ? 0.82 : 1);
    const restriction = scene && history.length > 1
      ? evaluateNextWayRestriction(scene.restrictions, history.slice(Math.max(0, history.length - 8), -1), history[history.length - 1] ?? null)
      : null;
    const blocked = restriction?.decision === 'prohibited';
    const finalConfidence = Math.min(stepConfidence, restriction?.confidence ?? 1);
    steps.push({
      maneuverIndex,
      laneCount: topology.length,
      targetLaneIndex: resolvedPlanned,
      plannedLaneIndex: resolvedPlanned,
      nextPlannedLaneIndex: strategyStep?.nextLaneIndex ?? null,
      lookaheadLaneChanges: strategyStep?.lookaheadLaneChanges ?? 0,
      stabilityScore: strategyStep?.stabilityScore ?? 0,
      requiredLaneChanges: Math.abs(laneDelta),
      direction,
      reachable: reachable && !blocked,
      confidence: finalConfidence,
    });
    total += Math.abs(laneDelta);
    if (localCurrent == null || !reachable || blocked) continuous = false;
    if (resolvedPlanned != null) previous = resolvedPlanned;
    routeConfidence = Math.min(routeConfidence, finalConfidence);
  });

  return { steps, totalLaneChanges: total, confidence: routeConfidence, continuous };
}

