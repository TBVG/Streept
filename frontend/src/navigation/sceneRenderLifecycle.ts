import { Location, SceneContext } from '../types';

export type SceneRenderTier = 'near' | 'far';

export interface SceneObjectKey {
  id: string;
  kind: 'road' | 'building' | 'signal' | 'crossing' | 'stop' | 'tree' | 'lamp' | 'restriction';
  tier: SceneRenderTier;
}

export interface SceneRenderPlan {
  key: string;
  objects: SceneObjectKey[];
  nearCenter: Location | null;
}

const pointKey = (p: { lat: number; lng: number }): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const geometryKey = (geometry: Array<{ lat: number; lng: number }>): string =>
  geometry.length === 0 ? 'empty' : `${pointKey(geometry[0])}>${pointKey(geometry[geometry.length - 1])}:${geometry.length}`;

/**
 * Framework-neutral identity for an OSM scene bubble. The renderer can use
 * this to decide whether a bubble is genuinely new without coupling cache
 * or network delivery to Cesium.
 */
export const buildSceneRenderPlan = (scene: SceneContext | null, nearCenter: Location | null = null): SceneRenderPlan => {
  if (!scene) return { key: 'empty', objects: [], nearCenter };
  const objects: SceneObjectKey[] = [];
  scene.roads.forEach((road, index) => objects.push({
    id: `road:${road.osm_id ?? `g-${index}`}:${geometryKey(road.geometry)}`,
    kind: 'road', tier: 'near',
  }));
  scene.buildings.forEach((building, index) => objects.push({
    id: `building:${index}:${geometryKey(building.geometry)}`,
    kind: 'building', tier: 'far',
  }));
  scene.signals.forEach((p, index) => objects.push({ id: `signal:${index}:${pointKey(p)}`, kind: 'signal', tier: 'near' }));
  scene.crossings.forEach((p, index) => objects.push({ id: `crossing:${index}:${pointKey(p)}`, kind: 'crossing', tier: 'near' }));
  scene.stops.forEach((p, index) => objects.push({ id: `stop:${index}:${pointKey(p)}`, kind: 'stop', tier: 'near' }));
  scene.trees.forEach((tree, index) => objects.push({ id: `tree:${index}:${pointKey(tree)}`, kind: 'tree', tier: 'far' }));
  (scene.street_lamps ?? []).forEach((p, index) => objects.push({ id: `lamp:${index}:${pointKey(p)}`, kind: 'lamp', tier: 'near' }));
  (scene.restrictions ?? []).forEach((restriction, index) => objects.push({ id: `restriction:${index}:${JSON.stringify(restriction)}`, kind: 'restriction', tier: 'near' }));
  return { key: objects.map((object) => object.id).join('|'), objects, nearCenter };
};

export const diffSceneRenderPlans = (previous: SceneRenderPlan | null, next: SceneRenderPlan): { added: SceneObjectKey[]; removed: SceneObjectKey[]; unchanged: SceneObjectKey[] } => {
  const previousById = new Map((previous?.objects ?? []).map((object) => [object.id, object]));
  const nextById = new Map(next.objects.map((object) => [object.id, object]));
  const added = next.objects.filter((object) => !previousById.has(object.id));
  const removed = (previous?.objects ?? []).filter((object) => !nextById.has(object.id));
  const unchanged = next.objects.filter((object) => previousById.has(object.id));
  return { added, removed, unchanged };
};
