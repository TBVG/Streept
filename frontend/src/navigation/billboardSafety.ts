import { BillboardRelevance } from './billboardIntelligence';
export interface BillboardSafetyInput { distanceToManeuverMeters: number | null; maneuverCritical: boolean; speedMps: number | null; }
export interface BillboardSafety { allowed: boolean; reason: 'clear'|'maneuver-critical'|'too-close'|'unknown'; confidence: number; }
export function assessBillboardSafety(input: BillboardSafetyInput): BillboardSafety {
  if (input.maneuverCritical && input.distanceToManeuverMeters != null && input.distanceToManeuverMeters < 120) return {allowed:false,reason:'maneuver-critical',confidence:.95};
  if (input.distanceToManeuverMeters != null && input.distanceToManeuverMeters < 35) return {allowed:false,reason:'too-close',confidence:.9};
  if (input.distanceToManeuverMeters == null) return {allowed:false,reason:'unknown',confidence:.6};
  return {allowed:true,reason:'clear',confidence:.8};
}
export function filterBillboardAttention(items: BillboardRelevance[], safety: BillboardSafety): BillboardRelevance[] { return safety.allowed ? items : []; }
