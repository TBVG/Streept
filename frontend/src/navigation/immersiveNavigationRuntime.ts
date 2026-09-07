import { Location, Maneuver, Route3DHighlight, SceneContext } from '../types';
import { NavigationEngineSnapshot } from './navigationEngine';
import { buildSceneGuidancePlan } from './sceneGuidance';
import { buildSceneConfidence } from './sceneConfidence';
import { buildSceneRecoveryPlan, SceneRecoveryPlan } from './sceneRecovery';
import { buildDriverGuidanceFallback, DriverGuidanceFallbackPlan } from './driverGuidanceFallback';
import { buildSceneComposition, SceneCompositionPlan } from './sceneComposition';

export interface ImmersiveNavigationState {
  routeGeneration: number;
  routeHealth: NavigationEngineSnapshot['health'];
  gpsConfidence: number;
  laneConfidence: number;
  sceneConfidence: number;
  overallConfidence: number;
  maneuver: Maneuver | null;
  recovery: SceneRecoveryPlan;
  fallback: DriverGuidanceFallbackPlan;
  composition: SceneCompositionPlan;
  scenario: NavigationEngineSnapshot['extremeScenario'];
  shouldReacquireRoute: boolean;
  routeContinuityAllowed: boolean;
  trafficReady: boolean;
}

export interface ImmersiveNavigationRuntimeInput {
  snapshot: NavigationEngineSnapshot | null;
  route: Route3DHighlight | null;
  maneuver: Maneuver | null;
  userLocation: Location | null;
  scene: SceneContext | null;
  sceneAgeMs: number | null;
  hasPhysicalConnector?: boolean;
}

/**
 * Single renderer-facing contract for immersive navigation. NavigationEngine
 * remains the authority for route/GPS/lane state; this adapter only translates
 * that authority into visual confidence, fallback and recovery policy.
 */
export function buildImmersiveNavigationState(input: ImmersiveNavigationRuntimeInput): ImmersiveNavigationState | null {
  const { snapshot, route, maneuver, userLocation, scene, sceneAgeMs } = input;
  if (!route) return null;

  const laneConfidence = snapshot?.currentLane?.confidence ?? 0;
  const matchedConfidence = snapshot?.matched?.confidence ?? 0;
  const currentLaneIndex = snapshot?.currentLane?.laneIndex ?? null;
  const guidancePlan = maneuver ? buildSceneGuidancePlan(route, maneuver, currentLaneIndex, Math.max(laneConfidence, matchedConfidence), scene) : null;
  const fallbackManeuver: Maneuver = route.maneuvers?.[0] ?? { type: 'continue', modifier: 'straight', location: route.segments[0]?.coords[0] ?? { lat: 0, lng: 0, alt: 0 }, bearing_before: 0, instruction: 'Continue', is_complex: false, lanes: [] };
  const safeGuidancePlan = guidancePlan ?? buildSceneGuidancePlan(route, fallbackManeuver, currentLaneIndex, Math.max(laneConfidence, matchedConfidence), scene);
  if (!safeGuidancePlan) return null;
  const confidence = buildSceneConfidence(safeGuidancePlan, laneConfidence || matchedConfidence || 0, userLocation, route, scene);
  const recovery = buildSceneRecoveryPlan({ confidence, sceneAgeMs });
  const fallback = buildDriverGuidanceFallback(confidence, safeGuidancePlan.laneRoutePlan.windows.length > 0, input.hasPhysicalConnector ?? Boolean(safeGuidancePlan.connectorTopology.connectors.length));
  const composition = buildSceneComposition(confidence, recovery, fallback);

  const routeHealth = snapshot?.health ?? { gps: 'lost', route: 'off-route', confidence: 0, staleMs: null } as NavigationEngineSnapshot['health'];
  const gpsConfidence = snapshot ? Math.min(confidence.gps, snapshot.health.confidence) : confidence.gps;
  const shouldReacquireRoute = Boolean(snapshot && (!snapshot.matched || snapshot.health.gps === 'lost' || snapshot.health.route === 'off-route'));
  const scenario = snapshot?.extremeScenario ?? 'normal';

  return {
    routeGeneration: snapshot?.routeGeneration ?? 0,
    routeHealth,
    gpsConfidence,
    laneConfidence: confidence.lane,
    sceneConfidence: confidence.scene,
    overallConfidence: confidence.overall,
    maneuver,
    recovery,
    fallback,
    composition,
    scenario,
    shouldReacquireRoute: Boolean(snapshot?.routeReacquire || shouldReacquireRoute),
    routeContinuityAllowed: recovery.continuityAlpha > 0.25,
    trafficReady: Boolean(scene) && confidence.overall >= 0.45 && recovery.state !== 'scene-stale',
  };
}
