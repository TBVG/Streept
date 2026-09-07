import { RouteCoord, SceneRoad } from '../types';
import { bearingDegrees, destinationPoint } from '../utils/geo';
import { laneCenterOffsetMeters } from './sceneGuidance';

export interface LaneCenterline {
  laneIndex: number;
  laneCount: number;
  points: RouteCoord[];
  widthMeters: number;
  lengthMeters: number;
}

function tangentBearing(points: RouteCoord[], index: number): number {
  const i = Math.max(0, Math.min(points.length - 1, index));
  if (i === 0) return bearingDegrees(points[0], points[1]);
  // At a polyline vertex use the incoming tangent. This keeps the lane offset
  // anchored to the travelled carriageway segment instead of bisecting a sharp
  // corner and visibly shifting the lane centerline away from the road geometry.
  return bearingDegrees(points[i - 1], points[i]);
}

/**
 * Builds a lane centerline by offsetting every road geometry vertex from the
 * road centerline. Unlike a single perpendicular at a junction, this follows
 * the road's curvature and gives the 3D renderer a real lane corridor.
 */
export function buildLaneCenterline(
  road: SceneRoad,
  laneIndex: number,
  laneCount = road.lanes ?? 1,
  roadWidthMeters = Math.max(5.5, Math.min(24, laneCount * 3.3)),
): LaneCenterline | null {
  if (road.geometry.length < 2 || laneCount < 1 || laneIndex < 0 || laneIndex >= laneCount) return null;
  const roadPoints: RouteCoord[] = road.geometry.map((point) => ({ ...point, alt: 0 }));
  const points = roadPoints.map((point, index) => {
    const bearing = tangentBearing(roadPoints, index);
    return destinationPoint(point, (bearing + 90) % 360, laneCenterOffsetMeters(laneIndex, laneCount, roadWidthMeters));
  });
  let lengthMeters = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]; const b = points[i];
    lengthMeters += Math.hypot((b.lat - a.lat) * 110540, (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(a.lat * Math.PI / 180)));
  }
  return { laneIndex, laneCount, points, widthMeters: roadWidthMeters / laneCount, lengthMeters };
}

export function buildRoadLaneCenterlines(
  road: SceneRoad,
  laneCount = road.lanes ?? 1,
): LaneCenterline[] {
  return Array.from({ length: Math.max(1, Math.min(8, laneCount)) }, (_, laneIndex) =>
    buildLaneCenterline(road, laneIndex, laneCount),
  ).filter((lane): lane is LaneCenterline => Boolean(lane));
}

/** Geometry ordered from the shared node outward. */
export function roadGeometryFromNode(road: SceneRoad, nodeId: number, points = 6): RouteCoord[] | null {
  const ids = road.node_ids ?? [];
  const nodeIndex = ids.indexOf(nodeId);
  if (nodeIndex < 0 || road.geometry.length < 2) return null;
  if (nodeIndex === 0) return road.geometry.slice(0, Math.min(road.geometry.length, points + 1)).map((point) => ({ ...point, alt: 0 }));
  return road.geometry.slice(Math.max(0, nodeIndex - points), nodeIndex + 1).reverse().map((point) => ({ ...point, alt: 0 }));
}

/** Geometry ordered in the direction of travel toward the shared node. */
export function roadApproachGeometry(road: SceneRoad, nodeId: number, points = 6): RouteCoord[] | null {
  const fromNode = roadGeometryFromNode(road, nodeId, points);
  return fromNode ? [...fromNode].reverse() : null;
}

export function laneHeading(points: RouteCoord[], fromStart = true): number {
  if (points.length < 2) return 0;
  return fromStart ? bearingDegrees(points[0], points[1]) : bearingDegrees(points[points.length - 2], points[points.length - 1]);
}
