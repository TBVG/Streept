import { Location, SceneContext, TrafficVehicle } from '../types';
import { buildLaneCenterline } from './laneGeometry';
import { bearingDegrees } from '../utils/geo';

export interface Traffic3DRenderCandidate {
  id: string;
  location: Location;
  headingDegrees: number;
  confidence: number;
  laneSnapped: boolean;
  wayId: number | null;
  laneIndex: number | null;
}

export interface LiveTraffic3DOptions {
  nowMs?: number;
  maxAgeMs?: number;
  maxDistanceMeters?: number;
  maxVehicles?: number;
}

const DEFAULT_MAX_AGE_MS = 20_000;
const DEFAULT_MAX_DISTANCE_METERS = 350;
const DEFAULT_MAX_VEHICLES = 120;

const distanceMeters = (a: Location, b: Location) => {
  const latScale = 110540;
  const lngScale = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * latScale, (a.lng - b.lng) * lngScale);
};

function nearestPoint(points: Location[], target: Location): { point: Location; distance: number; index: number; t: number } | null {
  let best: { point: Location; distance: number; index: number; t: number } | null = null;
  const latScale = 110540;
  const lngScale = 111320 * Math.cos((target.lat * Math.PI) / 180);
  for (let i = 0; i < points.length - 1; i += 1) {
    const ax = (points[i].lng - target.lng) * lngScale;
    const ay = (points[i].lat - target.lat) * latScale;
    const bx = (points[i + 1].lng - target.lng) * lngScale;
    const by = (points[i + 1].lat - target.lat) * latScale;
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;
    const t = denom > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denom)) : 0;
    const point = { lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t, lng: points[i].lng + (points[i + 1].lng - points[i].lng) * t };
    const distance = distanceMeters(point, target);
    if (!best || distance < best.distance) best = { point, distance, index: i, t };
  }
  return best;
}

function laneLocation(vehicle: TrafficVehicle, scene: SceneContext): { location: Location; headingDegrees: number; distance: number } | null {
  if (vehicle.way_id == null || vehicle.lane_index == null) return null;
  const road = scene.roads.find((candidate) => candidate.osm_id === vehicle.way_id);
  if (!road) return null;
  const laneCount = road.lanes ?? 1;
  const lane = buildLaneCenterline(road, vehicle.lane_index, laneCount);
  if (!lane || lane.points.length < 2) return null;
  const points = road.oneway_reverse ? [...lane.points].reverse() : lane.points;
  const nearest = nearestPoint(points, vehicle.location);
  if (!nearest || nearest.distance > 18) return null;
  const heading = bearingDegrees(points[nearest.index], points[Math.min(points.length - 1, nearest.index + 1)]);
  return { location: nearest.point, headingDegrees: heading, distance: nearest.distance };
}

export function buildLiveTraffic3D(
  vehicles: TrafficVehicle[],
  userLocation: Location | null,
  scene: SceneContext | null,
  options: LiveTraffic3DOptions = {},
): Traffic3DRenderCandidate[] {
  if (!userLocation) return [];
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxDistanceMeters = options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
  const maxVehicles = options.maxVehicles ?? DEFAULT_MAX_VEHICLES;

  return vehicles
    .filter((vehicle) => vehicle.id && Number.isFinite(vehicle.location.lat) && Number.isFinite(vehicle.location.lng))
    .map((vehicle) => {
      const observed = Date.parse(vehicle.observed_at);
      const age = Number.isFinite(observed) ? Math.max(0, nowMs - observed) : Number.POSITIVE_INFINITY;
      const distance = distanceMeters(userLocation, vehicle.location);
      if (age > maxAgeMs || vehicle.confidence < 0.25 || distance > maxDistanceMeters) return null;
      const snapped = scene ? laneLocation(vehicle, scene) : null;
      const heading = vehicle.heading_degrees != null && Number.isFinite(vehicle.heading_degrees)
        ? vehicle.heading_degrees
        : snapped?.headingDegrees ?? 0;
      return {
        id: vehicle.id,
        location: snapped?.location ?? vehicle.location,
        headingDegrees: heading,
        confidence: vehicle.confidence,
        laneSnapped: Boolean(snapped),
        wayId: vehicle.way_id,
        laneIndex: vehicle.lane_index,
      };
    })
    .filter((candidate): candidate is Traffic3DRenderCandidate => Boolean(candidate))
    .sort((a, b) => distanceMeters(userLocation, a.location) - distanceMeters(userLocation, b.location))
    .slice(0, maxVehicles);
}
