import { SceneBuilding, ScenePoint, SceneRoad, SceneRestriction, SceneTree } from '../types';

export type SceneObjectType = 'building' | 'road' | 'signal' | 'crossing' | 'stop' | 'tree' | 'street-lamp' | 'restriction';

type GeometryObject = { osm_id?: number | null; node_ids?: number[]; geometry?: Array<{ lat: number; lng: number }> };

const pointKey = (point: { lat: number; lng: number }) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;

export function sceneObjectIdentity(type: SceneObjectType | string, object: GeometryObject | ScenePoint | SceneTree | SceneRestriction): string {
  const candidate = object as GeometryObject;
  if (candidate.osm_id != null) return `${type}:osm:${candidate.osm_id}`;
  if (candidate.node_ids?.length) return `${type}:nodes:${candidate.node_ids.join(',')}`;
  const geometry = candidate.geometry;
  if (Array.isArray(geometry) && geometry.length) {
    return `${type}:geo:${geometry.map(pointKey).join(';')}`;
  }
  if ('lat' in object && 'lng' in object) return `${type}:point:${pointKey(object)}`;
  if ('restriction' in object) {
    const restriction = object as SceneRestriction;
    return `${type}:restriction:${restriction.restriction}:${(restriction.from_way_ids ?? []).join(',')}:${(restriction.to_way_ids ?? []).join(',')}:${(restriction.via_node_ids ?? []).join(',')}:${(restriction.via_way_ids ?? []).join(',')}`;
  }
  return `${type}:unknown`;
}

export interface SceneObjectIdentityCounts {
  building: number;
  road: number;
  signal: number;
  crossing: number;
  stop: number;
  tree: number;
  'street-lamp': number;
  restriction: number;
}

/**
 * De-duplicates OSM scene objects before they become Cesium entities/primitives.
 * This is intentionally renderer-neutral so overlapping scene bubbles can share
 * one deterministic physical representation instead of multiplying geometry.
 */
export function dedupeSceneObjects(scene: {
  buildings: SceneBuilding[];
  roads: SceneRoad[];
  signals: ScenePoint[];
  crossings: ScenePoint[];
  stops: ScenePoint[];
  trees: SceneTree[];
  street_lamps?: ScenePoint[];
  restrictions?: SceneRestriction[];
}) {
  const dedupe = (items: any[], type: SceneObjectType): any[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = sceneObjectIdentity(type, item as any);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  return {
    buildings: dedupe(scene.buildings, 'building'),
    roads: dedupe(scene.roads, 'road'),
    signals: dedupe(scene.signals, 'signal'),
    crossings: dedupe(scene.crossings, 'crossing'),
    stops: dedupe(scene.stops, 'stop'),
    trees: dedupe(scene.trees, 'tree'),
    street_lamps: dedupe(scene.street_lamps ?? [], 'street-lamp'),
    restrictions: dedupe(scene.restrictions ?? [], 'restriction'),
  };
}
