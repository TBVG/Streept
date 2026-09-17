import { Location, Report, TrafficVehicle, WsEvent } from '../types';

export interface LiveTrafficStreamSnapshot {
  reports: Report[];
  vehicles: TrafficVehicle[];
  updatedAtMs: number;
}

export interface LiveTrafficStreamOptions {
  staleAfterMs?: number;
  maxReports?: number;
  vehicleStaleAfterMs?: number;
  maxVehicles?: number;
}

/**
 * Client-side convergence layer for the real backend traffic feeds.
 *
 * REST /traffic is the authoritative resync path. The /ws report events are
 * the low-latency delta path. Keeping both behind one store prevents a stale
 * polling response from overwriting a newer WebSocket event and gives the
 * navigation engine one consistent traffic snapshot.
 *
 * This class intentionally stores incidents/reports only. It does not invent
 * lane-positioned vehicles: those require an explicit vehicle telemetry
 * provider and are therefore represented separately by future adapters.
 */
const LIVE_TRAFFIC_TYPES = new Set<Report['type']>(['accident', 'traffic_jam', 'construction', 'closed_lane', 'hazard']);

export class LiveTrafficStream {
  private readonly staleAfterMs: number;
  private readonly maxReports: number;
  private readonly vehicleStaleAfterMs: number;
  private readonly maxVehicles: number;
  private reports = new Map<string, Report>();
  private reportUpdatedAt = new Map<string, number>();
  private reportRemovedAt = new Map<string, number>();
  private vehicles = new Map<string, TrafficVehicle>();
  private vehicleUpdatedAt = new Map<string, number>();
  private vehicleRemovedAt = new Map<string, number>();
  private updatedAtMs = 0;

  constructor(options: LiveTrafficStreamOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
    this.maxReports = options.maxReports ?? 200;
    this.vehicleStaleAfterMs = options.vehicleStaleAfterMs ?? 20_000;
    this.maxVehicles = options.maxVehicles ?? 2000;
  }

  replace(reports: Report[], nowMs = Date.now()): LiveTrafficStreamSnapshot {
    for (const report of reports) {
      if (!LIVE_TRAFFIC_TYPES.has(report.type)) continue;
      const removedAt = this.reportRemovedAt.get(report.id);
      // A REST snapshot has no server-side deletion sequence number. After a
      // WebSocket deletion, briefly tombstone the id so an already-in-flight
      // REST response cannot immediately resurrect the removed object.
      if (removedAt != null && nowMs - removedAt < this.staleAfterMs) continue;
      const previous = this.reportUpdatedAt.get(report.id) ?? -Infinity;
      // REST responses can arrive out of order. reported_at is the server's
      // event timestamp; never let an older snapshot erase a newer delta.
      const eventMs = Date.parse(report.reported_at) || nowMs;
      if (eventMs >= previous) {
        this.reports.set(report.id, report);
        this.reportUpdatedAt.set(report.id, eventMs);
        this.reportRemovedAt.delete(report.id);
      }
    }
    this.updatedAtMs = nowMs;
    return this.snapshot(nowMs);
  }

  replaceVehicles(vehicles: TrafficVehicle[], nowMs = Date.now()): LiveTrafficStreamSnapshot {
    for (const vehicle of vehicles) {
      if (!isUsableVehicle(vehicle)) continue;
      const eventMs = Date.parse(vehicle.observed_at) || nowMs;
      const removedAt = this.vehicleRemovedAt.get(vehicle.id);
      if (removedAt != null && nowMs - removedAt < this.vehicleStaleAfterMs) continue;
      const previous = this.vehicleUpdatedAt.get(vehicle.id) ?? -Infinity;
      if (eventMs >= previous) {
        this.vehicles.set(vehicle.id, vehicle);
        this.vehicleUpdatedAt.set(vehicle.id, eventMs);
        this.vehicleRemovedAt.delete(vehicle.id);
      }
    }
    this.updatedAtMs = nowMs;
    return this.snapshot(nowMs);
  }

  ingest(event: WsEvent, nowMs = Date.now()): LiveTrafficStreamSnapshot {
    if (event.type === 'report_created' || event.type === 'report_updated') {
      const report = event.report;
      if (!LIVE_TRAFFIC_TYPES.has(report.type)) return this.snapshot(nowMs);
      const eventMs = Date.parse(report.reported_at) || nowMs;
      const previous = Math.max(
        this.reportUpdatedAt.get(report.id) ?? -Infinity,
        this.reportRemovedAt.get(report.id) ?? -Infinity,
      );
      if (eventMs >= previous) {
        this.reports.set(report.id, report);
        this.reportUpdatedAt.set(report.id, eventMs);
        this.reportRemovedAt.delete(report.id);
      }
    } else if (event.type === 'report_removed') {
      this.reports.delete(event.id);
      this.reportUpdatedAt.delete(event.id);
      this.reportRemovedAt.set(event.id, nowMs);
    } else if (event.type === 'traffic_vehicle_updated') {
      const vehicle = event.vehicle;
      if (isUsableVehicle(vehicle)) {
        const eventMs = Date.parse(vehicle.observed_at) || nowMs;
        const previous = Math.max(
          this.vehicleUpdatedAt.get(vehicle.id) ?? -Infinity,
          this.vehicleRemovedAt.get(vehicle.id) ?? -Infinity,
        );
        if (eventMs >= previous) {
          this.vehicles.set(vehicle.id, vehicle);
          this.vehicleUpdatedAt.set(vehicle.id, eventMs);
          this.vehicleRemovedAt.delete(vehicle.id);
        }
      }
    } else if (event.type === 'traffic_vehicle_removed') {
      this.vehicles.delete(event.id);
      this.vehicleUpdatedAt.delete(event.id);
      this.vehicleRemovedAt.set(event.id, nowMs);
    }
    this.updatedAtMs = nowMs;
    return this.snapshot(nowMs);
  }

  snapshot(nowMs = this.updatedAtMs || Date.now()): LiveTrafficStreamSnapshot {
    this.prune(nowMs);
    const reports = [...this.reports.values()]
      .sort((a, b) => Date.parse(b.reported_at) - Date.parse(a.reported_at))
      .slice(0, this.maxReports);
    const vehicles = [...this.vehicles.values()]
      .filter((vehicle) => isFreshVehicle(vehicle, nowMs, this.vehicleStaleAfterMs))
      .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
      .slice(0, this.maxVehicles);
    return { reports, vehicles, updatedAtMs: this.updatedAtMs || nowMs };
  }

  nearby(location: Location, radiusMeters: number, nowMs = Date.now()): Report[] {
    const snapshot = this.snapshot(nowMs);
    return snapshot.reports.filter((report) => distanceMeters(location, report.location) <= radiusMeters);
  }

  vehiclesNearby(location: Location, radiusMeters: number, nowMs = Date.now()): TrafficVehicle[] {
    const snapshot = this.snapshot(nowMs);
    return snapshot.vehicles.filter((vehicle) => distanceMeters(location, vehicle.location) <= radiusMeters);
  }

  clear(): void {
    this.reports.clear();
    this.reportUpdatedAt.clear();
    this.reportRemovedAt.clear();
    this.vehicles.clear();
    this.vehicleUpdatedAt.clear();
    this.vehicleRemovedAt.clear();
    this.updatedAtMs = 0;
  }

  private prune(nowMs: number): void {
    for (const [id, report] of this.reports) {
      const expiresAt = Date.parse(report.expires_at);
      const tooOld = nowMs - (Date.parse(report.reported_at) || nowMs) > this.staleAfterMs;
      if ((Number.isFinite(expiresAt) && expiresAt <= nowMs) || tooOld) {
        this.reports.delete(id);
        this.reportUpdatedAt.delete(id);
      }
    }
    for (const [id, vehicle] of this.vehicles) {
      if (!isFreshVehicle(vehicle, nowMs, this.vehicleStaleAfterMs)) {
        this.vehicles.delete(id);
        this.vehicleUpdatedAt.delete(id);
      }
    }
    for (const [id, removedAt] of this.reportRemovedAt) {
      if (nowMs - removedAt >= this.staleAfterMs) this.reportRemovedAt.delete(id);
    }
    for (const [id, removedAt] of this.vehicleRemovedAt) {
      if (nowMs - removedAt >= this.vehicleStaleAfterMs) this.vehicleRemovedAt.delete(id);
    }
  }
}

function isUsableVehicle(vehicle: TrafficVehicle): boolean {
  return Number.isFinite(vehicle.location.lat) && Number.isFinite(vehicle.location.lng)
    && vehicle.location.lat >= -90 && vehicle.location.lat <= 90
    && vehicle.location.lng >= -180 && vehicle.location.lng <= 180
    && Number.isFinite(vehicle.confidence) && vehicle.confidence >= 0 && vehicle.confidence <= 1
    && Boolean(vehicle.id) && Boolean(vehicle.source)
    && Number.isFinite(Date.parse(vehicle.observed_at));
}

function isFreshVehicle(vehicle: TrafficVehicle, nowMs: number, staleAfterMs: number): boolean {
  const observedMs = Date.parse(vehicle.observed_at);
  return Number.isFinite(observedMs) && nowMs - observedMs <= staleAfterMs;
}

function distanceMeters(a: Location, b: Location): number {
  const lat = ((a.lat + b.lat) * 0.5 * Math.PI) / 180;
  return Math.hypot(
    (b.lat - a.lat) * 110540,
    (b.lng - a.lng) * 111320 * Math.max(0.2, Math.cos(lat)),
  );
}
