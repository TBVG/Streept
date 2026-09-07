import { Maneuver, SceneRoad } from '../types';
import { IntersectionKind, classifyIntersection } from './laneIntersectionIntelligence';

export type JunctionBehaviorKind =
  | 'roundabout-entry'
  | 'roundabout-exit'
  | 'merge'
  | 'split'
  | 'ramp-merge'
  | 'ramp-exit'
  | 'uturn'
  | 'turn'
  | 'straight'
  | 'unknown';

export interface JunctionBehavior {
  kind: JunctionBehaviorKind;
  intersection: IntersectionKind;
  priority: 'yield' | 'stop' | 'through' | 'merge' | 'unknown';
  laneChangeAllowedBeforeJunction: boolean;
  laneChangeAllowedInsideJunction: boolean;
  targetLaneBias: 'left' | 'right' | 'center' | 'none';
  confidence: number;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/_/g, '-');

function has(value: string | null | undefined, token: string): boolean {
  return norm(value).split(/[;|,\s]+/).includes(token);
}

/**
 * Converts sparse OSM/OSRM maneuver metadata into conservative junction
 * behavior. Missing restriction data never creates a new prohibition; it only
 * lowers confidence. This keeps the planner safe when an extract is partial.
 */
export function classifyJunctionBehavior(
  maneuver: Maneuver,
  incoming?: SceneRoad,
  outgoing?: SceneRoad,
): JunctionBehavior {
  const type = norm(maneuver.type);
  const modifier = norm(maneuver.modifier);
  const intersection = classifyIntersection(maneuver, incoming, outgoing);

  if (type === 'roundabout' || type === 'rotary') {
    const isExit = Boolean(maneuver.instruction && /exit/i.test(maneuver.instruction));
    return {
      kind: isExit ? 'roundabout-exit' : 'roundabout-entry',
      intersection: 'roundabout',
      priority: 'yield',
      laneChangeAllowedBeforeJunction: true,
      laneChangeAllowedInsideJunction: false,
      targetLaneBias: modifier.includes('left') ? 'left' : modifier.includes('right') ? 'right' : 'none',
      confidence: 0.9,
    };
  }

  if (type === 'merge' || intersection === 'merge') {
    const ramp = incoming?.highway?.includes('ramp') || outgoing?.highway?.includes('ramp');
    return {
      kind: ramp ? 'ramp-merge' : 'merge',
      intersection,
      priority: 'merge',
      laneChangeAllowedBeforeJunction: true,
      laneChangeAllowedInsideJunction: false,
      targetLaneBias: modifier.includes('left') ? 'left' : modifier.includes('right') ? 'right' : 'none',
      confidence: ramp ? 0.88 : 0.86,
    };
  }

  if (type === 'fork' || type === 'split' || intersection === 'split') {
    return {
      kind: 'split',
      intersection: 'split',
      priority: 'through',
      laneChangeAllowedBeforeJunction: true,
      laneChangeAllowedInsideJunction: false,
      targetLaneBias: modifier.includes('left') ? 'left' : modifier.includes('right') ? 'right' : 'none',
      confidence: 0.84,
    };
  }

  if (type === 'on-ramp' || type === 'ramp') {
    return {
      kind: 'ramp-merge', intersection: 'ramp', priority: 'merge',
      laneChangeAllowedBeforeJunction: true, laneChangeAllowedInsideJunction: false,
      targetLaneBias: 'none', confidence: 0.84,
    };
  }

  if (type === 'off-ramp') {
    return {
      kind: 'ramp-exit', intersection: 'ramp', priority: 'through',
      laneChangeAllowedBeforeJunction: true, laneChangeAllowedInsideJunction: false,
      targetLaneBias: modifier.includes('left') ? 'left' : 'right', confidence: 0.84,
    };
  }

  if (type === 'uturn' || modifier.includes('uturn')) {
    return {
      kind: 'uturn', intersection, priority: 'yield',
      laneChangeAllowedBeforeJunction: true, laneChangeAllowedInsideJunction: false,
      targetLaneBias: modifier.includes('left') ? 'left' : 'right', confidence: 0.82,
    };
  }

  const stop = has(incoming?.highway, 'stop') || has(maneuver.instruction, 'stop');
  return {
    kind: modifier === 'straight' || type === 'continue' ? 'straight' : 'turn',
    intersection,
    priority: stop ? 'stop' : 'through',
    laneChangeAllowedBeforeJunction: true,
    laneChangeAllowedInsideJunction: false,
    targetLaneBias: modifier.includes('left') ? 'left' : modifier.includes('right') ? 'right' : 'center',
    confidence: 0.74,
  };
}

export function maneuverRequiresLaneCommitment(behavior: JunctionBehavior): boolean {
  return behavior.kind !== 'straight' && behavior.kind !== 'unknown';
}

export function laneChangeWindowBufferMeters(behavior: JunctionBehavior, laneChanges: number): number {
  const count = Math.max(1, laneChanges);
  switch (behavior.kind) {
    case 'roundabout-entry':
    case 'roundabout-exit': return 55 + (count - 1) * 28;
    case 'ramp-exit': return 70 + (count - 1) * 30;
    case 'ramp-merge':
    case 'merge': return 60 + (count - 1) * 30;
    case 'split': return 65 + (count - 1) * 28;
    case 'uturn': return 50 + (count - 1) * 25;
    default: return 45 + (count - 1) * 25;
  }
}
