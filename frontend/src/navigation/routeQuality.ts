import { Location, Report, Route3DHighlight } from '../types';
import { projectOntoPolyline } from '../utils/geo';

const HIGH_RISK: Record<Report['type'], number> = {
  closed_lane: 90,
  accident: 75,
  construction: 55,
  traffic_jam: 45,
  hazard: 35,
  cop: 5,
};

function routePolyline(route: Route3DHighlight): Location[] {
  return route.segments.flatMap((s) => s.coords.map((c) => ({ lat: c.lat, lng: c.lng })));
}

function hazardPenalty(route: Route3DHighlight, reports: Report[]): number {
  const polyline = routePolyline(route);
  if (polyline.length < 2) return 0;
  let penalty = 0;
  for (const report of reports) {
    const ageMs = Date.now() - new Date(report.reported_at).getTime();
    const ttlMs = new Date(report.expires_at).getTime() - new Date(report.reported_at).getTime();
    const freshness = ttlMs > 0 ? Math.max(0, Math.min(1, 1 - ageMs / ttlMs)) : 0.2;
    if (freshness <= 0) continue;
    const projection = projectOntoPolyline(report.location, polyline);
    if (!projection || projection.distanceFromLineMeters > 80) continue;
    const proximity = Math.max(0, 1 - projection.distanceFromLineMeters / 80);
    const confirmationBoost = 1 + Math.min(0.5, Math.max(0, report.confirmations ?? 0) * 0.04);
    const confidence = Math.max(0.25, Math.min(1, report.confidence ?? 0.55));
    penalty += HIGH_RISK[report.type] * freshness * proximity * confirmationBoost * confidence;
  }
  return penalty;
}

export function scoreRoute(route: Route3DHighlight, reports: Report[] = []): number {
  const time = route.duration_seconds ?? 3600;
  const distance = route.distance_meters ?? 100000;
  const complex = route.maneuvers.filter((m) => m.is_complex).length;
  const turns = route.maneuvers.length;
  return time + distance * 0.035 + turns * 4 + complex * 10 + hazardPenalty(route, reports) * 1.4;
}

export function rankRoutesWithRisk(routes: Route3DHighlight[], reports: Report[] = []): Route3DHighlight[] {
  return [...routes].sort((a, b) => scoreRoute(a, reports) - scoreRoute(b, reports));
}

export function routeRiskSummary(route: Route3DHighlight | null, reports: Report[] = []): { count: number; severity: number } {
  if (!route) return { count: 0, severity: 0 };
  const polyline = routePolyline(route);
  let count = 0;
  let severity = 0;
  for (const report of reports) {
    const projection = projectOntoPolyline(report.location, polyline);
    if (!projection || projection.distanceFromLineMeters > 80) continue;
    const risk = HIGH_RISK[report.type] ?? 0;
    if (risk > 0) { count += 1; severity += risk * Math.max(0.2, 1 - projection.distanceFromLineMeters / 80); }
  }
  return { count, severity: Math.round(severity) };
}


export function routeTrafficRisk(route: Route3DHighlight, reports: Report[] = []): number {
  return Math.min(100, Math.max(0, Math.round(hazardPenalty(route, reports))));
}
