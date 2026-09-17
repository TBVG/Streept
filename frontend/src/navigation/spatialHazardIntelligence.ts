import { Report } from '../types';

export type SpatialHazardLevel = 'none' | 'elevated' | 'critical';

export interface SpatialHazardIntelligence {
  level: SpatialHazardLevel;
  nearbyCriticalReports: number;
  nearbyTrafficJams: number;
  nearbyClosedLanes: number;
  confidence: number;
}

/** Conservative hazard summary from already-observed road intelligence. */
export function deriveSpatialHazardIntelligence(
  reports: Array<Pick<Report, 'location' | 'type' | 'confidence'>> = [],
  nearbyTrafficVehicles = 0,
): SpatialHazardIntelligence {
  const nearbyCriticalReports = reports.filter((report) =>
    report.type === 'accident' || report.type === 'closed_lane' || report.type === 'hazard',
  ).length;
  const nearbyTrafficJams = reports.filter((report) => report.type === 'traffic_jam').length;
  const nearbyClosedLanes = reports.filter((report) => report.type === 'closed_lane').length;

  let level: SpatialHazardLevel = 'none';
  if (nearbyCriticalReports > 0) level = 'critical';
  else if (nearbyTrafficJams > 0) level = 'elevated';

  const reportConfidence = reports.length
    ? reports.reduce((sum, report) => sum + (report.confidence == null ? 0.7 : Math.max(0, Math.min(1, report.confidence))), 0) / reports.length
    : 0;
  const confidence = level === 'none'
    ? 0
    : Math.max(0.35, Math.min(1, Math.max(reportConfidence, nearbyTrafficVehicles > 0 ? 0.5 : 0)));

  return { level, nearbyCriticalReports, nearbyTrafficJams, nearbyClosedLanes, confidence };
}
