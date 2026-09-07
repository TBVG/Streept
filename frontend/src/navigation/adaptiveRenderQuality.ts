export type RenderQualityTier = 'high' | 'balanced' | 'performance';

export interface AdaptiveRenderQualityConfig {
  highFrameMs?: number;
  balancedFrameMs?: number;
  downgradeFrames?: number;
  upgradeFrames?: number;
  sampleWindow?: number;
}

export interface RenderQualityProfile {
  tier: RenderQualityTier;
  lodNearMeters: number;
  lodMidMeters: number;
  lodFarMeters: number;
  maxTrafficVehicles: number;
  maxActiveChunks: number;
  routeStrideMultiplier: number;
  highDynamicRange: boolean;
  fxaa: boolean;
  resolutionScale: number;
  frameBudgetMs: number;
}

export const RENDER_QUALITY_PROFILES: Record<RenderQualityTier, RenderQualityProfile> = {
  high: { tier: 'high', lodNearMeters: 140, lodMidMeters: 280, lodFarMeters: 450, maxTrafficVehicles: 100, maxActiveChunks: 7, routeStrideMultiplier: 1, highDynamicRange: true, fxaa: true, resolutionScale: 1, frameBudgetMs: 18 },
  balanced: { tier: 'balanced', lodNearMeters: 120, lodMidMeters: 240, lodFarMeters: 380, maxTrafficVehicles: 80, maxActiveChunks: 5, routeStrideMultiplier: 1.25, highDynamicRange: true, fxaa: true, resolutionScale: 0.9, frameBudgetMs: 24 },
  performance: { tier: 'performance', lodNearMeters: 90, lodMidMeters: 180, lodFarMeters: 280, maxTrafficVehicles: 60, maxActiveChunks: 3, routeStrideMultiplier: 1.7, highDynamicRange: false, fxaa: false, resolutionScale: 0.78, frameBudgetMs: 30 },
};

export class AdaptiveRenderQuality {
  private readonly config: Required<AdaptiveRenderQualityConfig>;
  private tier: RenderQualityTier = 'high';
  private badFrames = 0;
  private goodFrames = 0;
  private emaMs: number | null = null;
  private samples = 0;

  constructor(config: AdaptiveRenderQualityConfig = {}) {
    this.config = {
      highFrameMs: config.highFrameMs ?? 18,
      balancedFrameMs: config.balancedFrameMs ?? 24,
      downgradeFrames: config.downgradeFrames ?? 12,
      upgradeFrames: config.upgradeFrames ?? 45,
      sampleWindow: config.sampleWindow ?? 30,
    };
  }

  update(frameMs: number): RenderQualityTier {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return this.tier;
    this.emaMs = this.emaMs == null ? frameMs : this.emaMs * 0.9 + frameMs * 0.1;
    this.samples = Math.min(this.config.sampleWindow, this.samples + 1);

    const bad = frameMs > this.config.balancedFrameMs;
    const good = frameMs <= this.config.highFrameMs;
    if (bad) { this.badFrames += 1; this.goodFrames = 0; }
    else if (good) { this.goodFrames += 1; this.badFrames = 0; }
    else { this.badFrames = Math.max(0, this.badFrames - 1); this.goodFrames = 0; }

    if (this.badFrames >= this.config.downgradeFrames) {
      this.tier = this.tier === 'high' ? 'balanced' : 'performance';
      this.badFrames = 0;
      this.goodFrames = 0;
    } else if (this.goodFrames >= this.config.upgradeFrames) {
      this.tier = this.tier === 'performance' ? 'balanced' : 'high';
      this.goodFrames = 0;
      this.badFrames = 0;
    }
    return this.tier;
  }

  getTier(): RenderQualityTier { return this.tier; }
  getProfile(): RenderQualityProfile { return RENDER_QUALITY_PROFILES[this.tier]; }
  getEmaFrameMs(): number | null { return this.emaMs; }
  reset(): void { this.tier = 'high'; this.badFrames = 0; this.goodFrames = 0; this.emaMs = null; this.samples = 0; }
}
