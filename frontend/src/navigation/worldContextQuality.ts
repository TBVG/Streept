import { SpatialWorldContext } from './worldContext';

export interface WorldContextQuality {
  confidence: number;
  evidenceCount: number;
  strongEvidenceCount: number;
  degraded: boolean;
  summary: string;
}

export function assessWorldContextQuality(context: SpatialWorldContext): WorldContextQuality {
  const evidenceCount = context.parking.length + context.billboards.length + context.reportsNearby + context.trafficNearby;
  const strongEvidenceCount = context.parking.filter(p => p.intelligence.confidence >= 0.8 && p.intelligence.availableSpaces > 0).length
    + context.billboards.filter(b => b.active && b.confidence >= 0.8).length;
  const confidence = Math.max(0, Math.min(1, context.confidence * 0.8 + Math.min(0.3, strongEvidenceCount * 0.18)));
  const degraded = confidence < 0.45;
  const summary = degraded ? 'Limited spatial evidence' : strongEvidenceCount > 0 ? 'Multiple spatial signals available' : 'Core navigation context available';
  return { confidence, evidenceCount, strongEvidenceCount, degraded, summary };
}
