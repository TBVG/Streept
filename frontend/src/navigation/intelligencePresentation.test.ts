import { describe, expect, it } from 'vitest';
import { presentNavigationIntelligence } from './intelligencePresentation';

const base: any = {
  spatialMemory: { current: { predictedScore: 0, confidence: 0, signal: 'stable', reasons: [] } },
  roadIntelligence: { score: 0, confidence: 0 },
  spatialIntelligence: { intersectionIntelligence: null },
};

describe('intelligence presentation', () => {
  it('stays quiet for unknown roads', () => expect(presentNavigationIntelligence(base).level).toBe('clear'));
  it('escalates elevated predictions', () => expect(presentNavigationIntelligence({ ...base, spatialMemory: { current: { predictedScore: 84, confidence: .7, signal: 'elevated', reasons: ['community pattern matches this time'] } } }).level).toBe('high-attention'));
});
