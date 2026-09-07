import { Location } from '../types';
import { replayRoute } from './routeNavigationReplay';

const ROUTE: Location[] = [
  { lat: 21.1458, lng: 79.0882 },
  { lat: 21.148, lng: 79.091 },
  { lat: 21.151, lng: 79.094 },
  { lat: 21.154, lng: 79.098 },
  { lat: 21.157, lng: 79.102 },
];

const REPLACEMENT: Location[] = [
  { lat: 21.1458, lng: 79.0882 },
  { lat: 21.147, lng: 79.090 },
  { lat: 21.150, lng: 79.093 },
  { lat: 21.153, lng: 79.097 },
];

describe('route-wide navigation replay', () => {
  it('completes successive lane changes and crosses a junction maneuver', () => {
    const result = replayRoute({
      route: ROUTE,
      speedMps: 12,
      maneuvers: [
        { id: 'm1', distanceMeters: 85, sourceLane: 0, targetLane: 1 },
        { id: 'j1', distanceMeters: 150, sourceLane: 1, targetLane: 2, junction: true },
      ],
    });
    expect(result.completed).toBe(true);
    expect(result.maneuverCompletions).toEqual(['m1', 'j1']);
    expect(result.junctionFrames).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });

  it('handles a blocker, then completes after the traffic window clears', () => {
    const result = replayRoute({
      route: ROUTE,
      speedMps: 10,
      maneuvers: [{ id: 'm1', distanceMeters: 110, sourceLane: 0, targetLane: 1 }],
      blockerWindows: [{ maneuverId: 'm1', startMs: 0, endMs: 3000, vehicleId: 'car-a' }],
    });
    expect(result.maxActiveVehicles).toBe(1);
    expect(result.frames.some((f) => f.execution.phase === 'uncertain')).toBe(true);
    expect(result.maneuverCompletions).toContain('m1');
  });

  it('reroutes onto a replacement route after a persistent blocker makes the maneuver miss', () => {
    const result = replayRoute({
      route: ROUTE,
      replacementRoute: REPLACEMENT,
      speedMps: 14,
      maneuvers: [{ id: 'm1', distanceMeters: 55, sourceLane: 0, targetLane: 1 }],
      blockerWindows: [{ maneuverId: 'm1', startMs: 0, endMs: 20000, vehicleId: 'truck-a' }],
    });
    expect(result.missedManeuvers).toContain('m1');
    expect(result.rerouteCount).toBe(1);
    expect(result.replacementRouteUsed).toBe(true);
  });

  it('derives maneuver distance from a route location and keeps a persistent vehicle track moving', () => {
    const maneuverLocation = ROUTE[2];
    const result = replayRoute({
      route: ROUTE,
      speedMps: 10,
      maneuvers: [{ id: 'geo', location: maneuverLocation, sourceLane: 0, targetLane: 1 }],
      vehicleTracks: [{ id: 'tracked-car', laneIndex: 1, startProgressMeters: 20, speedMps: 6, laneChanges: [{ atMs: 1200, laneIndex: 2 }] }],
    });
    expect(result.resolvedManeuverDistances.geo).toBeGreaterThan(0);
    expect(result.maxActiveVehicles).toBeGreaterThan(0);
    expect(result.frames.some((f) => f.activeVehicles > 0)).toBe(true);
    expect(result.failures).not.toContain('persistent vehicle track never became observable');
  });

  it('uses physical junction resolution and switches the active replay route after reroute', () => {
    const result = replayRoute({
      route: ROUTE,
      replacementRoute: REPLACEMENT,
      speedMps: 14,
      maneuvers: [{ id: 'junction', distanceMeters: 55, sourceLane: 0, targetLane: 1, junction: true }],
      blockerWindows: [{ maneuverId: 'junction', startMs: 0, endMs: 20000, vehicleId: 'truck' }],
    });
    expect(result.junctionFrames).toBeGreaterThan(0);
    expect(result.frames.some((f) => f.junctionResolution !== null)).toBe(true);
    expect(result.replacementRouteUsed).toBe(true);
    expect(result.frames.some((f) => f.rerouted && f.routeGeneration > 1)).toBe(true);
    const rerouteFrame = result.frames.find((f) => f.rerouted);
    expect(rerouteFrame?.drive.truthProgressMeters).toBe(0);
  });

  it('keeps route progress moving during GPS dropout while lane confidence is reduced', () => {
    const result = replayRoute({
      route: ROUTE,
      speedMps: 10,
      maneuvers: [{ id: 'm1', distanceMeters: 105, sourceLane: 0, targetLane: 1 }],
      gpsDropoutWindowsMs: [{ start: 2400, end: 4800 }],
    });
    expect(result.frames.some((f) => f.gpsDropout && f.drive.usedContinuity)).toBe(true);
    expect(result.failures).not.toContain('route replay dropout did not use continuity');
  });

  it('uses live scene roads and physical OSM lane topology at a real shared-node junction', () => {
    const scene = {
      buildings: [], signals: [], crossings: [], stops: [], trees: [], restrictions: [],
      roads: [
        { osm_id: 101, node_ids: [1, 2, 3], geometry: ROUTE.slice(0, 3).map((p) => ({ ...p })), highway: 'primary', name: 'Incoming', lanes: 3, oneway: true },
        { osm_id: 202, node_ids: [3, 4, 5], geometry: ROUTE.slice(2).map((p) => ({ ...p })), highway: 'primary', name: 'Outgoing', lanes: 2, oneway: true },
      ],
    };
    const result = replayRoute({
      route: ROUTE,
      speedMps: 10,
      scene,
      maneuvers: [{ id: 'live-junction', location: ROUTE[2], sourceLane: 1, targetLane: 1, junction: true }],
    });
    expect(result.frames.some((f) => f.junctionResolution?.continuous)).toBe(true);
    expect(result.frames.some((f) => f.junctionResolution?.physicalMapping?.legal)).toBe(true);
    expect(result.failures).toEqual([]);
  });

});
