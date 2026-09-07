import { Maneuver, SceneRoad } from '../types';

export type LaneTurnKind = 'left' | 'through' | 'right' | 'uturn' | 'merge_left' | 'merge_right' | 'unknown';

export interface OslaneSemantic {
  index: number;
  turns: LaneTurnKind[];
  destination: string | null;
  change: string | null;
  routeScore: number;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

function tokenKind(token: string): LaneTurnKind {
  const t = normalize(token);
  if (t.includes('uturn')) return 'uturn';
  if (t.includes('merge_to_left')) return 'merge_left';
  if (t.includes('merge_to_right')) return 'merge_right';
  if (t.includes('left')) return 'left';
  if (t.includes('right')) return 'right';
  if (t.includes('through') || t === 'straight') return 'through';
  return 'unknown';
}

function desiredKind(maneuver: Maneuver): Exclude<LaneTurnKind, 'unknown'> {
  const text = `${maneuver.type} ${maneuver.modifier ?? ''}`.toLowerCase();
  if (text.includes('uturn') || text.includes('u-turn')) return 'uturn';
  if (text.includes('left')) return 'left';
  if (text.includes('right')) return 'right';
  if (text.includes('merge') && text.includes('left')) return 'merge_left';
  if (text.includes('merge') && text.includes('right')) return 'merge_right';
  return 'through';
}

function splitLaneValues(values: string[] | null | undefined, count: number): string[] {
  if (!values?.length) return Array.from({ length: count }, () => '');
  if (values.length === count) return values;
  const expanded = values.flatMap((v) => v.split('|').map((x) => x.trim()));
  return Array.from({ length: count }, (_, i) => expanded[i] ?? '');
}

export function parseOsmLaneSemantics(road: SceneRoad, maneuver: Maneuver, laneCount = Math.max(1, Math.min(8, road.lanes ?? 1))): OslaneSemantic[] {
  const turns = splitLaneValues(road.turn_lanes, laneCount);
  const changes = splitLaneValues(road.change_lanes, laneCount);
  const destinations = splitLaneValues(road.destination_lanes, laneCount);
  const desired = desiredKind(maneuver);
  return turns.map((value, index) => {
    const laneTurns = value.split(';').map(tokenKind).filter((x): x is Exclude<LaneTurnKind, 'unknown'> => x !== 'unknown');
    const routeScore = laneTurns.includes(desired) ? 1 : laneTurns.includes('through') && desired === 'through' ? 1 : laneTurns.length === 0 ? 0.35 : 0;
    return { index, turns: laneTurns, destination: destinations[index] || null, change: changes[index] || null, routeScore };
  });
}

export function laneMatchesManeuver(road: SceneRoad, laneIndex: number, maneuver: Maneuver, laneCount?: number): boolean {
  const semantics = parseOsmLaneSemantics(road, maneuver, laneCount);
  return semantics[laneIndex]?.routeScore === 1;
}

export function laneChangeAllows(source: SceneRoad, fromLane: number, toLane: number, laneCount?: number): boolean {
  if (fromLane === toLane) return true;
  const semantics = parseOsmLaneSemantics(source, { type: 'turn', modifier: 'straight', location: source.geometry[0] ?? { lat: 0, lng: 0 }, bearing_before: 0, instruction: '', is_complex: false }, laneCount);
  const change = semantics[fromLane]?.change?.toLowerCase() ?? '';
  if (!change) return true;
  const delta = toLane - fromLane;
  if (change.includes('no')) return false;
  if (delta < 0 && (change.includes('only_right') || change.includes('right'))) return false;
  if (delta > 0 && (change.includes('only_left') || change.includes('left'))) return false;
  if (change.includes('not_left') && delta < 0) return false;
  if (change.includes('not_right') && delta > 0) return false;
  return true;
}


/** Normalizes a destination/road-sign token for fuzzy lane matching. */
export function normalizeDestinationToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(road|rd|street|st|avenue|ave|highway|hwy)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function destinationMatchesLane(destinationText: string | null | undefined, laneDestination: string | null | undefined): boolean {
  if (!destinationText || !laneDestination) return false;
  const target = normalizeDestinationToken(destinationText);
  const lane = normalizeDestinationToken(laneDestination);
  if (!target || !lane) return false;
  if (lane.includes(target) || target.includes(lane)) return true;
  const targetTokens = new Set(target.split(/\s+/).filter((t) => t.length > 2));
  const overlap = lane.split(/\s+/).filter((t) => targetTokens.has(t)).length;
  return overlap >= Math.max(1, Math.ceil(targetTokens.size * 0.5));
}
