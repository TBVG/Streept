import { Location, Maneuver, Report, SceneRoad } from '../types';
import { NavigationEngine } from './navigationEngine';
import { simulateNavigation, SimulationConfig, SimulationResult, routeForSimulation } from './navigationSimulation';
import { buildLaneChangeTrajectory } from './laneChangeTrajectory';
import { assessLaneChangeDynamics } from './laneChangeDynamics';
import { assessLaneChangeTrafficSafety, LaneOccupantObservation } from './laneChangeTrafficSafety';
import { decideUnifiedManeuver, UnifiedManeuverDecision } from './maneuverDecision';
import { resolveComplexJunctionLane, ComplexJunctionResolution } from './complexJunctionLaneResolver';
import { DestinationLaneTiming } from './destinationLaneIntelligence';

export type NavigationScenarioKind = 'clean' | 'gps-degraded' | 'gps-dropout' | 'blocked-lane-change' | 'unsafe-lane-change' | 'complex-junction';

export interface NavigationScenario {
  id: string;
  kind: NavigationScenarioKind;
  description: string;
  route: Location[];
  simulation: SimulationConfig;
  scene?: { roads: SceneRoad[] };
  laneChange?: {
    sourceLane: number;
    targetLane: number;
    distanceToManeuverMeters: number;
    speedMps: number;
    occupant?: LaneOccupantObservation;
    report?: Report;
  };
  junction?: {
    fromRoad: SceneRoad;
    toRoad: SceneRoad;
    maneuver: Maneuver;
    currentLane: number;
    proposedTarget: number;
    distanceToNextManeuverMeters?: number;
  };
}

export interface NavigationScenarioResult {
  id: string;
  kind: NavigationScenarioKind;
  drive: SimulationResult;
  maneuverDecision: UnifiedManeuverDecision | null;
  junctionResolution: ComplexJunctionResolution | null;
  passed: boolean;
  failures: string[];
}

const ROUTE: Location[] = [
  { lat: 21.1458, lng: 79.0882 },
  { lat: 21.1467, lng: 79.0892 },
  { lat: 21.1477, lng: 79.0908 },
  { lat: 21.1490, lng: 79.0920 },
  { lat: 21.1502, lng: 79.0937 },
];

const laneRoad = (id: number, lanes: number, highway = 'primary', startNode = 100, endNode = id): SceneRoad => ({
  osm_id: id,
  node_ids: [startNode, endNode],
  geometry: [{ lat: 21.1458, lng: 79.0882 }, { lat: 21.1490, lng: 79.0920 }],
  highway,
  name: null,
  lanes,
  oneway: true,
});

const turn = (type = 'turn'): Maneuver => ({
  type,
  modifier: 'right',
  location: ROUTE[2],
  bearing_before: 90,
  instruction: 'turn right',
  is_complex: true,
});

const report = (type: Report['type'], location: Location): Report => ({
  id: `scenario-${type}`,
  type,
  location,
  photo_url: null,
  reported_at: new Date(0).toISOString(),
  expires_at: new Date(86400000).toISOString(),
  reporter_id: 'simulation',
  confirmations: 1,
  dismissals: 0,
  confidence: 0.95,
});

export function createNavigationScenarioSuite(): NavigationScenario[] {
  const base = (id: string, kind: NavigationScenarioKind, description: string, simulation: SimulationConfig): NavigationScenario => ({ id, kind, description, route: ROUTE, simulation });
  const laneChangeLocation = ROUTE[2];
  return [
    base('clean-drive', 'clean', 'Normal GPS with low deterministic noise.', { route: ROUTE, speedMps: 12, stepMs: 400, gpsAccuracyMeters: 4, gpsNoiseMeters: 1.5 }),
    base('gps-degraded', 'gps-degraded', 'Low-quality GPS with moderate lateral noise.', { route: ROUTE, speedMps: 10, stepMs: 400, gpsAccuracyMeters: 14, gpsNoiseMeters: 7, lateralNoiseMeters: 3 }),
    base('gps-dropout', 'gps-dropout', 'Extended GPS outage recovered by short-horizon continuity.', { route: ROUTE, speedMps: 10, stepMs: 500, gpsAccuracyMeters: 5, dropoutWindowsMs: [{ start: 2500, end: 9000 }] }),
    {
      ...base('blocked-lane-change', 'blocked-lane-change', 'A fresh target-lane occupant blocks a physical lane-change trajectory.', { route: ROUTE, speedMps: 12, stepMs: 400, gpsAccuracyMeters: 4 }),
      laneChange: { sourceLane: 0, targetLane: 1, distanceToManeuverMeters: 70, speedMps: 12, occupant: { id: 'vehicle-1', location: laneChangeLocation, laneIndex: 1, speedMps: 10, observedAtMs: 0, confidence: 0.95 } },
    },
    {
      ...base('closed-lane-change', 'unsafe-lane-change', 'A community closed-lane report makes the target lane unsafe.', { route: ROUTE, speedMps: 12, stepMs: 400, gpsAccuracyMeters: 4 }),
      laneChange: { sourceLane: 0, targetLane: 1, distanceToManeuverMeters: 70, speedMps: 12, report: report('closed_lane', laneChangeLocation) },
    },
    {
      ...base('complex-junction', 'complex-junction', 'Three lanes merge into two shortly before another maneuver.', { route: ROUTE, speedMps: 11, stepMs: 400, gpsAccuracyMeters: 5 }),
      junction: { fromRoad: laneRoad(501, 3, 'primary', 100, 200), toRoad: laneRoad(502, 2, 'primary', 200, 300), maneuver: turn('merge'), currentLane: 2, proposedTarget: 1, distanceToNextManeuverMeters: 55 },
    },
  ];
}

function activeEngine(): NavigationEngine {
  const engine = new NavigationEngine({ now: () => 0 });
  engine.setRoute(routeForSimulation(ROUTE));
  engine.dispatch({ type: 'PLAN', hasRoute: true });
  engine.dispatch({ type: 'START', hasRoute: true });
  return engine;
}

function evaluateLaneChange(scenario: NavigationScenario): UnifiedManeuverDecision | null {
  if (!scenario.laneChange) return null;
  const road = laneRoad(601, 3);
  const trajectory = buildLaneChangeTrajectory(road, scenario.laneChange.sourceLane, scenario.laneChange.targetLane, 48);
  const dynamics = assessLaneChangeDynamics({ trajectory, currentSpeedMps: scenario.laneChange.speedMps, distanceToManeuverMeters: scenario.laneChange.distanceToManeuverMeters });
  const traffic = assessLaneChangeTrafficSafety({ trajectory, targetLane: scenario.laneChange.targetLane, occupants: scenario.laneChange.occupant ? [scenario.laneChange.occupant] : [], reports: scenario.laneChange.report ? [scenario.laneChange.report] : [], nowMs: 0 });
  const reachability = {
    reachable: dynamics.safe && traffic.safe,
    confidence: Math.min(trajectory.confidence, dynamics.confidence, traffic.confidence),
    requiredRunwayMeters: dynamics.requiredDistanceMeters,
    remainingMeters: scenario.laneChange.distanceToManeuverMeters,
    reason: dynamics.safe && traffic.safe ? 'reachable' : traffic.reason,
    dynamics,
    trafficSafe: traffic.safe,
    trafficConfidence: traffic.confidence,
    trafficReason: traffic.reason,
  } as any;
  const timing: DestinationLaneTiming = {
    currentLaneIndex: scenario.laneChange.sourceLane,
    targetLaneIndex: scenario.laneChange.targetLane,
    direction: scenario.laneChange.targetLane === scenario.laneChange.sourceLane ? 'stay' : scenario.laneChange.targetLane > scenario.laneChange.sourceLane ? 'right' : 'left',
    laneDelta: scenario.laneChange.targetLane - scenario.laneChange.sourceLane,
    laneChanges: Math.abs(scenario.laneChange.targetLane - scenario.laneChange.sourceLane),
    urgency: 'prepare',
    latestChangeMeters: scenario.laneChange.distanceToManeuverMeters - 10,
    earliestChangeMeters: scenario.laneChange.distanceToManeuverMeters - 55,
    confidence: 0.9,
  };
  return decideUnifiedManeuver({ timing, reachability, currentLaneConfidence: 0.9, distanceToManeuverMeters: scenario.laneChange.distanceToManeuverMeters });
}

export function runNavigationScenario(scenario: NavigationScenario): NavigationScenarioResult {
  const drive = simulateNavigation(activeEngine(), scenario.simulation);
  const maneuverDecision = evaluateLaneChange(scenario);
  const junctionResolution = scenario.junction
    ? resolveComplexJunctionLane(scenario.junction.fromRoad, scenario.junction.toRoad, scenario.junction.maneuver, scenario.junction.currentLane, scenario.junction.proposedTarget, [], [], scenario.junction.distanceToNextManeuverMeters)
    : null;
  const failures: string[] = [];
  if (!drive.completed) failures.push('drive did not complete');
  if (drive.monotonicViolations > 0) failures.push(`progress moved backwards ${drive.monotonicViolations} time(s)`);
  if (scenario.kind === 'gps-dropout' && drive.continuitySamples === 0) failures.push('GPS dropout never used continuity');
  if (scenario.kind === 'blocked-lane-change' && maneuverDecision?.action === 'change-now') failures.push('blocked target lane was treated as immediately safe');
  if (scenario.kind === 'unsafe-lane-change' && maneuverDecision?.action === 'change-now') failures.push('closed target lane was treated as immediately safe');
  if (scenario.kind === 'complex-junction' && (!junctionResolution || junctionResolution.kind !== 'merge' || !junctionResolution.continuous)) failures.push('complex merge lost legal physical continuity');
  return { id: scenario.id, kind: scenario.kind, drive, maneuverDecision, junctionResolution, passed: failures.length === 0, failures };
}

export function runNavigationScenarioSuite(scenarios = createNavigationScenarioSuite()): NavigationScenarioResult[] {
  return scenarios.map(runNavigationScenario);
}
