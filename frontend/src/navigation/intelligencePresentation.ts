import { NavigationEngineSnapshot } from './navigationEngine';

export interface IntelligencePresentation {
  level: 'clear' | 'watch' | 'prepare' | 'high-attention';
  title: string;
  detail: string;
  score: number;
  confidence: number;
}

export function presentNavigationIntelligence(snapshot: NavigationEngineSnapshot): IntelligencePresentation {
  const memory = snapshot.spatialMemory;
  const junction = snapshot.spatialIntelligence.intersectionIntelligence;
  const prediction = memory.current;
  const score = Math.max(prediction.predictedScore, snapshot.roadIntelligence.score);
  const confidence = Math.max(prediction.confidence, snapshot.roadIntelligence.confidence, junction?.confidence ?? 0);
  if (junction?.complexity === 'complex' && junction.confidence >= .55 && (score >= 75)) {
    return { level: 'high-attention', title: 'Difficult junction ahead', detail: prediction.reasons[0] ?? 'Extra road intelligence is available.', score: Math.round(score), confidence };
  }
  if (prediction.signal === 'elevated') return { level: 'high-attention', title: 'Road pattern elevated', detail: prediction.reasons[0] ?? 'Streept expects higher execution difficulty ahead.', score: prediction.predictedScore, confidence: prediction.confidence };
  if (prediction.signal === 'recurring') return { level: 'prepare', title: 'Prepare for a learned pattern', detail: prediction.reasons[0] ?? 'This road has recurring difficulty.', score: prediction.predictedScore, confidence: prediction.confidence };
  if (prediction.signal === 'emerging') return { level: 'watch', title: 'Road intelligence available', detail: prediction.reasons[0] ?? 'Streept has limited learned evidence.', score: prediction.predictedScore, confidence: prediction.confidence };
  return { level: 'clear', title: 'Road looks straightforward', detail: 'No strong learned difficulty signal ahead.', score: Math.round(score), confidence };
}
