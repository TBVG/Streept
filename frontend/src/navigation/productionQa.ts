import { Location, Route3DHighlight } from '../types';
import { NavigationEngineSnapshot } from './navigationEngine';
import { RenderQualityTier } from './adaptiveRenderQuality';

export type RuntimeHealthStatus = 'healthy' | 'degraded' | 'critical';

export interface RuntimeHealthInput {
  route: Route3DHighlight | null;
  userLocation: Location | null;
  snapshot: NavigationEngineSnapshot | null;
  sceneChunkCount: number;
  pooledPrimitiveCount: number;
  trafficVehicleCount: number;
  quality: RenderQualityTier;
  frameEmaMs: number | null;
}

export interface RuntimeHealthReport {
  status: RuntimeHealthStatus;
  issues: string[];
  routeValid: boolean;
  navigationValid: boolean;
  withinSceneBudget: boolean;
  withinTrafficBudget: boolean;
  frameBudgetMs: number;
}

const frameBudgetFor = (quality: RenderQualityTier) => quality === 'high' ? 18 : quality === 'balanced' ? 24 : 30;
const trafficBudgetFor = (quality: RenderQualityTier) => quality === 'high' ? 100 : quality === 'balanced' ? 80 : 60;
const sceneBudgetFor = (quality: RenderQualityTier) => quality === 'high' ? 7 : quality === 'balanced' ? 5 : 3;

const validLocation = (location: Location | null): boolean => Boolean(
  location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
  && location.lat >= -90 && location.lat <= 90 && location.lng >= -180 && location.lng <= 180,
);

export function validateRoute(route: Route3DHighlight | null): boolean {
  const segmented = route?.segments?.flatMap((segment) => segment.coords ?? []) ?? [];
  const legacy = route && 'coordinates' in route && Array.isArray((route as { coordinates?: unknown }).coordinates)
    ? ((route as { coordinates: Location[] }).coordinates)
    : [];
  const coords: Location[] = segmented.length ? segmented : legacy;
  if (coords.length < 2) return false;
  return coords.every((point) => validLocation(point));
}

export function validateNavigationSnapshot(snapshot: NavigationEngineSnapshot | null): boolean {
  if (!snapshot) return true;
  if (!Number.isFinite(snapshot.routeGeneration) || snapshot.routeGeneration < 0) return false;
  if (snapshot.matched && (!validLocation(snapshot.matched.location) || !Number.isFinite(snapshot.matched.confidence))) return false;
  if (!Number.isFinite(snapshot.health.confidence)) return false;
  if (snapshot.currentLane && (!Number.isFinite(snapshot.currentLane.confidence) || snapshot.currentLane.confidence < 0 || snapshot.currentLane.confidence > 1)) return false;
  return true;
}

export function assessImmersiveRuntime(input: RuntimeHealthInput): RuntimeHealthReport {
  const issues: string[] = [];
  const routeValid = validateRoute(input.route);
  const navigationValid = validateNavigationSnapshot(input.snapshot);
  const frameBudgetMs = frameBudgetFor(input.quality);
  const withinSceneBudget = input.sceneChunkCount <= sceneBudgetFor(input.quality);
  const withinTrafficBudget = input.trafficVehicleCount <= trafficBudgetFor(input.quality);

  if (!routeValid && input.route) issues.push('route-geometry-invalid');
  if (!navigationValid) issues.push('navigation-snapshot-invalid');
  if (!validLocation(input.userLocation) && input.userLocation) issues.push('driver-location-invalid');
  if (!withinSceneBudget) issues.push('scene-budget-exceeded');
  if (!withinTrafficBudget) issues.push('traffic-budget-exceeded');
  if (input.frameEmaMs != null && input.frameEmaMs > frameBudgetMs * 1.5) issues.push('frame-budget-critical');
  else if (input.frameEmaMs != null && input.frameEmaMs > frameBudgetMs) issues.push('frame-budget-degraded');

  const status: RuntimeHealthStatus = issues.some((issue) => issue.endsWith('critical') || issue === 'navigation-snapshot-invalid' || issue === 'route-geometry-invalid')
    ? 'critical'
    : issues.length ? 'degraded' : 'healthy';

  return { status, issues, routeValid, navigationValid, withinSceneBudget, withinTrafficBudget, frameBudgetMs };
}

/** Small deterministic frame monitor used by QA and the renderer watchdog. */
export class RuntimeFrameMonitor {
  private emaMs: number | null = null;
  private samples = 0;
  private overBudgetSamples = 0;
  private worstMs = 0;

  record(frameMs: number, budgetMs: number): void {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) return;
    this.emaMs = this.emaMs == null ? frameMs : this.emaMs * 0.9 + frameMs * 0.1;
    this.samples += 1;
    this.worstMs = Math.max(this.worstMs, frameMs);
    if (frameMs > budgetMs) this.overBudgetSamples += 1;
  }

  getEmaMs(): number | null { return this.emaMs; }
  getSamples(): number { return this.samples; }
  getOverBudgetSamples(): number { return this.overBudgetSamples; }
  getWorstMs(): number { return this.worstMs; }
  reset(): void { this.emaMs = null; this.samples = 0; this.overBudgetSamples = 0; this.worstMs = 0; }
}
