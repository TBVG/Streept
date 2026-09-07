import { Location, Route3DHighlight, SceneContext } from '../types';
import { SceneGuidancePlan } from './sceneGuidance';
import { haversineDistanceMeters } from '../utils/geo';

export interface SceneConfidence {
  overall: number;
  lane: number;
  topology: number;
  gps: number;
  scene: number;
  guidanceAlpha: number;
  branchAlpha: number;
}

function clamp(value: number, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }

/**
 * Fuses the confidence already produced by navigation subsystems into a
 * renderer-facing score. It never upgrades an uncertain source into a strong
 * claim; low-confidence inputs can only weaken visual authority.
 */
export function buildSceneConfidence(
  plan: SceneGuidancePlan,
  currentLaneConfidence: number,
  userLocation: Location | null,
  route: Route3DHighlight,
  scene: SceneContext | null,
): SceneConfidence {
  const lane = clamp(Math.min(plan.laneConfidence, currentLaneConfidence > 0 ? currentLaneConfidence : plan.laneConfidence));
  const connectorScores = plan.connectorTopology.connectors
    .map((connector) => connector.confidence)
    .filter(Number.isFinite);
  const topology = connectorScores.length
    ? clamp(Math.max(...connectorScores))
    : clamp(scene?.roads?.length ? 0.58 : 0.35);

  const coords = route.segments.flatMap((segment) => segment.coords);
  let gps = 0.45;
  if (userLocation && coords.length) {
    const nearest = Math.min(...coords.slice(0, Math.min(coords.length, 160)).map((point) => haversineDistanceMeters(userLocation, point)));
    gps = clamp(1 - nearest / 55, 0.25, 0.98);
  } else if (currentLaneConfidence > 0) {
    gps = clamp(currentLaneConfidence);
  }

  const sceneCoverage = scene
    ? clamp((Math.min(scene.roads.length, 12) / 12) * 0.72 + (scene.restrictions?.length ? 0.18 : 0.08), 0.2, 0.92)
    : 0.35;
  const overall = clamp(lane * 0.40 + topology * 0.30 + gps * 0.20 + sceneCoverage * 0.10, 0.2, 0.98);

  return {
    overall,
    lane,
    topology,
    gps,
    scene: sceneCoverage,
    guidanceAlpha: 0.48 + overall * 0.50,
    branchAlpha: 0.16 + overall * 0.78,
  };
}
