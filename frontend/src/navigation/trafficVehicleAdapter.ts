import { TrafficVehicle } from '../types';
import { LaneOccupantObservation } from './laneChangeTrafficSafety';

export function toLaneOccupantObservation(vehicle: TrafficVehicle, nowMs = Date.now()): LaneOccupantObservation | null {
  const observedAtMs = Date.parse(vehicle.observed_at);
  if (!Number.isFinite(observedAtMs) || nowMs - observedAtMs > 20_000) return null;
  if (!Number.isFinite(vehicle.confidence) || vehicle.confidence < 0.35) return null;
  return {
    id: vehicle.id,
    location: vehicle.location,
    laneIndex: vehicle.lane_index,
    speedMps: vehicle.speed_mps,
    headingDegrees: vehicle.heading_degrees,
    observedAtMs,
    confidence: vehicle.confidence,
  };
}

export function toLaneOccupantObservations(vehicles: TrafficVehicle[], nowMs = Date.now()): LaneOccupantObservation[] {
  return vehicles.map((vehicle) => toLaneOccupantObservation(vehicle, nowMs)).filter((value): value is LaneOccupantObservation => value !== null);
}
