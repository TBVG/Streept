import { Location, SceneBuilding, SceneContext, SceneRoad } from '../types';

export interface SceneBudgets {
  roads: number;
  buildings: number;
  trees: number;
  streetLamps: number;
  signals: number;
  crossings: number;
  stops: number;
}

export const IMMERSIVE_SCENE_BUDGETS: SceneBudgets = {
  roads: 180,
  buildings: 180,
  trees: 90,
  streetLamps: 40,
  signals: 24,
  crossings: 18,
  stops: 18,
};

const distanceSquared = (a: Location, b: Location) => {
  const latScale = 111_320;
  const lngScale = latScale * Math.max(0.2, Math.cos(a.lat * Math.PI / 180));
  const dLat = (b.lat - a.lat) * latScale;
  const dLng = (b.lng - a.lng) * lngScale;
  return dLat * dLat + dLng * dLng;
};

const pointOfBuilding = (building: SceneBuilding): Location | null => building.geometry[0] ?? null;
const pointOfRoad = (road: SceneRoad): Location | null => road.geometry[0] ?? null;

function nearestFirst<T>(items: T[], center: Location, pointOf: (item: T) => Location | null, limit: number): T[] {
  return items
    .map((item, index) => ({ item, index, point: pointOf(item) }))
    .filter((entry) => entry.point != null)
    .sort((a, b) => distanceSquared(center, a.point!) - distanceSquared(center, b.point!) || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}

/**
 * Selects a deterministic, camera-local subset of scene objects. This keeps
 * dense OSM bubbles useful on mobile GPUs without changing the server payload.
 */
export function budgetSceneContext(scene: SceneContext, center: Location, budgets: SceneBudgets = IMMERSIVE_SCENE_BUDGETS): SceneContext {
  return {
    roads: nearestFirst(scene.roads ?? [], center, pointOfRoad, budgets.roads),
    buildings: nearestFirst(scene.buildings ?? [], center, pointOfBuilding, budgets.buildings),
    trees: nearestFirst(scene.trees ?? [], center, (p) => p, budgets.trees),
    street_lamps: nearestFirst(scene.street_lamps ?? [], center, (p) => p, budgets.streetLamps),
    signals: nearestFirst(scene.signals ?? [], center, (p) => p, budgets.signals),
    crossings: nearestFirst(scene.crossings ?? [], center, (p) => p, budgets.crossings),
    stops: nearestFirst(scene.stops ?? [], center, (p) => p, budgets.stops),
    restrictions: scene.restrictions ?? [],
  };
}

/** Pick a route sampling stride based on geometry size and scene complexity. */
export function routeRenderStride(pointCount: number, complexManeuver = false): number {
  if (pointCount <= 180) return 1;
  const base = pointCount > 1200 ? 7 : pointCount > 800 ? 5 : pointCount > 450 ? 3 : 2;
  return complexManeuver ? Math.max(1, base - 1) : base;
}
