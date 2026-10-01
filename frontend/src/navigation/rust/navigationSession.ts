import { Location, Report, Route3DHighlight, SceneContext } from '../../types';
import { RustNavigationDecision } from './navigationEngineApi';

const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3001/api');

type SessionStart = { session_id: string };

/**
 * Persistent Rust navigation bridge. The route/scene is sent once; GPS ticks
 * only send changing observations. Requests are latest-wins so a slow network
 * response can never stall or reorder the live navigation UI.
 */
export class RustNavigationSession {
  private sessionId: string | null = null;
  private controller: AbortController | null = null;
  private generation = 0;

  async start(route: Route3DHighlight | null, scene: SceneContext | null): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const response = await fetch(`${API_BASE_URL}/navigation/session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route, scene, current_way_id: null }),
    });
    if (!response.ok) throw new Error(`Rust navigation session unavailable (${response.status})`);
    const payload = await response.json();
    if (generation !== this.generation) return;
    if (!payload?.success || !payload?.data?.session_id) throw new Error(payload?.error?.message || 'Rust navigation session failed');
    this.sessionId = (payload.data as SessionStart).session_id;
  }

  async updateContext(route: Route3DHighlight | null, scene: SceneContext | null): Promise<void> {
    if (!this.sessionId) return;
    const response = await fetch(`${API_BASE_URL}/navigation/session/${encodeURIComponent(this.sessionId)}/context`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route, scene, current_way_id: null }),
    });
    if (!response.ok) throw new Error(`Rust navigation context update unavailable (${response.status})`);
    const payload = await response.json();
    if (!payload?.success) throw new Error(payload?.error?.message || 'Rust navigation context update failed');
  }

  async step(input: {
    location: Location | null;
    currentWayId: number | null;
    currentLaneIndex: number | null;
    reports: Array<Pick<Report, 'location' | 'type' | 'confidence'>>;
    trafficVehicles: Array<{ location: Location }>;
    speedMps: number | null;
    routeReacquire: boolean;
    restrictionProhibited: boolean;
    restrictionConfidence: number;
  }): Promise<RustNavigationDecision | null> {
    if (!this.sessionId) return null;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const sessionId = this.sessionId;
    const response = await fetch(`${API_BASE_URL}/navigation/session/${encodeURIComponent(sessionId)}/step`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        location: input.location,
        current_way_id: input.currentWayId,
        current_lane_index: input.currentLaneIndex,
        reports: input.reports.map((report) => ({ location: report.location, type: report.type, confidence: report.confidence ?? null })),
        traffic_vehicles: input.trafficVehicles,
        speed_mps: input.speedMps,
        route_reacquire: input.routeReacquire,
        restriction_prohibited: input.restrictionProhibited,
        restriction_confidence: input.restrictionConfidence,
      }),
    });
    if (!response.ok) throw new Error(`Rust navigation session step unavailable (${response.status})`);
    const payload = await response.json();
    if (!payload?.success || !payload?.data) throw new Error(payload?.error?.message || 'Rust navigation session step failed');
    return payload.data as RustNavigationDecision;
  }

  stop(): void {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    this.sessionId = null;
  }
}
