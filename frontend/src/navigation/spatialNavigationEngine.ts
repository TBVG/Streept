import { Location, Maneuver, Route3DHighlight, SceneContext } from '../types';
import { NavigationEngineSnapshot } from './navigationEngine';
import { projectOntoPolyline } from '../utils/geo';
import { deriveIntersectionIntelligence, IntersectionIntelligence } from './intersectionIntelligence';
import { decideManeuverExperience, ExperienceDecision } from './navigationExperience';
import { buildSceneGuidancePlan, SceneGuidancePlan } from './sceneGuidance';
import { buildSceneConfidence, SceneConfidence } from './sceneConfidence';
import { buildSceneRecoveryPlan, SceneRecoveryPlan } from './sceneRecovery';
import { buildDriverGuidanceFallback, DriverGuidanceFallbackPlan } from './driverGuidanceFallback';
import { buildSceneComposition, SceneCompositionPlan } from './sceneComposition';

export type SpatialPresentationMode = 'map' | 'prepare' | 'immersive';

export interface SpatialNavigationPlan {
  maneuver: Maneuver | null;
  distanceToManeuverMeters: number | null;
  experience: ExperienceDecision | null;
  presentation: SpatialPresentationMode;
  intersection: IntersectionIntelligence;
  guidance: SceneGuidancePlan | null;
  confidence: SceneConfidence | null;
  recovery: SceneRecoveryPlan | null;
  fallback: DriverGuidanceFallbackPlan | null;
  composition: SceneCompositionPlan | null;
  reason: string;
}

const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));

/**
 * Single renderer-facing decision boundary for Streept's spatial navigation.
 * NavigationEngine remains authoritative for matching/lane state; this module
 * decides which maneuver matters next and how strongly the scene should be
 * presented. It is deterministic and framework-neutral so native clients can
 * reuse the same policy later.
 */
export function buildSpatialNavigationPlan(input: {
  route: Route3DHighlight | null;
  userLocation: Location | null;
  speedMps?: number | null;
  scene?: SceneContext | null;
  snapshot?: NavigationEngineSnapshot | null;
  sceneAgeMs?: number | null;
}): SpatialNavigationPlan {
  const { route, userLocation, scene = null, snapshot = null, sceneAgeMs = null } = input;
  if (!route || !route.maneuvers.length) {
    return {
      maneuver: null,
      distanceToManeuverMeters: null,
      experience: null,
      presentation: 'map',
      intersection: deriveIntersectionIntelligence(null, null, null, null),
      guidance: null,
      confidence: null,
      recovery: null,
      fallback: null,
      composition: null,
      reason: 'no-route-maneuver',
    };
  }

  const coords = route.segments.flatMap((segment) => segment.coords.map(({ lat, lng }) => ({ lat, lng })));
  const projection = userLocation && coords.length >= 2 ? projectOntoPolyline(userLocation, coords) : null;
  const upcoming = route.maneuvers
    .map((maneuver) => ({ maneuver, projection: coords.length >= 2 ? projectOntoPolyline(maneuver.location, coords) : null }))
    .filter((item) => !projection || !item.projection || item.projection.distanceAlongMeters >= projection.distanceAlongMeters - 8)
    .sort((a, b) => (a.projection?.distanceAlongMeters ?? Number.POSITIVE_INFINITY) - (b.projection?.distanceAlongMeters ?? Number.POSITIVE_INFINITY));

  const selected = upcoming[0] ?? route.maneuvers[0];
  const maneuver = selected.maneuver;
  const distanceToManeuverMeters = projection && selected.projection
    ? Math.max(0, selected.projection.distanceAlongMeters - projection.distanceAlongMeters)
    : null;

  const incoming = scene?.roads?.find((road) => road.geometry.some((p) => Math.abs(p.lat - maneuver.location.lat) < 0.00035 && Math.abs(p.lng - maneuver.location.lng) < 0.00035)) ?? null;
  const outgoing = scene?.roads?.find((road) => road !== incoming && road.geometry.some((p) => Math.abs(p.lat - maneuver.location.lat) < 0.00035 && Math.abs(p.lng - maneuver.location.lng) < 0.00035)) ?? null;
  const intersection = deriveIntersectionIntelligence(maneuver, incoming, outgoing, distanceToManeuverMeters);
  const experience = decideManeuverExperience(maneuver, Math.max(0, input.speedMps ?? snapshot?.speedMps ?? 0), distanceToManeuverMeters ?? Number.POSITIVE_INFINITY);
  const laneConfidence = snapshot?.currentLane?.confidence ?? 0;
  const matchedConfidence = snapshot?.matched?.confidence ?? 0;
  const currentLane = snapshot?.currentLane?.laneIndex ?? null;
  const guidance = buildSceneGuidancePlan(route, maneuver, currentLane, Math.max(laneConfidence, matchedConfidence), scene);
  const confidence = guidance ? buildSceneConfidence(guidance, Math.max(laneConfidence, matchedConfidence), userLocation, route, scene) : null;
  const recovery = confidence ? buildSceneRecoveryPlan({ confidence, sceneAgeMs }) : null;
  const fallback = confidence && guidance
    ? buildDriverGuidanceFallback(confidence, (maneuver.lanes?.length ?? 0) > 0, guidance.connectorTopology.connectors.some((c) => c.points.length >= 2))
    : null;
  const composition = confidence && recovery && fallback ? buildSceneComposition(confidence, recovery, fallback) : null;

  const healthConfidence = snapshot?.health.confidence ?? 1;
  const trustworthy = healthConfidence >= 0.25 && clamp(confidence?.overall ?? 0.5) >= 0.25;
  let presentation: SpatialPresentationMode = 'map';
  let reason = 'outside-preview-window';
  if (trustworthy && distanceToManeuverMeters !== null) {
    if (distanceToManeuverMeters <= experience.triggerDistanceMeters && experience.importance >= 0.55) {
      presentation = 'immersive';
      reason = intersection.complexity === 'complex' ? 'complex-junction-immersive' : 'high-value-maneuver-immersive';
    } else if (distanceToManeuverMeters <= experience.preloadDistanceMeters) {
      presentation = 'prepare';
      reason = 'approach-preparation';
    }
  }

  return { maneuver, distanceToManeuverMeters, experience, presentation, intersection, guidance, confidence, recovery, fallback, composition, reason };
}
