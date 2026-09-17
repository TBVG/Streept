import { Location, Report, Route3DHighlight, TrafficVehicle } from '../types';
import {
  buildNavigationRouteIndex,
  deriveNavigationHealth,
  estimateNavigationEta,
  isPlausibleLocationFix,
  matchPosition,
  MatchedPosition,
  NavigationHealth,
  NavigationProgress,
  getNavigationProgress,
  NavigationRouteIndex,
} from './navigationCore';
import { estimateDeadReckonedLocation, continuityAccuracyMeters } from './navigationContinuity';
import { NavigationEvent, NavigationState, INITIAL_NAVIGATION_STATE, transitionNavigation } from './navigationState';
import { SceneContext } from '../types';
import { matchSceneWay } from './sceneWayMatcher';
import { evaluateRouteRestrictionTransitions } from './turnRestrictionGraph';
import { matchCurrentLane } from './currentLaneMatcher';
import { DriverLaneEstimate } from './laneIntelligence';
import { LaneChangeExecutionInput, LaneChangeExecutionState, LaneChangeExecutionTracker } from './laneChangeExecution';
import { mapLaneAcrossWays } from './laneContinuity';
import { LaneTrackingStability, observationFromMatch } from './laneTrackingStability';
import { MotionSensorSample, fuseMotion } from './sensorFusion';
import { classifyExtremeNavigation, ExtremeNavigationScenario } from './extremeNavigationScenarios';
import { deriveSpatialIntelligence, SpatialIntelligenceSnapshot } from './spatialIntelligence';
import { decideSpatialGuidance, SpatialGuidanceDecision } from './spatialGuidanceDecision';
import { SpatialGuidanceStabilizer } from './spatialGuidanceStability';
import { decideDriverAction, DriverDecision } from './driverDecision';
import { ManeuverOutcome, ManeuverOutcomeTracker } from './maneuverOutcome';
import { SpatialObservation, SpatialObservationLedger } from './observationLedger';
import { RoadIntelligenceScore, scoreRoadIntelligence } from './roadIntelligence';
import { adaptSpatialGuidance } from './adaptiveGuidance';
import { RouteLaneStrategy, buildRouteLaneStrategy } from './routeLaneStrategy';
import { ParkingLot, Billboard } from '../types';
import { buildSpatialWorldContext, SpatialWorldContext } from './worldContext';
import { assessWorldContextQuality, WorldContextQuality } from './worldContextQuality';
import { deriveSpatialPriorities, SpatialPriorityItem } from './spatialPriority';
import { getRoadIntelligenceBatch, getRoadIntelligenceTemporal, RoadIntelligenceTemporalBucket, syncSpatialObservations } from './spatialIntelligenceApi';
import { fuseRoadIntelligence, indexCommunityRoadIntelligence } from './communityRoadIntelligence';
import { buildSpatialMemorySnapshot, SpatialMemorySnapshot } from './spatialMemory';

export interface NavigationEngineSnapshot {
  state: NavigationState;
  route: Route3DHighlight | null;
  routeIndex: NavigationRouteIndex | null;
  matched: MatchedPosition | null;
  health: NavigationHealth;
  lastFixTimestampMs: number | null;
  gpsAccuracyMeters: number | null;
  speedMps: number | null;
  headingDegrees: number | null;
  motionConfidence: number;
  currentWayId: number | null;
  waySequence: number[];
  restrictionStatus: { prohibited: boolean; matchedRestrictionIds: number[]; unresolvedRestrictionIds: number[]; confidence: number };
  plannedWaySequence: number[];
  plannedRestrictionStatus: { prohibited: boolean; matchedRestrictionIds: number[]; unresolvedRestrictionIds: number[]; confidence: number };
  currentLane: DriverLaneEstimate | null;
  laneChangeExecution: LaneChangeExecutionState;
  routeGeneration: number;
  extremeScenario: ExtremeNavigationScenario;
  routeReacquire: boolean;
  spatialIntelligence: SpatialIntelligenceSnapshot;
  spatialGuidance: SpatialGuidanceDecision;
  driverDecision: DriverDecision;
  maneuverOutcome: ManeuverOutcome;
  spatialObservations: SpatialObservation[];
  roadIntelligence: RoadIntelligenceScore;
  routeLaneStrategy: RouteLaneStrategy;
  worldContext: SpatialWorldContext;
  worldContextQuality: WorldContextQuality;
  spatialPriorities: SpatialPriorityItem[];
  spatialMemory: SpatialMemorySnapshot;
}

export interface NavigationEngineOptions {
  initialState?: NavigationState;
  now?: () => number;
}

export interface GpsFixInput {
  location: Location;
  timestampMs: number;
  accuracyMeters?: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
  motion?: MotionSensorSample | null;
}

export interface NavigationFixResult {
  accepted: boolean;
  location: Location | null;
  matched: MatchedPosition | null;
  health: NavigationHealth;
  speedMps: number | null;
  headingDegrees: number | null;
  motionConfidence: number;
  currentWayId: number | null;
  waySequence: number[];
  restrictionStatus: { prohibited: boolean; matchedRestrictionIds: number[]; unresolvedRestrictionIds: number[]; confidence: number };
  currentLane: DriverLaneEstimate | null;
}

/**
 * Framework-neutral navigation runtime. It owns route matching, GPS quality,
 * short-horizon continuity and lifecycle transitions without importing React,
 * Leaflet or Cesium. A renderer only needs to feed fixes/events in and consume
 * snapshots/results out.
 */
export class NavigationEngine {
  private readonly now: () => number;
  private state: NavigationState;
  private route: Route3DHighlight | null = null;
  private routeIndex: NavigationRouteIndex | null = null;
  private matched: MatchedPosition | null = null;
  private lastFixTimestampMs: number | null = null;
  private lastFixLocation: Location | null = null;
  private gpsAccuracyMeters: number | null = null;
  private speedMps: number | null = null;
  private headingDegrees: number | null = null;
  private motionConfidence = 0;
  private scene: SceneContext | null = null;
  private roadReports: Report[] = [];
  private trafficVehicles: TrafficVehicle[] = [];
  private currentWayId: number | null = null;
  private waySequence: number[] = [];
  private plannedWaySequence: number[] = [];
  private currentLane: DriverLaneEstimate | null = null;
  private previousLaneWayId: number | null = null;
  private readonly laneChangeExecution = new LaneChangeExecutionTracker();
  private readonly laneTracking = new LaneTrackingStability();
  private routeGeneration = 0;
  private extremeScenario: ExtremeNavigationScenario = 'normal';
  private routeReacquire = false;
  private spatialIntelligence: SpatialIntelligenceSnapshot = deriveSpatialIntelligence(null, null, null, null);
  private spatialGuidance: SpatialGuidanceDecision = decideSpatialGuidance(this.spatialIntelligence, null);
  private driverDecision: DriverDecision = decideDriverAction({
    spatial: this.spatialIntelligence, guidance: this.spatialGuidance,
    restrictionProhibited: false, restrictionConfidence: 0, routeReacquire: false,
  });
  private readonly spatialGuidanceStability = new SpatialGuidanceStabilizer();
  private readonly maneuverOutcome = new ManeuverOutcomeTracker();
  private readonly observationLedger = new SpatialObservationLedger();
  private lastObservationSyncAt = 0;
  private observationSyncInFlight = false;
  private lastObservedManeuverOutcome = 'unknown';
  private roadIntelligence: RoadIntelligenceScore = scoreRoadIntelligence([], null);
  private routeLaneStrategy: RouteLaneStrategy = { steps: [], totalLaneChanges: 0, confidence: 0 };
  private parkingLots: ParkingLot[] = [];
  private billboards: Billboard[] = [];
  private worldContext: SpatialWorldContext = buildSpatialWorldContext(this.spatialIntelligence, null, [], [], [], []);
  private worldContextQuality: WorldContextQuality = assessWorldContextQuality(this.worldContext);
  private spatialPriorities: SpatialPriorityItem[] = [];
  private spatialMemory: SpatialMemorySnapshot = buildSpatialMemorySnapshot([], [], new Map(), null, Date.now(), []);
  private communityRoadIntelligence = new Map<number, import('./spatialIntelligenceApi').RoadIntelligenceAggregate>();
  private communityPrefetchGeneration = 0;
  private communityTemporal: RoadIntelligenceTemporalBucket[] = [];

  constructor(options: NavigationEngineOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.state = options.initialState ?? INITIAL_NAVIGATION_STATE;
  }

  dispatch(event: NavigationEvent): NavigationState {
    this.state = transitionNavigation(this.state, event);
    return this.state;
  }

  setRoute(route: Route3DHighlight | null): void {
    this.route = route;
    const polyline = this.getPolyline(route);
    this.routeIndex = polyline.length >= 2 ? buildNavigationRouteIndex(polyline) : null;
    this.matched = null;
    // A route replacement is a hard topology boundary. Never carry the old
    // traversed-way history into the new route: doing so can accidentally make
    // a multi-way OSM restriction appear active on an unrelated reroute.
    this.currentWayId = null;
    this.waySequence = [];
    this.currentLane = null;
    this.previousLaneWayId = null;
    this.laneTracking.reset();
    this.motionConfidence = 0;
    this.laneChangeExecution.reset();
    this.spatialGuidanceStability.reset();
    this.routeGeneration += 1;
    this.maneuverOutcome.reset(this.routeGeneration);
    this.extremeScenario = 'normal';
    this.routeReacquire = false;
    this.lastObservedManeuverOutcome = 'unknown';
    this.plannedWaySequence = this.scene ? this.deriveRouteWaySequence(polyline) : [];
    this.communityTemporal = [];
    this.refreshSpatialIntelligence();
    this.prefetchCommunityRoadIntelligence();
  }

  /** Feed live road intelligence into the canonical navigation context. The UI
   * may own the socket/polling lifecycle, but the engine remains the single
   * source for spatial decisions and never invents traffic facts. */
  setSpatialAmenities(parkingLots: ParkingLot[] = [], billboards: Billboard[] = []): void {
    this.parkingLots = [...parkingLots];
    this.billboards = [...billboards];
    this.refreshSpatialIntelligence();
  }

  setRoadIntelligence(reports: Report[] = [], trafficVehicles: TrafficVehicle[] = []): void {
    this.roadReports = [...reports];
    this.trafficVehicles = [...trafficVehicles];
    this.refreshSpatialIntelligence();
  }

  /** Attach the current local OSM scene. The engine keeps this context so way
   * identity persists across GPS fixes instead of being recomputed by UI code. */
  setSceneContext(scene: SceneContext | null): void {
    this.scene = scene;
    const polyline = this.getPolyline(this.route);
    this.plannedWaySequence = scene ? this.deriveRouteWaySequence(polyline) : [];
    this.currentLane = null;
    this.previousLaneWayId = null;
    this.laneTracking.reset();
    this.laneChangeExecution.reset();
    this.spatialGuidanceStability.reset();
    this.refreshSpatialIntelligence();
    this.prefetchCommunityRoadIntelligence();
    // Scene refreshes replace the map evidence, not the navigation session.
    // Keep trusted traversed-way history so a tile refresh cannot manufacture
    // a new restriction prefix or erase the current carriageway identity.
  }

  acceptGpsFix(input: GpsFixInput): NavigationFixResult {
    const previous = this.lastFixLocation;
    const previousTimestamp = this.lastFixTimestampMs;
    const previousHeading = this.headingDegrees;
    const accepted = isPlausibleLocationFix({
      previous,
      next: input.location,
      previousTimestampMs: previousTimestamp,
      timestampMs: input.timestampMs,
      accuracyMeters: input.accuracyMeters ?? null,
      reportedSpeedMps: input.speedMps ?? null,
    });

    if (!accepted) {
      return {
        accepted: false,
        location: previous ?? this.matched?.location ?? null,
        matched: this.matched,
        health: this.getHealth(),
        speedMps: this.speedMps,
        headingDegrees: this.headingDegrees,
        motionConfidence: this.motionConfidence,
        currentWayId: this.currentWayId,
        waySequence: [...this.waySequence],
        restrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence),
        currentLane: this.currentLane,
      };
    }

    const fused = fuseMotion({
      location: input.location,
      previousLocation: previous,
      previousTimestampMs: previousTimestamp,
      timestampMs: input.timestampMs,
      gpsSpeedMps: input.speedMps,
      gpsHeadingDegrees: input.headingDegrees,
      gpsAccuracyMeters: input.accuracyMeters ?? null,
      motion: input.motion ?? null,
    });
    const speed = fused.speedMps;
    const heading = fused.headingDegrees;
    this.speedMps = speed;
    this.motionConfidence = fused.confidence;
    if (heading != null) this.headingDegrees = heading;
    this.gpsAccuracyMeters = input.accuracyMeters ?? null;
    this.lastFixLocation = input.location;
    this.lastFixTimestampMs = input.timestampMs;

    const polyline = this.getPolyline(this.route);
    if (this.state.sessionActive && polyline.length >= 2) {
      const routeBearing = this.matched ? this.routeBearingNearProgress(this.matched.progressMeters) : null;
      const scenario = classifyExtremeNavigation({
        previousLocation: previous,
        currentLocation: input.location,
        previousHeadingDegrees: previousHeading,
        currentHeadingDegrees: heading,
        speedMps: speed,
        accuracyMeters: input.accuracyMeters ?? null,
        previousProgressMeters: this.matched?.progressMeters ?? null,
        currentProgressMeters: null,
        routeBearingDegrees: routeBearing,
      });
      this.extremeScenario = scenario.scenario;
      this.routeReacquire = scenario.shouldReacquireRoute;
      const matched = matchPosition(
        input.location,
        polyline,
        this.matched?.progressMeters ?? null,
        heading,
        this.matched?.segmentIndex ?? null,
        this.routeIndex,
        scenario.allowReverseProgress,
        scenario.matchingWindowSegments,
      );
      this.matched = scenario.confidenceCap == null ? matched : { ...matched, confidence: Math.min(matched.confidence, scenario.confidenceCap) };
      this.updateSceneWayState(input.location);
      this.updateCurrentLane(input.location);
      this.refreshSpatialIntelligence();
    } else {
      this.matched = null;
      this.currentWayId = null;
    }

    return {
      accepted: true,
      location: this.matched?.location ?? input.location,
      matched: this.matched,
      health: this.getHealth(),
      speedMps: this.speedMps,
      headingDegrees: this.headingDegrees,
      motionConfidence: this.motionConfidence,
      currentWayId: this.currentWayId,
      waySequence: [...this.waySequence],
      restrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence),
      currentLane: this.currentLane,
    };
  }

  tickContinuity(nowMs = this.now()): NavigationFixResult {
    if (!this.state.sessionActive || this.lastFixTimestampMs == null || !this.lastFixLocation) {
      return this.emptyResult();
    }
    const estimate = estimateDeadReckonedLocation({
      lastLocation: this.lastFixLocation,
      lastFixTimestampMs: this.lastFixTimestampMs,
      speedMps: this.speedMps,
      headingDegrees: this.headingDegrees,
      nowMs,
      maxDurationMs: 15000,
    });
    if (!estimate) return this.emptyResult();

    const polyline = this.getPolyline(this.route);
    if (polyline.length >= 2) {
      const predicted = matchPosition(
        estimate.location,
        polyline,
        this.matched?.progressMeters ?? null,
        this.headingDegrees,
        this.matched?.segmentIndex ?? null,
        this.routeIndex,
      );
      this.matched = { ...predicted, confidence: Math.min(predicted.confidence, estimate.confidence) };
      this.updateSceneWayState(estimate.location);
      this.updateCurrentLane(estimate.location);
      this.refreshSpatialIntelligence();
    } else {
      this.matched = null;
    }
    this.gpsAccuracyMeters = continuityAccuracyMeters(estimate.elapsedMs);

    return {
      accepted: true,
      location: this.matched?.location ?? estimate.location,
      matched: this.matched,
      health: this.getHealth(nowMs),
      speedMps: this.speedMps,
      headingDegrees: this.headingDegrees,
      motionConfidence: this.motionConfidence,
      currentWayId: this.currentWayId,
      waySequence: [...this.waySequence],
      restrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence),
      currentLane: this.currentLane,
    };
  }

  private routeBearingNearProgress(progressMeters: number | null): number | null {
    const polyline = this.getPolyline(this.route);
    if (progressMeters == null || polyline.length < 2) return null;
    const index = this.routeIndex;
    if (!index) return null;
    let i = 0;
    while (i < index.cumulativeMeters.length - 1 && index.cumulativeMeters[i + 1] < progressMeters) i += 1;
    const a = polyline[Math.min(i, polyline.length - 2)];
    const b = polyline[Math.min(i + 1, polyline.length - 1)];
    const y = Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
    const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  getProgress(destination: Location | null, routeDistanceMeters: number | null): NavigationProgress {
    const polyline = this.getPolyline(this.route);
    return this.matched
      ? getNavigationProgress(this.matched.location, polyline, destination, routeDistanceMeters)
      : getNavigationProgress(destination ?? { lat: 0, lng: 0 }, polyline, destination, routeDistanceMeters);
  }

  getEta(routeDistanceMeters: number | null, routeDurationSeconds: number | null, nowMs = this.now()) {
    return estimateNavigationEta(this.matched?.progressMeters ?? null, routeDistanceMeters, routeDurationSeconds, this.speedMps, nowMs);
  }

  getHealth(nowMs = this.now()): NavigationHealth {
    return deriveNavigationHealth(this.matched, this.lastFixTimestampMs, nowMs);
  }

  snapshot(): NavigationEngineSnapshot {
    return {
      state: this.state,
      route: this.route,
      routeIndex: this.routeIndex,
      matched: this.matched,
      health: this.getHealth(),
      lastFixTimestampMs: this.lastFixTimestampMs,
      gpsAccuracyMeters: this.gpsAccuracyMeters,
      speedMps: this.speedMps,
      headingDegrees: this.headingDegrees,
      motionConfidence: this.motionConfidence,
      currentWayId: this.currentWayId,
      waySequence: [...this.waySequence],
      restrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence),
      plannedWaySequence: [...this.plannedWaySequence],
      plannedRestrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.plannedWaySequence),
      currentLane: this.currentLane,
      laneChangeExecution: this.laneChangeExecution.snapshot(),
      routeGeneration: this.routeGeneration,
      extremeScenario: this.extremeScenario,
      routeReacquire: this.routeReacquire,
      spatialIntelligence: this.spatialIntelligence,
      spatialGuidance: this.spatialGuidance,
      driverDecision: this.driverDecision,
      maneuverOutcome: this.maneuverOutcome.snapshot(),
      spatialObservations: this.observationLedger.snapshot(),
      roadIntelligence: this.roadIntelligence,
      routeLaneStrategy: this.routeLaneStrategy,
      worldContext: this.worldContext,
      worldContextQuality: this.worldContextQuality,
      spatialPriorities: [...this.spatialPriorities],
      spatialMemory: this.spatialMemory,
    };
  }

  updateLaneChangeExecution(input: LaneChangeExecutionInput): LaneChangeExecutionState {
    return this.laneChangeExecution.update(input);
  }

  private updateSceneWayState(location: Location): void {
    if (!this.scene) return;
    const match = matchSceneWay(location, this.scene.roads, this.currentWayId, 70);
    if (!match) return;
    // Only advance topology forward. GPS noise may briefly snap to a parallel
    // way; accepting arbitrary backwards jumps would corrupt multi-way
    // restriction history. A new route resets this state.
    this.currentWayId = match.wayId;
    if (this.waySequence[this.waySequence.length - 1] !== match.wayId) {
      this.waySequence.push(match.wayId);
      if (this.waySequence.length > 32) this.waySequence.splice(0, this.waySequence.length - 32);
    }
  }

  private updateCurrentLane(location: Location): void {
    if (!this.scene) return;
    const match = matchCurrentLane(location, this.scene.roads, this.headingDegrees, this.currentWayId, 35)
      ?? matchCurrentLane(location, this.scene.roads, this.headingDegrees, null, 35);
    if (!match) return;

    const previousWay = this.previousLaneWayId != null
      ? this.scene.roads.find((road) => road.osm_id === this.previousLaneWayId) ?? null
      : null;
    const currentWay = match.wayId != null
      ? this.scene.roads.find((road) => road.osm_id === match.wayId) ?? null
      : null;
    const carried = match.wayId !== this.previousLaneWayId
      ? mapLaneAcrossWays(this.currentLane?.laneIndex ?? null, previousWay, currentWay)
      : null;

    let laneIndex = match.laneIndex;
    let confidence = match.confidence;
    if (carried && carried.confidence > 0.6 && match.confidence < 0.78) {
      laneIndex = carried.laneIndex;
      confidence = Math.max(match.confidence, carried.confidence * 0.92);
    } else if (carried && carried.laneIndex === match.laneIndex) {
      confidence = Math.min(1, Math.max(match.confidence, carried.confidence));
    }

    if (laneIndex == null) return;
    const observation = observationFromMatch(
      { ...match, laneIndex, confidence },
      this.lastFixTimestampMs ?? this.now(),
      this.gpsAccuracyMeters,
      this.speedMps,
    );
    const decision = this.laneTracking.update(observation);
    if (decision.laneIndex == null) return;
    laneIndex = decision.laneIndex;
    confidence = decision.confidence;

    this.currentLane = {
      laneIndex,
      confidence,
      lateralMeters: match.lateralMeters,
      roadWidthMeters: match.roadWidthMeters,
    };
    this.previousLaneWayId = match.wayId;
  }

  private deriveRouteWaySequence(polyline: Location[]): number[] {
    if (!this.scene || polyline.length < 2) return [];
    // Avoid circular imports by using the same segment matcher directly.
    const sequence: number[] = [];
    let previous: number | null = null;
    for (const point of polyline) {
      const next = polyline[polyline.indexOf(point) + 1] ?? point;
      const dLng = (next.lng - point.lng) * Math.PI / 180;
      const lat1 = point.lat * Math.PI / 180;
      const lat2 = next.lat * Math.PI / 180;
      const y = Math.sin(dLng) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
      const heading = next === point ? null : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      const match = matchSceneWay(point, this.scene.roads, previous, 45, heading);
      if (!match) continue;
      previous = match.wayId;
      if (sequence[sequence.length - 1] !== match.wayId) sequence.push(match.wayId);
    }
    return sequence;
  }

  private refreshSpatialIntelligence(): void {
    this.routeLaneStrategy = this.route?.maneuvers?.length
      ? buildRouteLaneStrategy(this.route.maneuvers, this.currentLane?.laneIndex ?? null, this.currentLane?.confidence ?? 0.5, 4)
      : { steps: [], totalLaneChanges: 0, confidence: this.currentLane?.confidence ?? 0.5 };
    this.spatialIntelligence = deriveSpatialIntelligence(
      this.matched?.location ?? this.lastFixLocation,
      this.route,
      this.scene,
      this.currentWayId,
      this.roadReports,
      this.trafficVehicles,
      undefined,
      this.currentLane?.laneIndex ?? null,
      this.plannedWaySequence,
    );
    const baseGuidance = decideSpatialGuidance(this.spatialIntelligence, this.speedMps);
    const restrictionStatus = evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence);
    const maneuverOutcome = this.maneuverOutcome.update({ spatial: this.spatialIntelligence, routeGeneration: this.routeGeneration });
    const outcomeKey = `${maneuverOutcome.status}|${maneuverOutcome.maneuverKey ?? ''}|${maneuverOutcome.completedCount}|${maneuverOutcome.missedCount}`;
    if (outcomeKey !== this.lastObservedManeuverOutcome) {
      if (maneuverOutcome.status === 'completed' || maneuverOutcome.status === 'missed') {
        this.observationLedger.recordManeuverOutcome(maneuverOutcome, this.spatialIntelligence, this.routeGeneration);
      }
      this.lastObservedManeuverOutcome = outcomeKey;
    }
    // Score after recording the latest outcome so the next guidance decision
    // can immediately learn from the maneuver just completed or missed.
    const localRoadIntelligence = scoreRoadIntelligence(this.observationLedger.snapshot(), this.spatialIntelligence.wayId);
    this.roadIntelligence = fuseRoadIntelligence(localRoadIntelligence, this.spatialIntelligence.wayId != null ? this.communityRoadIntelligence.get(this.spatialIntelligence.wayId) : null);
    this.spatialMemory = buildSpatialMemorySnapshot(
      this.plannedWaySequence,
      this.observationLedger.snapshot(),
      this.communityRoadIntelligence,
      this.spatialIntelligence.wayId,
      this.now(),
      this.communityTemporal,
    );
    // Predictive memory is advisory. It may raise attention only when its
    // confidence is meaningful; it never bypasses hard route restrictions.
    // Upload only coarse, already-redacted observations. Keep navigation fully
    // local-first: a failed sync never blocks GPS, guidance, or rerouting.
    if (!this.observationSyncInFlight && this.now() - this.lastObservationSyncAt >= 15_000) {
      this.lastObservationSyncAt = this.now();
      this.observationSyncInFlight = true;
      void this.observationLedger.flushToCloud(syncSpatialObservations, 50).finally(() => {
        this.observationSyncInFlight = false;
      });
    }

    const routeLocations = this.getPolyline(this.route);
    this.worldContext = buildSpatialWorldContext(this.spatialIntelligence, this.matched?.location ?? null, this.parkingLots, this.billboards, this.roadReports, this.trafficVehicles, routeLocations, this.now());
    this.worldContextQuality = assessWorldContextQuality(this.worldContext);
    this.spatialPriorities = deriveSpatialPriorities(this.worldContext, this.spatialIntelligence.maneuverDistanceMeters);
    const predictiveRoadIntelligence = this.spatialMemory.current.confidence >= 0.45 && this.spatialMemory.current.predictedScore > this.roadIntelligence.score
      ? { ...this.roadIntelligence, score: this.spatialMemory.current.predictedScore, confidence: Math.min(this.roadIntelligence.confidence + 0.08, this.spatialMemory.current.confidence) }
      : this.roadIntelligence;
    this.spatialGuidance = this.spatialGuidanceStability.update(
      adaptSpatialGuidance(baseGuidance, predictiveRoadIntelligence, this.spatialIntelligence.maneuverDistanceMeters),
      this.now(),
    );
    this.driverDecision = decideDriverAction({
      spatial: this.spatialIntelligence,
      guidance: this.spatialGuidance,
      restrictionProhibited: restrictionStatus.prohibited,
      restrictionConfidence: restrictionStatus.confidence,
      routeReacquire: this.routeReacquire,
    });
  }

  private prefetchCommunityRoadIntelligence(): void {
    const wayIds = Array.from(new Set(this.plannedWaySequence.filter((id) => Number.isFinite(id) && id > 0)));
    if (!wayIds.length) return;
    const generation = ++this.communityPrefetchGeneration;
    void Promise.all([getRoadIntelligenceBatch(wayIds, 30), getRoadIntelligenceTemporal(wayIds, 30)]).then(([items, temporal]) => {
      if (generation !== this.communityPrefetchGeneration) return;
      this.communityRoadIntelligence = indexCommunityRoadIntelligence(items);
      this.communityTemporal = temporal;
      this.refreshSpatialIntelligence();
    }).catch(() => {
      // Community intelligence is advisory. Navigation continues entirely locally.
    });
  }

  private emptyResult(): NavigationFixResult {
    return {
      accepted: false,
      location: this.matched?.location ?? this.lastFixLocation,
      matched: this.matched,
      health: this.getHealth(),
      speedMps: this.speedMps,
      headingDegrees: this.headingDegrees,
      motionConfidence: this.motionConfidence,
      currentWayId: this.currentWayId,
      waySequence: [...this.waySequence],
      restrictionStatus: evaluateRouteRestrictionTransitions(this.scene?.restrictions, this.waySequence),
      currentLane: this.currentLane,
    };
  }

  private getPolyline(route: Route3DHighlight | null): Location[] {
    if (!route) return [];
    return route.segments.flatMap((segment) => segment.coords.map((coord) => ({ lat: coord.lat, lng: coord.lng })));
  }

}
