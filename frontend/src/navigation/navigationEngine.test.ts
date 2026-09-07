import { describe, expect, it } from 'vitest';
import { NavigationEngine } from './navigationEngine';
import { Route3DHighlight, SceneContext } from '../types';

const route: Route3DHighlight = {
  segments: [{ coords: [{ lat: 0, lng: 0, alt: 0 }, { lat: 0, lng: 0.01, alt: 0 }], is_highlighted: true, color: '#fff', lane_index: null }],
  maneuvers: [],
  duration_seconds: 60,
  distance_meters: 1113,
};

describe('NavigationEngine', () => {
  it('owns lifecycle and route matching without React', () => {
    const engine = new NavigationEngine({ now: () => 1000 });
    engine.setRoute(route);
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START' });

    const result = engine.acceptGpsFix({
      location: { lat: 0, lng: 0.002 },
      timestampMs: 1000,
      accuracyMeters: 5,
      speedMps: 12,
      headingDegrees: 90,
    });

    expect(result.accepted).toBe(true);
    expect(result.matched?.onRoute).toBe(true);
    expect(engine.snapshot().state.phase).toBe('navigating');
  });

  it('rejects an implausible jump while retaining the last trusted position', () => {
    const engine = new NavigationEngine();
    engine.setRoute(route);
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START' });
    engine.acceptGpsFix({ location: { lat: 0, lng: 0.001 }, timestampMs: 1000, accuracyMeters: 5, speedMps: 5, headingDegrees: 90 });
    const result = engine.acceptGpsFix({ location: { lat: 1, lng: 1 }, timestampMs: 2000, accuracyMeters: 50, speedMps: 5, headingDegrees: 90 });

    expect(result.accepted).toBe(false);
    expect(result.location?.lng).toBeCloseTo(0.001, 6);
  });

  it('can continue briefly through a GPS gap', () => {
    const engine = new NavigationEngine({ now: () => 6000 });
    engine.setRoute(route);
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START' });
    engine.acceptGpsFix({ location: { lat: 0, lng: 0.001 }, timestampMs: 1000, accuracyMeters: 5, speedMps: 10, headingDegrees: 90 });

    const result = engine.tickContinuity(6000);
    expect(result.accepted).toBe(true);
    expect(result.location?.lng).toBeGreaterThan(0.001);
  });
});

import type { SceneContext } from '../types';

describe('NavigationEngine scene way state', () => {
  it('persists the current OSM way and ordered way history across fixes', () => {
    const engine = new NavigationEngine();
    const scene: SceneContext = {
      buildings: [], signals: [], crossings: [], stops: [], trees: [], roads: [
        { osm_id: 1, node_ids: [10, 11], geometry: [{lat:0,lng:0},{lat:0,lng:0.001}], highway:'residential', name:null, lanes:2, oneway:false },
        { osm_id: 2, node_ids: [11, 12], geometry: [{lat:0,lng:0.001},{lat:0.001,lng:0.001}], highway:'residential', name:null, lanes:2, oneway:false },
      ], restrictions: [],
    };
    engine.setSceneContext(scene);
    engine.setRoute({
      segments: [{ coords: [{lat:0,lng:0,alt:0},{lat:0,lng:0.001,alt:0},{lat:0.001,lng:0.001,alt:0}], is_highlighted:true, color:'#fff', lane_index:null }],
      maneuvers: [], duration_seconds: 10, distance_meters: 200,
    });
    engine.dispatch({ type: 'PLAN', hasRoute: true });
    engine.dispatch({ type: 'START', hasRoute: true });
    engine.acceptGpsFix({ location:{lat:0,lng:0.0004}, timestampMs:1000, accuracyMeters:5, speedMps:10, headingDegrees:90 });
    engine.acceptGpsFix({ location:{lat:0.0002,lng:0.001}, timestampMs:2000, accuracyMeters:5, speedMps:10, headingDegrees:0 });
    const snapshot = engine.snapshot();
    expect(snapshot.currentWayId).toBe(2);
    expect(snapshot.waySequence).toEqual([1,2]);
  });

  it('treats a route replacement as a hard restriction-history boundary', () => {
    const scene: SceneContext = {
      buildings: [], signals: [], crossings: [], stops: [], trees: [],
      roads: [
        { osm_id: 10, node_ids: [1, 2], geometry: [{lat:0,lng:0},{lat:0,lng:0.001}], highway:'residential', name:null, lanes:2, oneway:false },
        { osm_id: 20, node_ids: [2, 3], geometry: [{lat:0,lng:0.001},{lat:0.001,lng:0.001}], highway:'residential', name:null, lanes:2, oneway:false },
        { osm_id: 30, node_ids: [3, 4], geometry: [{lat:0.001,lng:0.001},{lat:0.001,lng:0.002}], highway:'residential', name:null, lanes:2, oneway:false },
      ],
      restrictions: [{ osm_id: 900, restriction:'no_right_turn', from_way_ids:[10], to_way_ids:[20], via_node_ids:[2], via_way_ids:[], except:null }],
    };
    const engine = new NavigationEngine();
    engine.setSceneContext(scene);
    engine.setRoute({ segments:[{coords:[{lat:0,lng:0,alt:0},{lat:0,lng:0.001,alt:0}],is_highlighted:true,color:'#fff',lane_index:null}], maneuvers:[], duration_seconds:10, distance_meters:100 });
    engine.dispatch({type:'START'});
    engine.dispatch({type:'PLAN', hasRoute:true});
    engine.dispatch({type:'START'});
    engine.acceptGpsFix({location:{lat:0,lng:0.0008},timestampMs:1000,accuracyMeters:5,speedMps:8,headingDegrees:90});
    expect(engine.snapshot().waySequence).toEqual([10]);

    engine.setRoute({ segments:[{coords:[{lat:0.001,lng:0.001,alt:0},{lat:0.001,lng:0.002,alt:0}],is_highlighted:true,color:'#fff',lane_index:null}], maneuvers:[], duration_seconds:10, distance_meters:100 });
    const snapshot = engine.snapshot();
    expect(snapshot.waySequence).toEqual([]);
    expect(snapshot.currentWayId).toBeNull();
    expect(snapshot.routeGeneration).toBe(2);
  });

  it('keeps traveled restriction history across scene refreshes', () => {
    const scene: SceneContext = {
      buildings: [], signals: [], crossings: [], stops: [], trees: [],
      roads: [{ osm_id: 10, node_ids: [1,2], geometry:[{lat:0,lng:0},{lat:0,lng:0.001}], highway:'residential', name:null, lanes:2, oneway:false }], restrictions: []
    };
    const engine = new NavigationEngine();
    engine.setSceneContext(scene);
    engine.setRoute(route);
    engine.dispatch({type:'PLAN', hasRoute:true});
    engine.dispatch({type:'START', hasRoute:true});
    engine.acceptGpsFix({location:{lat:0,lng:0.0005},timestampMs:1000,accuracyMeters:5,speedMps:8,headingDegrees:90});
    engine.setSceneContext({...scene});
    expect(engine.snapshot().waySequence).toEqual([10]);
    expect(engine.snapshot().currentWayId).toBe(10);
  });

});
