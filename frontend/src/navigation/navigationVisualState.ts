import type { NavigationPhase } from './navigationState';

export type VisualNavigationMode = 'idle' | 'preview' | 'active' | 'rerouting' | 'arrived';
export type GuidanceUrgency = 'none' | 'normal' | 'prepare' | 'immediate';

export interface NavigationVisualStateInput {
  phase: NavigationPhase;
  sessionActive: boolean;
  distanceToManeuverMeters: number | null;
  laneGuidance: string | null;
  laneConfidence: number;
  gpsConfidence: number;
  immersiveAvailable: boolean;
}

export interface NavigationVisualState {
  mode: VisualNavigationMode;
  showRoute: boolean;
  showGpsWarning: boolean;
  showRerouteIndicator: boolean;
  showArrival: boolean;
  showImmersivePreview: boolean;
  guidanceUrgency: GuidanceUrgency;
  laneGuidance: string | null;
}

/**
 * Pure presentation contract used by regression tests. Keeping this separate
 * from React makes navigation visuals deterministic across web/native clients.
 */
export function deriveNavigationVisualState(input: NavigationVisualStateInput): NavigationVisualState {
  const gpsConfidence = Math.max(0, Math.min(1, input.gpsConfidence));
  const laneConfidence = Math.max(0, Math.min(1, input.laneConfidence));
  const distance = input.distanceToManeuverMeters;
  const maneuverSoon = distance != null && distance <= 120;
  const maneuverImmediate = distance != null && distance <= 35;

  if (input.phase === 'arrived') {
    return { mode: 'arrived', showRoute: true, showGpsWarning: false, showRerouteIndicator: false, showArrival: true, showImmersivePreview: false, guidanceUrgency: 'none', laneGuidance: null };
  }
  if (input.phase === 'rerouting') {
    return { mode: 'rerouting', showRoute: true, showGpsWarning: gpsConfidence < 0.45, showRerouteIndicator: true, showArrival: false, showImmersivePreview: false, guidanceUrgency: 'normal', laneGuidance: null };
  }
  if (input.phase === 'navigating' && input.sessionActive) {
    return {
      mode: 'active',
      showRoute: true,
      showGpsWarning: gpsConfidence < 0.45,
      showRerouteIndicator: false,
      showArrival: false,
      showImmersivePreview: input.immersiveAvailable && maneuverSoon,
      guidanceUrgency: maneuverImmediate ? 'immediate' : maneuverSoon && input.laneGuidance != null ? 'prepare' : 'normal',
      laneGuidance: laneConfidence >= 0.45 ? input.laneGuidance : null,
    };
  }
  if (input.phase === 'previewing') {
    return { mode: 'preview', showRoute: true, showGpsWarning: false, showRerouteIndicator: false, showArrival: false, showImmersivePreview: input.immersiveAvailable, guidanceUrgency: 'none', laneGuidance: input.laneGuidance };
  }
  return { mode: 'idle', showRoute: false, showGpsWarning: false, showRerouteIndicator: false, showArrival: false, showImmersivePreview: false, guidanceUrgency: 'none', laneGuidance: null };
}
