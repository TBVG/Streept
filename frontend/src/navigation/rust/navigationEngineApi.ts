import { Report, Route3DHighlight } from '../../types';
import { RoadIntelligenceAggregate } from '../spatialIntelligenceApi';

const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

export interface RustRouteDecisionProfile {
  route_index: number;
  base_score: number;
  learned_difficulty: number;
  learned_confidence: number;
  difficult_roads: number;
  high_attention_roads: number;
  maneuver_complexity: number;
  recommendation_score: number;
  reason: string;
  way_ids: number[];
}

export interface RustNavigationAnalysis {
  routes: Route3DHighlight[];
  profiles: RustRouteDecisionProfile[];
  ranked_indices: number[];
}

/**
 * Rust owns the route decision layer. The browser sends route geometry plus
 * current observations; Rust computes risk, route scoring, learned difficulty,
 * maneuver complexity and the final route ordering.
 */
export async function analyzeNavigationRoutes(
  routes: Route3DHighlight[],
  reports: Report[],
  wayIdsByRoute: number[][] = [],
  community: RoadIntelligenceAggregate[] = [],
): Promise<RustNavigationAnalysis> {
  const response = await fetch(`${API_BASE_URL}/navigation/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routes,
      reports: reports.map((report) => ({
        type: report.type,
        location: report.location,
        reported_at: report.reported_at,
        expires_at: report.expires_at,
        confirmations: report.confirmations ?? 0,
        confidence: report.confidence ?? null,
      })),
      way_ids_by_route: wayIdsByRoute,
      community: community.map((item) => ({
        way_id: item.way_id,
        observations: item.observations,
        score: item.score,
        confidence: item.confidence,
      })),
    }),
  });

  if (!response.ok) throw new Error(`Rust navigation engine unavailable (${response.status})`);
  const payload = await response.json();
  if (!payload?.success || !payload?.data) {
    throw new Error(payload?.error?.message || 'Rust navigation analysis failed');
  }
  return payload.data as RustNavigationAnalysis;
}

export interface RustNavigationDecision {
  spatial_intelligence: {
    road_class: string;
    road_name: string | null;
    way_id: number | null;
    lane_count: number | null;
    one_way: boolean | null;
    speed_limit_kph: number | null;
    maneuver: string;
    maneuver_distance_meters: number | null;
    next_maneuver: Route3DHighlight['maneuvers'][number] | null;
    nearby_signals: number;
    nearby_crossings: number;
    nearby_stops: number;
    nearby_reports: number;
    nearby_traffic_vehicles: number;
    hazard_intelligence: { level: 'none' | 'elevated' | 'critical'; nearby_critical_reports: number; nearby_traffic_jams: number; nearby_closed_lanes: number; confidence: number };
    lane_intelligence: { current_lane_index: number | null; recommended_lane_indices: number[]; lane_alignment: 'aligned' | 'misaligned' | 'unknown'; lane_change_direction: 'left' | 'right' | 'stay' | 'unknown'; required_lane_changes: number; confidence: number };
    intersection_intelligence: { complexity: 'simple' | 'complex'; preparation_distance_meters: number; confidence: number; behavior: string };
    confidence: number;
  };
  spatial_guidance: { action: 'continue' | 'prepare' | 'slow' | 'high-alert' | 'uncertain'; confidence: number; priority: 'normal' | 'elevated' | 'critical'; reason: string; target_speed_mps: number | null };
  driver_decision: { action: 'continue' | 'prepare' | 'slow' | 'high-alert' | 'lane-change' | 'uncertain' | 'reroute'; priority: 'normal' | 'elevated' | 'critical'; confidence: number; reason: string; target_speed_mps: number | null; lane_change_direction: 'left' | 'right' | 'stay' | 'unknown'; target_lane_index: number | null };
}
