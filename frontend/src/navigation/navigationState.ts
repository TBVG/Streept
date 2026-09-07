export type NavigationPhase = 'idle' | 'previewing' | 'navigating' | 'rerouting' | 'arrived';

export type NavigationEvent =
  | { type: 'PLAN'; hasRoute?: boolean }
  | { type: 'START'; hasRoute?: boolean }
  | { type: 'START_NAVIGATION'; hasRoute?: boolean }
  | { type: 'REROUTE' }
  | { type: 'REROUTE_SUCCEEDED' }
  | { type: 'REROUTE_FAILED' }
  | { type: 'ARRIVE' }
  | { type: 'STOP' }
  | { type: 'RESET' };

export interface NavigationState {
  phase: NavigationPhase;
  sessionActive: boolean;
}

export const INITIAL_NAVIGATION_STATE: NavigationState = { phase: 'idle', sessionActive: false };

/**
 * Typed navigation lifecycle. Invalid events are deliberately ignored so a
 * late async callback cannot resurrect or terminate a session accidentally.
 */
export function transitionNavigation(state: NavigationState, event: NavigationEvent): NavigationState {
  switch (event.type) {
    case 'PLAN':
      return { phase: 'previewing', sessionActive: false };
    case 'START':
    case 'START_NAVIGATION':
      if (state.phase !== 'previewing' || event.hasRoute === false) return state;
      return { phase: 'navigating', sessionActive: true };
    case 'REROUTE':
      if (state.phase !== 'navigating') return state;
      return { phase: 'rerouting', sessionActive: true };
    case 'REROUTE_SUCCEEDED':
    case 'REROUTE_FAILED':
      if (state.phase !== 'rerouting') return state;
      return { phase: 'navigating', sessionActive: true };
    case 'ARRIVE':
      if (state.phase !== 'navigating') return state;
      return { phase: 'arrived', sessionActive: false };
    case 'STOP':
      if (state.phase !== 'navigating' && state.phase !== 'rerouting' && state.phase !== 'arrived') return state;
      return { phase: 'previewing', sessionActive: false };
    case 'RESET':
      return INITIAL_NAVIGATION_STATE;
    default:
      return state;
  }
}

export const isNavigationActive = (state: NavigationState): boolean => state.sessionActive;
