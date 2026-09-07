import { Location } from '../types';
import { bearingDegrees, haversineDistanceMeters } from '../utils/geo';

export type SceneLodTier = 'near' | 'mid' | 'far' | 'hidden';
export type SceneLodKind = 'road' | 'building' | 'tree' | 'street-lamp' | 'signal' | 'crossing' | 'stop' | 'label' | 'lane-marking' | 'billboard' | 'road-sign';

export interface SceneLodPolicy {
  nearMeters: number;
  midMeters: number;
  farMeters: number;
  nearFovDegrees: number;
  midFovDegrees: number;
  farFovDegrees: number;
}

export const IMMERSIVE_SCENE_LOD: SceneLodPolicy = { nearMeters: 120, midMeters: 240, farMeters: 380, nearFovDegrees: 150, midFovDegrees: 112, farFovDegrees: 82 };

export function sceneLodPolicyForQuality(tier: 'high' | 'balanced' | 'performance'): SceneLodPolicy {
  const distances = tier === 'high' ? [140, 280, 450] : tier === 'performance' ? [90, 180, 280] : [120, 240, 380];
  return { nearMeters: distances[0], midMeters: distances[1], farMeters: distances[2], nearFovDegrees: 150, midFovDegrees: 112, farFovDegrees: 82 };
}

const angleDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function sceneLodTier(distanceMeters: number, policy = IMMERSIVE_SCENE_LOD): SceneLodTier {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 'hidden';
  if (distanceMeters <= policy.nearMeters) return 'near';
  if (distanceMeters <= policy.midMeters) return 'mid';
  if (distanceMeters <= policy.farMeters) return 'far';
  return 'hidden';
}

export function isSceneObjectVisible(
  center: Location,
  objectLocation: Location,
  headingDegrees: number | null,
  policy = IMMERSIVE_SCENE_LOD,
): boolean {
  const distance = haversineDistanceMeters(center, objectLocation);
  const tier = sceneLodTier(distance, policy);
  if (tier === 'hidden') return false;
  if (headingDegrees == null || tier === 'near') return true;
  const bearing = bearingDegrees(center, objectLocation);
  const fov = tier === 'mid' ? policy.midFovDegrees : policy.farFovDegrees;
  return angleDelta(headingDegrees, bearing) <= fov / 2;
}

export function sceneLodForObject(
  kind: SceneLodKind,
  center: Location,
  objectLocation: Location,
  headingDegrees: number | null,
  policy = IMMERSIVE_SCENE_LOD,
): SceneLodTier {
  const distance = haversineDistanceMeters(center, objectLocation);
  const tier = sceneLodTier(distance, policy);
  if (tier === 'hidden') return 'hidden';
  if (!isSceneObjectVisible(center, objectLocation, headingDegrees, policy)) return 'hidden';

  // Small/high-frequency objects disappear earlier. Large road/building forms
  // remain useful farther away, while lane paint and labels are kept local.
  if (kind === 'lane-marking' || kind === 'street-lamp') return tier === 'far' ? 'hidden' : tier;
  // Billboards are large roadside objects: keep them visible into the far
  // field, but still cull them outside the driver's forward view.
  if (kind === 'billboard' || kind === 'road-sign') return tier;
  if (kind === 'signal' || kind === 'crossing' || kind === 'stop') return tier === 'far' ? 'hidden' : tier;
  return tier;
}
