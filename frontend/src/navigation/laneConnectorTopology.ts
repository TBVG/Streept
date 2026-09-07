import { Maneuver, RouteCoord } from '../types';
import { bearingDegrees, destinationPoint } from '../utils/geo';
import { buildLaneTopology } from './laneIntelligence';
import { laneCenterOffsetMeters } from './sceneGuidance';

export interface LaneConnector {
  fromLane: number;
  toLane: number;
  points: RouteCoord[];
  kind: 'stay' | 'change' | 'turn';
  confidence: number;
  source: 'osrm-lane-metadata' | 'inferred-lane-geometry';
}

export interface LaneConnectorTopology {
  laneCount: number;
  connectors: LaneConnector[];
  source: LaneConnector['source'];
}

/**
 * Builds explicit lane-to-lane connectors for the maneuver approach.
 * OSRM lane validity/turn metadata determines which lane pairs are legal;
 * the geometry is intentionally marked inferred because OSRM does not expose
 * physical lane centerline connectors in its maneuver response.
 */
export function buildLaneConnectorTopology(
  coords: RouteCoord[],
  maneuver: Maneuver,
  startIndex: number,
  maneuverIndex: number,
  currentLaneIndex: number | null = null,
  targetLaneIndex: number | null = null,
): LaneConnectorTopology {
  const topology = buildLaneTopology(maneuver);
  const laneCount = Math.max(1, topology.length);
  if (coords.length < 2 || !topology.length) return { laneCount, connectors: [], source: 'inferred-lane-geometry' };

  const end = Math.max(startIndex + 1, Math.min(maneuverIndex, coords.length - 1));
  const from = currentLaneIndex != null && currentLaneIndex >= 0 && currentLaneIndex < laneCount
    ? currentLaneIndex
    : null;
  const target = targetLaneIndex != null && targetLaneIndex >= 0 && targetLaneIndex < laneCount
    ? targetLaneIndex
    : topology.find((lane) => lane.recommended)?.laneIndex ?? null;

  const connectors: LaneConnector[] = [];
  const addConnector = (fromLane: number, toLane: number, kind: LaneConnector['kind'], confidence: number) => {
    const a = coords[Math.max(0, Math.min(startIndex, coords.length - 2))];
    const b = coords[end];
    const bearing = bearingDegrees(a, b);
    const span = Math.max(25, Math.min(80, Math.abs(end - startIndex) * 9));
    const mid = destinationPoint(a, bearing, span * 0.55);
    const start = destinationPoint(a, (bearing + 90) % 360, laneCenterOffsetMeters(fromLane, laneCount));
    const finish = destinationPoint(b, (bearing + 90) % 360, laneCenterOffsetMeters(toLane, laneCount));
    const bend = destinationPoint(mid, (bearing + 90) % 360, laneCenterOffsetMeters((fromLane + toLane) / 2, laneCount));
    connectors.push({ fromLane, toLane, points: [start, bend, finish], kind, confidence, source: 'inferred-lane-geometry' });
  };

  if (from != null && target != null) {
    addConnector(from, target, from === target ? 'stay' : 'change', from === target ? 0.92 : 0.78);
  } else if (target != null) {
    // No trusted driver lane: expose the recommended lane without inventing a
    // driver transition. This remains useful to a renderer as a target ribbon.
    addConnector(target, target, 'stay', 0.68);
  }

  return { laneCount, connectors, source: 'inferred-lane-geometry' };
}
