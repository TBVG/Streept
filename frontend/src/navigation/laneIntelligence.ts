import { LaneInfo, Maneuver } from '../types';

export interface LaneRecommendation {
  laneIndex: number;
  score: number;
  preferred: boolean;
  indications: string[];
}

export interface LaneTopology {
  laneIndex: number;
  allowedChanges: { left: boolean; right: boolean };
  destination: string | null;
  recommended: boolean;
  indications: string[];
}

export interface LaneGraphNode extends LaneTopology {
  reachableLeft: number[];
  reachableRight: number[];
}

export interface LanePathAnalysis {
  currentLaneIndex: number | null;
  targetLaneIndex: number | null;
  requiredLaneChanges: number;
  direction: 'stay' | 'left' | 'right' | 'mixed';
  reachable: boolean;
  confidence: number;
}

export interface DriverLaneEstimate {
  laneIndex: number | null;
  confidence: number;
  lateralMeters: number;
  roadWidthMeters: number;
}

export interface LaneGuidanceState {
  currentLaneIndex: number | null;
  targetLaneIndex: number | null;
  direction: 'stay' | 'left' | 'right';
  laneDelta: number;
  confidence: number;
  safeToChange: boolean;
}

const NORMALIZE: Record<string, string> = {
  through: 'straight',
  straight: 'straight',
  left: 'left',
  right: 'right',
  'slight left': 'slight-left',
  'slight right': 'slight-right',
  'sharp left': 'sharp-left',
  'sharp right': 'sharp-right',
  uturn: 'uturn',
};

function normalized(values: string[]): string[] {
  return values.map((v) => NORMALIZE[v.trim().toLowerCase()] ?? v.trim().toLowerCase());
}

function matchesTarget(indications: string[], modifier: string | null, type: string): boolean {
  const target = modifier ? NORMALIZE[modifier.toLowerCase()] ?? modifier.toLowerCase() : null;
  if (type === 'uturn' || target === 'uturn') return indications.includes('uturn') || indications.includes('left');
  if (target === 'straight') return indications.includes('straight');
  if (target === 'left') return indications.some((v) => v === 'left' || v === 'slight-left' || v === 'sharp-left');
  if (target === 'right') return indications.some((v) => v === 'right' || v === 'slight-right' || v === 'sharp-right');
  return false;
}

function changePermissions(lane: LaneInfo): { left: boolean; right: boolean } {
  const change = (lane.change ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!change) return { left: true, right: true };
  if (change === 'no' || change === 'not' || change === 'none') return { left: false, right: false };
  const tokens = change.split(/[;,\s]+/).filter(Boolean);
  const onlyLeft = tokens.includes('only:left') || tokens.includes('only_left') || tokens.includes('only-left');
  const onlyRight = tokens.includes('only:right') || tokens.includes('only_right') || tokens.includes('only-right');
  const leftBlocked = tokens.some((token) => token === 'not_left' || token === 'no_left' || token === 'not:left' || token === 'no:left');
  const rightBlocked = tokens.some((token) => token === 'not_right' || token === 'no_right' || token === 'not:right' || token === 'no:right');
  return { left: !leftBlocked && !onlyRight, right: !rightBlocked && !onlyLeft };
}

export function getLaneRecommendations(maneuver: Maneuver): LaneRecommendation[] {
  const lanes: LaneInfo[] = maneuver.lanes ?? [];
  if (!lanes.length) return [];
  const scored = lanes.map((lane, laneIndex) => {
    const indications = normalized(lane.indications ?? []);
    let score = lane.valid ? 0.55 : 0.05;
    if (matchesTarget(indications, maneuver.modifier, maneuver.type)) score += 0.42;
    if (indications.includes('straight') && maneuver.modifier === 'straight') score += 0.1;
    if ((lane.destination ?? '').trim()) score += 0.03;
    const permissions = changePermissions(lane);
    if (!permissions.left && !permissions.right && lane.valid) score += 0.02;
    return { laneIndex, score: Math.min(1, score), preferred: false, indications };
  });
  const max = Math.max(...scored.map((item) => item.score));
  return scored.map((item) => ({ ...item, preferred: item.score >= max - 0.06 && item.score >= 0.8 }));
}

export function buildLaneTopology(maneuver: Maneuver): LaneTopology[] {
  const recs = getLaneRecommendations(maneuver);
  const lanes = maneuver.lanes ?? [];
  return lanes.map((lane, laneIndex) => {
    const permissions = changePermissions(lane);
    return {
      laneIndex,
      allowedChanges: permissions,
      destination: lane.destination ?? null,
      recommended: recs[laneIndex]?.preferred ?? false,
      indications: normalized(lane.indications ?? []),
    };
  });
}

/** Estimate the driver's lane from signed lateral offset to the route centerline.
 * Positive lateral means the driver is to the left of travel; negative is right.
 * This is intentionally confidence-weighted because centerlines are not always
 * true carriageway centers. */
export function estimateDriverLane(
  signedLateralMeters: number,
  laneCount: number,
  roadWidthMeters = Math.max(5.5, Math.min(24, Math.max(1, laneCount) * 3.3)),
): DriverLaneEstimate {
  if (!Number.isFinite(signedLateralMeters) || laneCount < 1 || !Number.isFinite(roadWidthMeters) || roadWidthMeters <= 0) {
    return { laneIndex: null, confidence: 0, lateralMeters: 0, roadWidthMeters: Math.max(roadWidthMeters || 0, 0) };
  }
  const laneWidth = roadWidthMeters / laneCount;
  // Route centerline is our reference. Clamp to the carriageway to avoid
  // claiming a far-off GPS position is in a lane.
  const clamped = Math.max(-roadWidthMeters / 2, Math.min(roadWidthMeters / 2, signedLateralMeters));
  const fromRight = roadWidthMeters / 2 - clamped;
  const raw = Math.floor(fromRight / Math.max(2.6, laneWidth));
  const laneIndex = Math.max(0, Math.min(laneCount - 1, raw));
  const centerOfLane = roadWidthMeters / 2 - (laneIndex + 0.5) * laneWidth;
  const laneError = Math.abs(clamped - centerOfLane);
  const confidence = Math.max(0, Math.min(1, 1 - laneError / Math.max(2.2, laneWidth * 0.9)));
  return { laneIndex, confidence, lateralMeters: signedLateralMeters, roadWidthMeters };
}

export function getLaneGuidanceState(maneuver: Maneuver, currentLaneIndex: number | null, currentLaneConfidence = 1): LaneGuidanceState {
  const topology = buildLaneTopology(maneuver);
  const target = topology.find((lane) => lane.recommended) ?? null;
  if (!target || currentLaneIndex == null) return { currentLaneIndex, targetLaneIndex: target?.laneIndex ?? null, direction: 'stay', laneDelta: 0, confidence: Math.max(0, Math.min(1, currentLaneConfidence)), safeToChange: false };
  const laneDelta = target.laneIndex - currentLaneIndex;
  const direction = laneDelta === 0 ? 'stay' : laneDelta > 0 ? 'right' : 'left';
  const path = analyzeLanePath(maneuver, currentLaneIndex, currentLaneConfidence);
  const safeToChange = direction === 'stay' ? true : path.reachable && path.requiredLaneChanges > 0;
  return { currentLaneIndex, targetLaneIndex: target.laneIndex, direction, laneDelta, confidence: path.confidence, safeToChange };
}

export function buildLaneGraph(maneuver: Maneuver): LaneGraphNode[] {
  const topology = buildLaneTopology(maneuver);
  return topology.map((lane, index) => ({
    ...lane,
    reachableLeft: lane.allowedChanges.left && index > 0 ? [index - 1] : [],
    reachableRight: lane.allowedChanges.right && index < topology.length - 1 ? [index + 1] : [],
  }));
}

export function analyzeLanePath(maneuver: Maneuver, currentLaneIndex: number | null, currentLaneConfidence = 1): LanePathAnalysis {
  const graph = buildLaneGraph(maneuver);
  const target = graph.find((lane) => lane.recommended) ?? null;
  const confidence = Math.max(0, Math.min(1, currentLaneConfidence));
  if (!target || currentLaneIndex == null || !graph[currentLaneIndex]) return { currentLaneIndex, targetLaneIndex: target?.laneIndex ?? null, requiredLaneChanges: 0, direction: 'stay', reachable: false, confidence };
  if (currentLaneIndex === target.laneIndex) return { currentLaneIndex, targetLaneIndex: target.laneIndex, requiredLaneChanges: 0, direction: 'stay', reachable: true, confidence };
  const queue: Array<{ lane: number; path: number[] }> = [{ lane: currentLaneIndex, path: [currentLaneIndex] }];
  const visited = new Set<number>([currentLaneIndex]);
  let found: number[] | null = null;
  while (queue.length) {
    const item = queue.shift()!;
    if (item.lane === target.laneIndex) { found = item.path; break; }
    for (const lane of [...graph[item.lane].reachableLeft, ...graph[item.lane].reachableRight]) {
      if (!visited.has(lane)) { visited.add(lane); queue.push({ lane, path: [...item.path, lane] }); }
    }
  }
  if (!found) return { currentLaneIndex, targetLaneIndex: target.laneIndex, requiredLaneChanges: 0, direction: 'mixed', reachable: false, confidence: confidence * 0.5 };
  const deltas = found.slice(1).map((lane, i) => lane - found![i]);
  const hasLeft = deltas.some((delta) => delta < 0);
  const hasRight = deltas.some((delta) => delta > 0);
  const direction = hasLeft && hasRight ? 'mixed' : hasLeft ? 'left' : 'right';
  return { currentLaneIndex, targetLaneIndex: target.laneIndex, requiredLaneChanges: found.length - 1, direction, reachable: true, confidence: confidence * Math.max(0.65, 1 - (found.length - 2) * 0.08) };
}

export function laneChangeGuidance(maneuver: Maneuver, currentLaneIndex: number | null): string | null {
  const state = getLaneGuidanceState(maneuver, currentLaneIndex);
  if (state.targetLaneIndex == null || state.currentLaneIndex == null) return null;
  if (state.direction === 'stay') return 'Stay in this lane';
  if (!state.safeToChange && Math.abs(state.laneDelta) === 1) return 'Prepare to change lanes';
  if (state.laneDelta > 0) return `Move right ${state.laneDelta} lane${state.laneDelta === 1 ? '' : 's'}`;
  return `Move left ${Math.abs(state.laneDelta)} lane${Math.abs(state.laneDelta) === 1 ? '' : 's'}`;
}

export function laneGuidanceLabel(maneuver: Maneuver, currentLaneIndex: number | null = null): string | null {
  const recommendations = getLaneRecommendations(maneuver);
  if (!recommendations.length) return null;
  const change = laneChangeGuidance(maneuver, currentLaneIndex);
  if (change) return change;
  const preferred = recommendations.filter((lane) => lane.preferred);
  if (!preferred.length) return 'Use any highlighted lane';
  if (preferred.length === 1) return `Use lane ${preferred[0].laneIndex + 1}`;
  return `Use lanes ${preferred.map((lane) => lane.laneIndex + 1).join(' or ')}`;
}


export interface RouteLanePlanStep {
  maneuverIndex: number;
  laneCount: number;
  targetLaneIndex: number | null;
  plannedLaneIndex: number | null;
  nextPlannedLaneIndex: number | null;
  lookaheadLaneChanges: number;
  stabilityScore: number;
  requiredLaneChanges: number;
  direction: 'stay' | 'left' | 'right' | 'mixed';
  reachable: boolean;
  confidence: number;
}

export interface RouteLanePlan {
  steps: RouteLanePlanStep[];
  totalLaneChanges: number;
  confidence: number;
  continuous: boolean;
}

/**
 * Builds one route-wide lane plan instead of treating each maneuver as an
 * isolated lane decision. A previous maneuver's target becomes the next
 * maneuver's starting lane when lane counts are compatible; otherwise the
 * planner deliberately lowers confidence rather than pretending continuity.
 */
export function buildRouteLanePlan(maneuvers: Maneuver[], currentLaneIndex: number | null = null, currentLaneConfidence = 1): RouteLanePlan {
  let previousLane: number | null = currentLaneIndex;
  let confidence = Math.max(0, Math.min(1, currentLaneConfidence));
  let totalLaneChanges = 0;
  let continuous = true;
  const steps: RouteLanePlanStep[] = [];

  maneuvers.forEach((maneuver, maneuverIndex) => {
    const topology = buildLaneTopology(maneuver);
    if (!topology.length) {
      steps.push({ maneuverIndex, laneCount: 0, targetLaneIndex: null, plannedLaneIndex: null, nextPlannedLaneIndex: null, lookaheadLaneChanges: 0, stabilityScore: 0, requiredLaneChanges: 0, direction: 'stay', reachable: false, confidence: confidence * 0.8 });
      continuous = false;
      return;
    }

    const localCurrent = previousLane != null && previousLane < topology.length ? previousLane : null;
    const analysis = analyzeLanePath(maneuver, localCurrent, confidence);
    const target = analysis.targetLaneIndex;
    const stepConfidence = analysis.confidence * (localCurrent == null ? 0.82 : 1);
    steps.push({
      maneuverIndex,
      laneCount: topology.length,
      targetLaneIndex: target,
      plannedLaneIndex: target,
      nextPlannedLaneIndex: null,
      lookaheadLaneChanges: 0,
      stabilityScore: analysis.reachable ? Math.max(0, Math.min(1, analysis.confidence)) : 0,
      requiredLaneChanges: analysis.requiredLaneChanges,
      direction: analysis.direction,
      reachable: analysis.reachable,
      confidence: stepConfidence,
    });
    totalLaneChanges += analysis.requiredLaneChanges;
    if (localCurrent == null || !analysis.reachable) continuous = false;
    if (target != null) previousLane = target;
    confidence = Math.min(confidence, stepConfidence);
  });

  // Fill route-wide lookahead fields after the sequential targets are known.
  // This keeps the compatibility API useful without duplicating the dynamic
  // programming implementation in routeLaneStrategy.
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    step.nextPlannedLaneIndex = steps[i + 1]?.plannedLaneIndex ?? null;
    step.lookaheadLaneChanges = steps.slice(i + 1, i + 4).reduce((sum, next, offset) => {
      const from = offset === 0 ? step.plannedLaneIndex : steps[i + offset]?.plannedLaneIndex;
      return sum + (from != null && next.plannedLaneIndex != null ? Math.abs(next.plannedLaneIndex - from) : 0);
    }, 0);
  }

  return { steps, totalLaneChanges, confidence, continuous };
}
