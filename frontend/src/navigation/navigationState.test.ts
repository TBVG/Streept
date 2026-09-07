import { describe, expect, it } from 'vitest';
import { INITIAL_NAVIGATION_STATE, transitionNavigation } from './navigationState';

describe('navigationState', () => {
  it('plans, starts, reroutes, and resumes', () => {
    let state = transitionNavigation(INITIAL_NAVIGATION_STATE, { type: 'PLAN' });
    expect(state).toEqual({ phase: 'previewing', sessionActive: false });
    state = transitionNavigation(state, { type: 'START', hasRoute: true });
    expect(state).toEqual({ phase: 'navigating', sessionActive: true });
    state = transitionNavigation(state, { type: 'REROUTE' });
    expect(state.phase).toBe('rerouting');
    state = transitionNavigation(state, { type: 'REROUTE_SUCCEEDED' });
    expect(state).toEqual({ phase: 'navigating', sessionActive: true });
  });

  it('rejects invalid or late lifecycle events', () => {
    let state = transitionNavigation(INITIAL_NAVIGATION_STATE, { type: 'START', hasRoute: true });
    expect(state).toBe(INITIAL_NAVIGATION_STATE);
    state = transitionNavigation(state, { type: 'PLAN' });
    state = transitionNavigation(state, { type: 'START', hasRoute: true });
    state = transitionNavigation(state, { type: 'ARRIVE' });
    expect(state).toEqual({ phase: 'arrived', sessionActive: false });
    expect(transitionNavigation(state, { type: 'REROUTE' })).toBe(state);
    state = transitionNavigation({ phase: 'navigating', sessionActive: true }, { type: 'REROUTE' });
    expect(transitionNavigation(state, { type: 'REROUTE_FAILED' })).toEqual({ phase: 'navigating', sessionActive: true });
  });

  it('reset is always safe', () => {
    const state = transitionNavigation({ phase: 'rerouting', sessionActive: true }, { type: 'RESET' });
    expect(state).toEqual(INITIAL_NAVIGATION_STATE);
  });
});
