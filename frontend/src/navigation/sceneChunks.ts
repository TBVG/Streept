import { Location, SceneBuilding, SceneContext, SceneCoord, ScenePoint, SceneRoad, SceneRestriction, SceneTree } from '../types';
import { dedupeSceneObjects } from './sceneObjectIdentity';

export interface SceneChunk {
  key: string;
  center: Location;
  scene: SceneContext;
}

const CHUNK_SIZE_METERS = 180;
const metersPerLng = (lat: number) => 111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
const pointOfGeometry = (geometry: SceneCoord[]): Location | null => {
  if (!geometry.length) return null;
  const sum = geometry.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / geometry.length, lng: sum.lng / geometry.length };
};
const pointKey = (p: Location) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

export const sceneChunkKey = (center: Location, origin: Location): string => {
  const x = Math.floor(((center.lng - origin.lng) * metersPerLng(origin.lat)) / CHUNK_SIZE_METERS);
  const y = Math.floor(((center.lat - origin.lat) * 111320) / CHUNK_SIZE_METERS);
  return `${x}:${y}`;
};

export const splitSceneIntoChunks = (scene: SceneContext | null, origin: Location | null, chunkSizeMeters = CHUNK_SIZE_METERS): SceneChunk[] => {
  if (!scene || !origin) return [];
  const buckets = new Map<string, { center: Location; buildings: SceneBuilding[]; roads: SceneRoad[]; signals: ScenePoint[]; crossings: ScenePoint[]; stops: ScenePoint[]; trees: SceneTree[]; street_lamps: ScenePoint[]; restrictions: SceneRestriction[] }>();
  const keyFor = (center: Location) => {
    // Absolute geographic buckets keep identities stable as the active scene
    // bubble moves; they must not depend on the current driver's origin.
    const x = Math.floor((center.lng * 111320) / chunkSizeMeters);
    const y = Math.floor((center.lat * 111320) / chunkSizeMeters);
    return `${x}:${y}`;
  };
  const bucket = (center: Location) => {
    const key = keyFor(center);
    let b = buckets.get(key);
    if (!b) { b = { center, buildings: [], roads: [], signals: [], crossings: [], stops: [], trees: [], street_lamps: [], restrictions: [] }; buckets.set(key, b); }
    return b;
  };
  // Normalize duplicate records before assigning ownership to a spatial chunk.
  // This matters when adjacent scene bubbles overlap the same OSM extract.
  const unique = dedupeSceneObjects(scene);
  unique.buildings.forEach((item) => { const p = pointOfGeometry(item.geometry); if (p) bucket(p).buildings.push(item); });
  unique.roads.forEach((item) => { const p = pointOfGeometry(item.geometry); if (p) bucket(p).roads.push(item); });
  unique.signals.forEach((item) => bucket(item).signals.push(item));
  unique.crossings.forEach((item) => bucket(item).crossings.push(item));
  unique.stops.forEach((item) => bucket(item).stops.push(item));
  unique.trees.forEach((item) => bucket(item).trees.push(item));
  unique.street_lamps.forEach((item) => bucket(item).street_lamps.push(item));
  // Restrictions are topology metadata rather than visible geometry. Keep
  // them with the chunk of their first known via node/way when possible; if
  // no spatial anchor exists, put them in the origin chunk.
  unique.restrictions.forEach((item) => bucket(origin).restrictions.push(item));
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, b]) => ({
    key,
    center: b.center,
    scene: { buildings: b.buildings, roads: b.roads, signals: b.signals, crossings: b.crossings, stops: b.stops, trees: b.trees, street_lamps: b.street_lamps, restrictions: b.restrictions },
  }));
};

export const sceneChunkPlanKey = (chunks: SceneChunk[]): string => chunks.map((chunk) => `${chunk.key}:${pointKey(chunk.center)}`).join('|');
