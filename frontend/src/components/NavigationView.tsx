import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import './NavigationView.css';
import ImmersiveTurnView from './ImmersiveTurnView';
import { getRoute, getParking, getParkedCars, getReports, getBillboards, checkinParking, checkoutParking, parkingHeartbeat, createReport, confirmReport, dismissReport, purchaseBillboard, clickBillboard, getWebSocketUrl, searchPlaces, getRecentDestinations, addRecentDestination, prefetchSceneContext, getLiveTraffic, getLiveTrafficVehicles } from '../services/api';
import { Location, Route3DHighlight, ParkingLot, ParkedCar, Report, Billboard, Maneuver, WsEvent, GeocodeResult, SceneContext } from '../types';
import { haversineDistanceMeters, projectOntoPolyline, bearingDegrees, signedLateralOffset } from '../utils/geo';
import { Theme } from '../hooks/useTheme';
import { rankRoutesWithRisk, routeRiskSummary } from '../navigation/routeQuality';
import { buildRouteDecisionProfiles, rankRoutesBySpatialIntelligence, RouteDecisionProfile } from '../navigation/routeDecisionIntelligence';
import { buildRouteIntelligenceGraph } from '../navigation/routeIntelligenceGraph';
import { presentNavigationIntelligence } from '../navigation/intelligencePresentation';
import { getRoadIntelligenceBatch } from '../navigation/spatialIntelligenceApi';
import { buildNavigationRouteIndex, deriveNavigationHealth, estimateNavigationEta, getNavigationProgress, smoothLocation } from '../navigation/navigationCore';
import { estimateDeadReckonedLocation, isGpsContinuityGap, continuityAccuracyMeters } from '../navigation/navigationContinuity';
import { speakNavigationPrompt } from '../navigation/voiceGuidance';
import { buildSpatialNavigationPlan } from '../navigation/spatialNavigationEngine';
import { laneGuidanceLabel, estimateDriverLane } from '../navigation/laneIntelligence';
import { buildDestinationLaneTiming } from '../navigation/destinationLaneIntelligence';
import { stageLaneChange } from '../navigation/laneChangeStaging';
import { planPredictiveLaneChange } from '../navigation/predictiveLanePlanning';
import { LaneChangeExecutionState, laneChangeExecutionPrompt } from '../navigation/laneChangeExecution';
import { buildSceneGuidancePlan } from '../navigation/sceneGuidance';
import { assessLaneChangeReachability } from '../navigation/laneChangeReachability';
import { decideUnifiedManeuver } from '../navigation/maneuverDecision';
import { clearNavigationSession, readNavigationSession, saveNavigationSession, touchNavigationSession } from '../navigation/navigationPersistence';
import { NavigationPhase, NavigationEvent } from '../navigation/navigationState';
import { NavigationEngine } from '../navigation/navigationEngine';
import { rankParkingLots } from '../navigation/parkingIntelligence';
import ArOverlay from './ArOverlay';
import { recordNavigationMetric } from '../navigation/telemetry';
import { LiveTrafficStream } from '../navigation/liveTrafficStream';
import { isTrustedRoute } from '../navigation/routeIntegrity';
import { toLaneOccupantObservations } from '../navigation/trafficVehicleAdapter';
import { getSavedPlaces, isSavedPlace, savePlace, removeSavedPlace, SavedPlace } from '../navigation/savedPlaces';
import { smartSearch, SEARCH_CATEGORY_PRESETS, SmartSearchResult } from '../navigation/smartSearch';
import { readOfflineTrip, writeOfflineTrip } from '../navigation/offlineStore';
import { cacheRouteMapTiles } from '../navigation/offlineMapCache';
import { analyzeTrip, findTripStops } from '../navigation/tripIntelligenceApi';
import { TripIntelligenceSummary } from '../navigation/tripIntelligence';
import { rankTripAlternatives, TripRouteRank } from '../navigation/tripRouteRanking';
import L from 'leaflet';

// Vite/webpack bundle Leaflet's default marker images under hashed URLs,
// which breaks Leaflet's built-in path lookup. Re-point it at the bundled
// assets so the default (non-custom-icon) markers actually render.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface NavigationViewProps {
  currentUserId: string;
  theme: Theme;
  onToggleTheme: () => void;
}

// How far ahead (in time, not distance) we want to warn about an upcoming
// turn — the actual trigger distance is speedMps * this, clamped to a
// sane range, so a highway merge at 65mph gets much more lead distance
// than a city turn at 20mph.
const LOOKAHEAD_SECONDS = 8;
const MIN_TRIGGER_DISTANCE_M = 120;
const MAX_TRIGGER_DISTANCE_M = 800;
// How close counts as "reached" — once inside this radius we consider the
// maneuver handled and advance to watching the next one.
const MANEUVER_PASS_DISTANCE_M = 25;
// How far off the planned route (meters) counts as "no longer following
// it" — a missed turn, a wrong exit, construction detour, etc. — and
// should trigger a fresh route request from the current position.
const OFF_ROUTE_DISTANCE_M = 50;
const REROUTE_COOLDOWN_MS = 10000;
// Well inside the backend's 3-hour stale-occupancy threshold — someone
// can be parked for a long time, so this doesn't need to be frequent,
// just frequent enough that a few missed/slow requests in a row don't
// cause a spurious auto-checkout.
const PARKING_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

// Maps OSRM lane "indications" to a directional glyph for the lane
// guidance strip. A lane can have multiple indications (e.g. a shared
// through/right lane) — this picks the first as the primary glyph shown.
const LANE_INDICATION_ARROW: Record<string, string> = {
  left: '⬅',
  right: '➡',
  straight: '⬆',
  through: '⬆',
  'slight left': '↖',
  'slight right': '↗',
  'sharp left': '↙',
  'sharp right': '↘',
  uturn: '↩',
};

const REPORT_TYPE_META: Record<string, { label: string; emoji: string }> = {
  cop: { label: 'Police', emoji: '🚓' },
  hazard: { label: 'Hazard', emoji: '⚠️' },
  construction: { label: 'Construction', emoji: '🚧' },
  accident: { label: 'Accident', emoji: '💥' },
  traffic_jam: { label: 'Traffic Jam', emoji: '🚦' },
  closed_lane: { label: 'Closed Lane', emoji: '🚫' },
};

// The 2D map uses Esri's public legacy Dark Gray Canvas raster services.
// These endpoints do not require a Streept/CARTO API key and give us the dark
// navigation-oriented appearance without sending tile traffic to OSM's
// volunteer-run tile servers.
const LEAFLET_BASE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const LEAFLET_REFERENCE_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}';

function getLeafletAttribution(): string {
  return [
    '<a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>',
    'HERE',
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    'GIS user community',
  ].join(' &middot; ');
}

// Route line color, mirrored from the CSS design tokens in App.css.
// Kept as a literal JS constant because Leaflet path options are JS values,
// not stylesheet declarations. Streept's navigation route is intentionally electric green.
const ROUTE_LINE_COLOR: Record<Theme, string> = {
  dark: '#20F28A',
  light: '#16B968',
};

const NavigationView: React.FC<NavigationViewProps> = ({ currentUserId, theme, onToggleTheme }) => {
  const [splitView, setSplitView] = useState(false);
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(() => readNavigationSession()?.destination ?? null);
  const [routeOptions, setRouteOptions] = useState<Route3DHighlight[]>(() => readNavigationSession()?.routeOptions ?? []);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(() => readNavigationSession()?.selectedRouteIndex ?? 0);
  const [routeDecisionProfiles, setRouteDecisionProfiles] = useState<RouteDecisionProfile[]>([]);
  const [tripIntelligence, setTripIntelligence] = useState<TripIntelligenceSummary | null>(null);
  const [tripStops, setTripStops] = useState<Awaited<ReturnType<typeof findTripStops>>>([]);
  const [tripIntelligenceLoading, setTripIntelligenceLoading] = useState(false);
  const [tripRouteRanks, setTripRouteRanks] = useState<TripRouteRank[]>([]);
  const [routeCommunityIntelligence, setRouteCommunityIntelligence] = useState<Map<number, import('../navigation/spatialIntelligenceApi').RoadIntelligenceAggregate>>(new Map());
  // Kept as a plain derived value (not state) so every existing piece of
  // logic below that already reads `route` — split-view trigger, 3D
  // rendering, off-route detection — keeps working unchanged regardless
  // of how many alternates exist or which one's picked.
  const candidateRoute = routeOptions[selectedRouteIndex] ?? null;
  const route = isTrustedRoute(candidateRoute) ? candidateRoute : null;
  const [parkingLots, setParkingLots] = useState<ParkingLot[]>([]);
  const [destinationParkingLots, setDestinationParkingLots] = useState<ParkingLot[]>([]);
  const [destinationParkingLoading, setDestinationParkingLoading] = useState(false);
  const [selectedParkingLotId, setSelectedParkingLotId] = useState<string | null>(null);
  const [parkedCars, setParkedCars] = useState<ParkedCar[]>([]);
  const [showParkingPanel, setShowParkingPanel] = useState(false);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showReportsLayer, setShowReportsLayer] = useState(true);
  const [showTrafficLayer, setShowTrafficLayer] = useState(true);
  const [parkingOnly, setParkingOnly] = useState(true);
  const [reports, setReports] = useState<Report[]>([]);
  const [liveTraffic, setLiveTraffic] = useState<Report[]>([]);
  const [liveTrafficVehicles, setLiveTrafficVehicles] = useState<import('../types').TrafficVehicle[]>([]);
  const [billboards, setBillboards] = useState<Billboard[]>([]);
  // Index into route.maneuvers.filter(m => m.is_complex) — the next turn
  // we're watching proximity against. Advances as each turn is passed.
  const [maneuverIndex, setManeuverIndex] = useState(() => readNavigationSession()?.maneuverIndex ?? 0);
  const [activeManeuver, setActiveManeuver] = useState<Maneuver | null>(null);
  const [speedMps, setSpeedMps] = useState(0);
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);
  // Which lot the auto-detection logic currently believes the driver is
  // parked at — null means "not parked". Driven entirely by GPS
  // proximity + sustained low speed (see the detection effect below), not
  // any manual action.
  const [parkedLotId, setParkedLotId] = useState<string | null>(null);
  const [showArOverlay, setShowArOverlay] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => readNavigationSession()?.destinationLabel ?? '');
  const [searchResults, setSearchResults] = useState<SmartSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  // Explicit trip-planning start point — Google/Apple Maps style. Left
  // null (the default, "Your location") means the route origin is live
  // GPS. When set to something else, this becomes a *preview* of a route
  // between two arbitrary points rather than live navigation — see the
  // guard on the split-view/reroute effects below for why those are
  // disabled in that mode.
  const [customStart, setCustomStart] = useState<Location | null>(() => readNavigationSession()?.customStart ?? null);
  const [startQuery, setStartQuery] = useState(() => readNavigationSession()?.startLabel ?? '');
  const [startResults, setStartResults] = useState<GeocodeResult[]>([]);
  const [startLoading, setStartLoading] = useState(false);
  const [startSearchError, setStartSearchError] = useState(false);
  const [showStartResults, setShowStartResults] = useState(false);
  const restoredSession = readNavigationSession();
  const navigationEngineRef = useRef<NavigationEngine | null>(null);
  if (!navigationEngineRef.current) {
    navigationEngineRef.current = new NavigationEngine({
      initialState: {
        phase: (restoredSession?.navigationPhase ?? 'idle') as NavigationPhase,
        sessionActive: restoredSession?.navigationPhase === 'navigating' || restoredSession?.navigationPhase === 'rerouting',
      },
    });
  }
  const [navigationState, setNavigationState] = useState(() => navigationEngineRef.current!.snapshot().state);
  const [navigationEngineSnapshot, setNavigationEngineSnapshot] = useState(() => navigationEngineRef.current!.snapshot());
  useEffect(() => {
    const engine = navigationEngineRef.current;
    if (!engine) return;
    engine.setRoadIntelligence([...reports, ...liveTraffic], liveTrafficVehicles);
    engine.setSpatialAmenities(parkingLots, billboards);
    setNavigationEngineSnapshot(engine.snapshot());
  }, [reports, liveTraffic, liveTrafficVehicles, parkingLots, billboards]);
  const navigationPhase = navigationState.phase;
  const navigationStarted = navigationState.sessionActive;
  const dispatchNavigation = (event: NavigationEvent) => {
    const next = navigationEngineRef.current!.dispatch(event);
    setNavigationState(next);
    setNavigationEngineSnapshot(navigationEngineRef.current!.snapshot());
  };
  const [routePreviewFocused, setRoutePreviewFocused] = useState(true);
  // Ref mirror prevents asynchronous route requests from accidentally
  // dropping an active navigation session back into trip-preview mode.
  const navigationSessionRef = useRef(false);
  const routeRequestIdRef = useRef(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [recentDestinations, setRecentDestinations] = useState<GeocodeResult[]>(() => getRecentDestinations());
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>(() => getSavedPlaces());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [gpsStatus, setGpsStatus] = useState<'locating' | 'good' | 'weak' | 'lost'>('locating');
  const [navigationConfidence, setNavigationConfidence] = useState(0);
  const [currentLaneEstimate, setCurrentLaneEstimate] = useState<{ laneIndex: number | null; confidence: number } | null>(null);
  const [laneExecution, setLaneExecution] = useState<LaneChangeExecutionState | null>(null);
  const [sceneContext, setSceneContext] = useState<SceneContext | null>(null);
  const [gpsLastUpdateMs, setGpsLastUpdateMs] = useState<number | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => { try { return localStorage.getItem('streept_voice_enabled') !== '0'; } catch { return true; } });
  const [hazardRefreshAt, setHazardRefreshAt] = useState(0);
  const [interactionToast, setInteractionToast] = useState<string | null>(null);
  const interactionToastTimerRef = useRef<number | null>(null);
  const liveTrafficStreamRef = useRef<LiveTrafficStream | null>(null);
  if (!liveTrafficStreamRef.current) liveTrafficStreamRef.current = new LiveTrafficStream();

  // Live road intelligence refreshes during active navigation. The endpoint is
  // deliberately narrow and cached server-side so this can later switch to a
  // dedicated traffic ingestion provider without changing the UI contract.
  useEffect(() => {
    if (!navigationStarted || !userLocation) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [data, vehicles] = await Promise.all([
          getLiveTraffic(userLocation, 2500),
          getLiveTrafficVehicles(userLocation, 2500),
        ]);
        if (!cancelled) {
          const snapshot = liveTrafficStreamRef.current!.replace(data);
          const vehicleSnapshot = liveTrafficStreamRef.current!.replaceVehicles(vehicles);
          setLiveTraffic(snapshot.reports);
          setLiveTrafficVehicles(vehicleSnapshot.vehicles);
        }
      } catch {
        recordNavigationMetric('traffic_refresh_failed');
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [navigationStarted, userLocation?.lat, userLocation?.lng]);

  // Which billboard's purchase form is currently open, plus its draft
  // field values and any submission error.
  const [billboardFormId, setBillboardFormId] = useState<string | null>(null);
  const [billboardFormAdImage, setBillboardFormAdImage] = useState('');
  const [billboardFormAdTarget, setBillboardFormAdTarget] = useState('');
  const [billboardFormDurationHours, setBillboardFormDurationHours] = useState(24);
  const [billboardSubmitting, setBillboardSubmitting] = useState(false);
  const [billboardError, setBillboardError] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const followMapRef = useRef(true);
  const lastMapFollowAtRef = useRef(0);
  const hasCenteredOnLocationRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  // Last GPS fix + timestamp, for computing speed when the browser doesn't
  // report position.coords.speed (common on desktop/simulated locations).
  const lastFixRef = useRef<{ loc: Location; t: number } | null>(null);
  const lastRerouteAtRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeoutRef = useRef<number | null>(null);
  const wsReconnectAttemptRef = useRef(0);
  // Mirrors `userLocation` for reading inside the WebSocket's onopen
  // handler, which is created once (empty effect deps) and would otherwise
  // close over a stale null value from the first render.
  const userLocationRef = useRef<Location | null>(null);
  const routePolylineRef = useRef<Location[]>([]);
  const matchedProgressRef = useRef<number | null>(null);
  const matchedSegmentIndexRef = useRef<number | null>(null);
  const routeIndexRef = useRef<ReturnType<typeof buildNavigationRouteIndex> | null>(null);
  const smoothedLocationRef = useRef<Location | null>(null);
  const gpsAccuracyRef = useRef<number | null>(null);
  const speedMpsRef = useRef<number | null>(null);
  const headingDegRef = useRef<number | null>(null);
  const offRouteSamplesRef = useRef(0);
  const spokenGuidanceRef = useRef<Set<string>>(new Set());

  // The immersive pane owns all 3D rendering. Keeping one 3D renderer avoids
  // running a hidden WebGL map alongside the visible Cesium scene.

  // Leaflet's MapContainer `center` prop is only the initial center. GPS can
  // arrive after the map has mounted, so explicitly move the map to the first
  // trustworthy fix. This is the behaviour users expect from a navigation app.
  useEffect(() => {
    if (!userLocation || !mapRef.current || hasCenteredOnLocationRef.current) return;
    hasCenteredOnLocationRef.current = true;
    mapRef.current.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 0.9 });
  }, [userLocation]);

  // Re-center whenever a newly requested destination is selected only through
  // the explicit locate control below; ordinary GPS updates do not steal the
  // user's map pan/zoom.

  useEffect(() => {
    // Track the user's live position (not just a one-shot fix) — the
    // split-view trigger needs to know when they're actually approaching a
    // turn, which requires continuous updates as they drive. Mount-only:
    // unlike the map renderer setup above, this doesn't need to restart on
    // theme changes.
    if (navigator.geolocation) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const rawLoc: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          const now = Number.isFinite(position.timestamp) && position.timestamp > 0 ? position.timestamp : Date.now();
          const accuracy = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
          gpsAccuracyRef.current = accuracy;

          const reportedSpeed = Number.isFinite(position.coords.speed) && position.coords.speed != null && position.coords.speed >= 0
            ? position.coords.speed
            : null;

          const loc = smoothLocation(smoothedLocationRef.current, rawLoc);
          smoothedLocationRef.current = loc;
          setGpsStatus(accuracy != null && accuracy <= 25 ? 'good' : 'weak');

          // Prefer the browser's own speed reading; fall back to computing
          // it from consecutive fixes (position.coords.speed is frequently
          // null on desktop browsers and some devices).
          let speed = position.coords.speed;
          const last = lastFixRef.current;
          if (speed == null || !isFinite(speed) || speed < 0) {
            if (last) {
              const dtSeconds = (now - last.t) / 1000;
              if (dtSeconds > 0.2) {
                speed = haversineDistanceMeters(last.loc, loc) / dtSeconds;
              }
            }
          }

          // Same dual-source pattern for heading: position.coords.heading
          // when the browser provides it (more reliable, especially at low
          // speed), falling back to the bearing between consecutive fixes.
          // Skip the fallback entirely below walking pace — bearing
          // between two nearly-identical points is dominated by GPS noise,
          // not actual direction of travel, and would make the vehicle
          // icon jitter erratically while stopped.
          let heading = position.coords.heading;
          if (heading == null || !isFinite(heading) || heading < 0) {
            if (last && speed != null && speed > 0.5) {
              heading = bearingDegrees(last.loc, loc);
            }
          }
          if (heading != null && isFinite(heading) && heading >= 0) {
            setHeadingDeg(heading);
            headingDegRef.current = heading;
          }

          const engineFix = navigationEngineRef.current!.acceptGpsFix({
            location: rawLoc,
            timestampMs: now,
            accuracyMeters: accuracy,
            speedMps: speed != null && isFinite(speed) && speed >= 0 ? speed : reportedSpeed,
            headingDegrees: heading != null && isFinite(heading) && heading >= 0 ? heading : null,
          });
          if (!engineFix.accepted) {
            setGpsStatus('weak');
            return;
          }

          lastFixRef.current = { loc, t: now };
          setGpsLastUpdateMs(now);
          if (speed != null && isFinite(speed) && speed >= 0) {
            setSpeedMps(speed);
            speedMpsRef.current = speed;
          }

          const engineSnapshot = navigationEngineRef.current!.snapshot();
          setNavigationEngineSnapshot(engineSnapshot);
          matchedProgressRef.current = engineSnapshot.matched?.progressMeters ?? null;
          matchedSegmentIndexRef.current = engineSnapshot.matched?.segmentIndex ?? null;
          setNavigationConfidence(engineSnapshot.matched?.confidence ?? 1);
          setCurrentLaneEstimate(engineSnapshot.currentLane ? { laneIndex: engineSnapshot.currentLane.laneIndex, confidence: engineSnapshot.currentLane.confidence } : null);
          setUserLocation(engineFix.location ?? loc);
        },
        (error) => {
          console.error('Error getting location:', error);
          // Preserve the last trustworthy fix during transient GPS failures.
          // Dropping the marker to null makes a navigation UI jump, which is
          // worse than briefly showing a stale-but-known position.
          setGpsStatus('lost');
          if (!lastFixRef.current) {
            setUserLocation(null);
            smoothedLocationRef.current = null;
            matchedProgressRef.current = null;
          }
        },
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // react-leaflet v4 forwards the MapContainer ref to Leaflet. We use
    // native map interaction events to implement navigation-app-style
    // follow mode: the map tracks the driver while navigating, but a manual
    // pan/zoom hands control back to the user until Locate is pressed.
    const map = mapRef.current;
    if (!map) return;
    const pauseFollow = () => { followMapRef.current = false; };
    map.on('click', handleMapClick);
    map.on('dragstart', pauseFollow);
    map.on('zoomstart', pauseFollow);
    return () => {
      map.off('click', handleMapClick);
      map.off('dragstart', pauseFollow);
      map.off('zoomstart', pauseFollow);
    };
  }, []);

  useEffect(() => {
    if (!navigationStarted || !userLocation || !followMapRef.current || !mapRef.current) return;
    const now = Date.now();
    if (now - lastMapFollowAtRef.current < 1200) return;
    lastMapFollowAtRef.current = now;
    const map = mapRef.current;
    const center = map.getCenter();
    const drift = haversineDistanceMeters(
      { lat: center.lat, lng: center.lng },
      userLocation,
    );
    if (drift > 45) {
      map.panTo([userLocation.lat, userLocation.lng], { animate: true, duration: 0.45 });
    }
  }, [navigationStarted, userLocation]);

  useEffect(() => {
    if (!navigationStarted || !userLocation) return;
    const id = window.setInterval(() => setHazardRefreshAt(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [navigationStarted, userLocation]);

  useEffect(() => {
    if (userLocation && isOnline) {
      loadNearbyData(userLocation);
    }
  }, [userLocation?.lat, userLocation?.lng, isOnline]);

  useEffect(() => {
    if (!navigationStarted) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const last = lastFixRef.current;
      if (!last || !isGpsContinuityGap(last.t, now, 3000)) return;

      const estimate = estimateDeadReckonedLocation({
        lastLocation: last.loc,
        lastFixTimestampMs: last.t,
        speedMps: speedMpsRef.current,
        headingDegrees: headingDegRef.current,
        nowMs: now,
        maxDurationMs: 15000,
      });
      if (!estimate) {
        if (now - last.t > 9000) setGpsStatus('lost');
        return;
      }

      gpsAccuracyRef.current = continuityAccuracyMeters(estimate.elapsedMs);
      setGpsStatus(estimate.elapsedMs > 9000 ? 'lost' : 'weak');
      const continuity = navigationEngineRef.current!.tickContinuity(now);
      matchedProgressRef.current = continuity.matched?.progressMeters ?? null;
      matchedSegmentIndexRef.current = continuity.matched?.segmentIndex ?? null;
      setNavigationConfidence(continuity.matched?.confidence ?? estimate.confidence);
      setUserLocation(continuity.location ?? estimate.location);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [navigationStarted]);

  useEffect(() => {
    if (!navigationStarted) return;
    const timer = window.setInterval(() => {
      const last = gpsLastUpdateMs;
      if (last == null) return;
      if (Date.now() - last > 9000) setGpsStatus('lost');
    }, 2000);
    return () => window.clearInterval(timer);
  }, [navigationStarted, gpsLastUpdateMs]);

  // The route's actual origin: an explicit planning start if one is set,
  // otherwise live GPS. Before the user presses Start navigation this is a
  // route preview; after they press Start, live GPS takes over the turn-by-turn
  // tracking even when a custom starting point was entered.
  const routeOrigin = customStart ?? userLocation;
  const lastPreviewRouteRef = useRef<{ origin: Location; destination: Location; customStart: boolean } | null>(null);

  useEffect(() => {
    // Preview routing is deliberately destination-driven. Once a preview route
    // has been requested/committed, ordinary GPS movement must not start a
    // second preview request: that race can leave an otherwise valid preview
    // disabled when a later request fails or resolves out of order. Live GPS
    // rerouting belongs to the active navigation session below.
    if (navigationStarted || !routeOrigin || !destination) return;
    if (routeOptions.length > 0) return;

    const previous = lastPreviewRouteRef.current;
    const destinationChanged = !previous
      || previous.destination.lat !== destination.lat
      || previous.destination.lng !== destination.lng;
    const customStartChanged = !previous
      || previous.customStart !== Boolean(customStart);

    // If the route failed while the origin was temporarily unavailable, allow
    // the first real origin to trigger a request. After that, do not use GPS
    // jitter as a route-preview trigger.
    if (!destinationChanged && !customStartChanged && previous) return;

    lastPreviewRouteRef.current = {
      origin: routeOrigin,
      destination,
      customStart: Boolean(customStart),
    };
    void loadRoute(routeOrigin, destination, false);
  }, [
    customStart?.lat,
    customStart?.lng,
    userLocation?.lat,
    userLocation?.lng,
    destination?.lat,
    destination?.lng,
    navigationStarted,
    routeOptions.length,
  ]);

  useEffect(() => {
    const session = readNavigationSession();
    if (!session || !session.destination || session.routeOptions.length === 0) return;
    navigationSessionRef.current = session.navigationPhase === 'navigating' || session.navigationPhase === 'rerouting';
  }, []);

  // Flatten the route's segments into a single ordered polyline, and
  // precompute each maneuver's distance-along-that-polyline once per route
  // (rather than every GPS tick). This is what lets the trigger logic use
  // "distance remaining along the road" instead of misleading straight-line
  // distance (which breaks down near hairpins or parallel roads).
  const routePolyline = useMemo<Location[]>(
    () => (route ? route.segments.flatMap((s) => s.coords.map((c) => ({ lat: c.lat, lng: c.lng }))) : []),
    [route]
  );

  useEffect(() => {
    routePolylineRef.current = routePolyline;
    routeIndexRef.current = routePolyline.length >= 2 ? buildNavigationRouteIndex(routePolyline) : null;
    navigationEngineRef.current!.setRoute(route);
    setNavigationEngineSnapshot(navigationEngineRef.current!.snapshot());
    if (!route) { matchedProgressRef.current = null; matchedSegmentIndexRef.current = null; routeIndexRef.current = null; }
  }, [routePolyline, route]);

  const maneuverDistances = useMemo(() => {
    if (!route) return [];
    return route.maneuvers.map((m) => ({
      maneuver: m,
      distanceAlong: projectOntoPolyline(m.location, routePolyline)?.distanceAlongMeters ?? null,
    }));
  }, [route, routePolyline]);

  const navigationHealth = useMemo(() => deriveNavigationHealth(
    navigationConfidence > 0 ? { confidence: navigationConfidence, onRoute: navigationConfidence >= 0.3 } as any : null,
    gpsLastUpdateMs,
  ), [navigationConfidence, gpsLastUpdateMs]);

  // The actual split-view feature: watch how far along the route the
  // driver is from the next upcoming complex maneuver, with a
  // speed-adaptive trigger distance, and flip into 3D once they're close.
  //
  // Using distance-*along the route* (rather than straight-line distance to
  // the maneuver's coordinates) means a GPS tick that jumps past a turn at
  // speed just shows up as "remaining distance went to zero" — no special
  // missed-turn heuristic needed. Genuinely leaving the route (a real missed
  // turn, wrong exit, detour) shows up as a large lateral offset from the
  // route line instead, which triggers a reroute below.
  //
  // A route is only a preview until the user explicitly presses Start
  // navigation. Once started, live GPS drives the maneuver tracking even if
  // the route was originally planned from a custom starting point.
  useEffect(() => {
    if (!route || !userLocation || routePolyline.length < 2 || !navigationStarted) {
      return;
    }

    const userProjection = projectOntoPolyline(userLocation, routePolyline);
    if (!userProjection) {
      return;
    }

    // Off-route: the driver's position no longer lies near the planned
    // route at all. Request a fresh route from here rather than continuing
    // to track maneuvers on a road they're no longer on. Skipped while
    // offline — the request would just fail, repeatedly, every tick.
    const accuracy = gpsAccuracyRef.current ?? 0;
    const effectiveOffRouteDistance = Math.max(OFF_ROUTE_DISTANCE_M, Math.min(110, accuracy * 0.9));
    if (userProjection.distanceFromLineMeters > effectiveOffRouteDistance) {
      offRouteSamplesRef.current += 1;
    } else {
      offRouteSamplesRef.current = 0;
    }

    // A single noisy fix should never cause a route reset. Require sustained
    // evidence unless the vehicle is clearly far from the route.
    const clearlyOffRoute = userProjection.distanceFromLineMeters > 110;
    if (offRouteSamplesRef.current >= 3 || clearlyOffRoute) {
      // Never spend a reroute on a stale/weak GPS signal. Wait for another
      // trustworthy fix so a tunnel or urban-canyon dropout does not create
      // a fake detour and replace the driver's valid route.
      const gpsFreshEnough = navigationHealth.gps !== 'lost' && navigationConfidence >= 0.28;
      if (destination && isOnline && gpsFreshEnough) {
        const now = Date.now();
        if (now - lastRerouteAtRef.current > REROUTE_COOLDOWN_MS) {
          lastRerouteAtRef.current = now;
          offRouteSamplesRef.current = 0;
          dispatchNavigation({ type: 'REROUTE' });
          loadRoute(userLocation, destination, true);
        }
      }
      return;
    }

    const spatialPlan = buildSpatialNavigationPlan({
      route,
      userLocation,
      speedMps,
      scene: sceneContext,
      snapshot: navigationEngineSnapshot,
    });
    const target = spatialPlan.maneuver
      ? maneuverDistances.find((item) => item.maneuver === spatialPlan.maneuver) ?? null
      : null;
    const remainingDistance = spatialPlan.distanceToManeuverMeters !== null
      ? spatialPlan.distanceToManeuverMeters
      : target?.distanceAlong == null
        ? null
        : Math.max(0, target.distanceAlong - userProjection.distanceAlongMeters);

    if (!target || remainingDistance === null) {
      setSplitView(false);
      setActiveManeuver(null);
      setLaneExecution(null);
      return;
    }

    const triggerDistance = Math.min(
      MAX_TRIGGER_DISTANCE_M,
      Math.max(MIN_TRIGGER_DISTANCE_M, Math.max(speedMps * LOOKAHEAD_SECONDS, spatialPlan.experience?.triggerDistanceMeters ?? MIN_TRIGGER_DISTANCE_M))
    );

    if (remainingDistance <= MANEUVER_PASS_DISTANCE_M) {
      setManeuverIndex((i) => i + 1);
      setSplitView(false);
      setActiveManeuver(null);
    } else if (remainingDistance <= triggerDistance && spatialPlan.presentation !== 'map') {
      setSplitView(spatialPlan.presentation === 'immersive');
      setActiveManeuver(target.maneuver);
    } else {
      setSplitView(false);
      setActiveManeuver(null);
    }
  }, [userLocation, route, routePolyline, maneuverDistances, maneuverIndex, speedMps, destination, isOnline, navigationStarted, navigationHealth.gps, navigationConfidence]);

  useEffect(() => {
    if (!navigationStarted || maneuverDistances.length === 0) return;
    const upcoming = maneuverDistances
      .slice(Math.max(0, maneuverIndex), Math.min(maneuverDistances.length, maneuverIndex + 3))
      .map((item) => item.maneuver.location);
    if (upcoming.length) prefetchSceneContext(upcoming, 320);
  }, [navigationStarted, maneuverIndex, maneuverDistances]);

  useEffect(() => {
    if (!navigationStarted || !userLocation || !destination || routePolyline.length < 2) return;
    const progress = getNavigationProgress(
      userLocation,
      routePolyline,
      destination,
      route?.distance_meters ?? null,
    );
    if (progress.arrived) {
      navigationSessionRef.current = false;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance('You have arrived at your destination.');
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
      }
      spokenGuidanceRef.current.clear();
    recordNavigationMetric('navigation_arrived');
      dispatchNavigation({ type: 'ARRIVE' });
      setSplitView(false);
      setActiveManeuver(null);
    }
  }, [navigationStarted, userLocation, destination, routePolyline, route]);

  const activeManeuverRemainingM = useMemo(() => {
    if (!activeManeuver || !userLocation || routePolyline.length < 2) return null;
    const userProj = projectOntoPolyline(userLocation, routePolyline);
    const targetEntry = maneuverDistances.find((md) => md.maneuver === activeManeuver);
    if (!userProj || !targetEntry || targetEntry.distanceAlong === null) return null;
    return Math.max(0, Math.round(targetEntry.distanceAlong - userProj.distanceAlongMeters));
  }, [activeManeuver, userLocation, routePolyline, maneuverDistances]);

  useEffect(() => {
    const engine = navigationEngineRef.current;
    if (!engine || !activeManeuver || activeManeuverRemainingM === null) {
      setLaneExecution(null);
      return;
    }
    const currentLane = currentLaneEstimate?.laneIndex ?? null;
    const activeManeuverIndex = maneuverDistances.findIndex((item) => item.maneuver === activeManeuver);
    const liveStrategyStep = activeManeuverIndex >= 0
      ? navigationEngineRef.current?.snapshot().routeLaneStrategy.steps.find((step) => step.maneuverIndex === activeManeuverIndex)
      : null;
    const targetLane = liveStrategyStep?.plannedLaneIndex ?? activeManeuver.lanes?.findIndex((lane) => lane.recommended) ?? null;
    // Execute multi-lane destination requests one adjacent lane at a time.
    // This keeps the physical trajectory believable while retaining the final
    // destination lane as the maneuver's intent.
    const stagedLane = stageLaneChange(currentLane, targetLane);
    const immediateTargetLane = stagedLane.immediateTargetLaneIndex;
    const timing = buildDestinationLaneTiming(currentLane, immediateTargetLane, activeManeuverRemainingM);
    const scenePlan = route && sceneContext
      ? buildSceneGuidancePlan(route, activeManeuver, currentLane, currentLaneEstimate?.confidence ?? 0, sceneContext, immediateTargetLane)
      : null;
    const trajectory = scenePlan?.laneChangeTrajectory ?? null;
    const reachability = currentLane != null && targetLane != null && currentLane !== targetLane
      ? assessLaneChangeReachability({
          trajectory,
          distanceToManeuverMeters: activeManeuverRemainingM,
          speedMps,
          currentLaneIndex: currentLane,
          currentLaneConfidence: currentLaneEstimate?.confidence ?? 0,
          reports: [...reports, ...liveTraffic],
          occupants: toLaneOccupantObservations(liveTrafficVehicles),
          egoSpeedMps: speedMps,
          egoHeadingDegrees: headingDeg,
        })
      : { reachable: true, confidence: 1, requiredRunwayMeters: 0, remainingMeters: activeManeuverRemainingM, reason: 'same-lane' as const, dynamics: null, trafficSafe: true, trafficConfidence: 1, trafficReason: 'same-lane' };
    const predictivePlan = planPredictiveLaneChange({
      currentLaneIndex: currentLane,
      finalTargetLaneIndex: targetLane,
      distanceToManeuverMeters: activeManeuverRemainingM,
      reachability,
      latestChangeMeters: timing?.latestChangeMeters ?? activeManeuverRemainingM,
    });
    const decision = decideUnifiedManeuver({
      timing,
      reachability,
      currentLaneConfidence: currentLaneEstimate?.confidence ?? 0,
      distanceToManeuverMeters: activeManeuverRemainingM,
    });
    const execution = engine.updateLaneChangeExecution({
      currentLaneIndex: currentLane,
      currentLaneConfidence: currentLaneEstimate?.confidence ?? 0,
      timing,
      reachable: predictivePlan.safeToExecuteNow && decision.action !== 'reroute' && decision.action !== 'uncertain' && decision.safe,
      reachabilityConfidence: Math.min(decision.confidence, predictivePlan.confidence),
      dynamicsConfidence: reachability.dynamics?.confidence ?? decision.confidence,
      recommendedSpeedMps: decision.recommendedSpeedMps ?? speedMps,
      safetyReason: predictivePlan.action === 'wait-for-gap' ? 'waiting-for-gap' : decision.reason,
      distanceToManeuverMeters: activeManeuverRemainingM,
      nowMs: Date.now(),
    });
    setLaneExecution(execution);
  }, [activeManeuver, activeManeuverRemainingM, currentLaneEstimate, maneuverDistances, route, sceneContext, reports, liveTraffic, liveTrafficVehicles]);

  useEffect(() => {
    if (!navigationStarted || !laneExecution || laneExecution.phase !== 'missed' || !destination || !userLocation || !isOnline) return;
    const now = Date.now();
    if (now - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;
    lastRerouteAtRef.current = now;
    dispatchNavigation({ type: 'REROUTE' });
    loadRoute(userLocation, destination, true);
  }, [navigationStarted, laneExecution, destination, userLocation, isOnline]);

  // Native browser speech gives the web prototype real turn-by-turn audio without
  // requiring a paid voice provider. Announcements are thresholded per maneuver
  // so GPS jitter cannot repeat the same instruction every render.
  useEffect(() => {
    if (!navigationStarted || !activeManeuver || activeManeuverRemainingM === null) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    if (!voiceEnabled) return;
    const thresholds = speedMps > 18 ? [800, 300, 100] : [400, 150, 50];
    const threshold = thresholds.find((value) => activeManeuverRemainingM <= value && !spokenGuidanceRef.current.has(`${maneuverIndex}:${value}`));
    if (threshold === undefined) return;

    const key = `${maneuverIndex}:${threshold}`;
    spokenGuidanceRef.current.add(key);
    if (threshold <= 150 && laneExecution) {
      const prompt = laneChangeExecutionPrompt(laneExecution);
      if (prompt && laneExecution.phase !== 'prepare') {
        speakNavigationPrompt(prompt, `${maneuverIndex}:lane:${laneExecution.phase}:${laneExecution.targetLane}`, {
          rate: 1.02, volume: 0.95, priority: true,
        });
      }
    }
    const distanceText = threshold >= 100 ? `${threshold} meters` : `${threshold} meters`;
    speakNavigationPrompt(`In ${distanceText}, ${activeManeuver.instruction}`, `${maneuverIndex}:${threshold}`, {
      rate: speedMps > 18 ? 1.06 : 1.02,
      volume: 0.92,
      priority: threshold <= 100,
    });
  }, [navigationStarted, activeManeuver, activeManeuverRemainingM, maneuverIndex, voiceEnabled, speedMps, currentLaneEstimate, laneExecution]);

  const handleCreateReport = async (type: string) => {
    if (!userLocation) return;
    setReportSubmitting(true);
    setReportError(null);
    try {
      const newReport = await createReport(type, userLocation);
      setReports((prev) => [newReport, ...prev]);
      setShowReportMenu(false);
      showInteractionToast(`${REPORT_TYPE_META[type]?.label ?? 'Report'} added to the live map`);
    } catch (error) {
      console.error('Error creating report:', error);
      setReportError('Could not submit report — please try again.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleConfirmReport = async (report: Report) => {
    try {
      const updated = await confirmReport(report.id);
      setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (error) {
      console.error('Error confirming report:', error);
    }
  };

  const handleDismissReport = async (report: Report) => {
    try {
      const updated = await dismissReport(report.id);
      // If enough dismissals pushed it past the threshold, the backend
      // expires it immediately — drop it from this client's view right
      // away rather than waiting for the next poll.
      const stillActive = new Date(updated.expires_at).getTime() > Date.now();
      setReports((prev) =>
        stillActive
          ? prev.map((r) => (r.id === updated.id ? updated : r))
          : prev.filter((r) => r.id !== updated.id)
      );
    } catch (error) {
      console.error('Error dismissing report:', error);
    }
  };

  const openBillboardForm = (billboard: Billboard) => {
    setBillboardFormId(billboard.id);
    setBillboardFormAdImage('');
    setBillboardFormAdTarget('');
    setBillboardFormDurationHours(24);
    setBillboardError(null);
  };

  const handlePurchaseBillboard = async () => {
    if (!billboardFormId) return;
    if (!billboardFormAdImage.trim() || !billboardFormAdTarget.trim()) {
      setBillboardError('Ad image URL and target URL are both required.');
      return;
    }
    setBillboardSubmitting(true);
    setBillboardError(null);
    try {
      const displayStart = new Date();
      const displayEnd = new Date(displayStart.getTime() + billboardFormDurationHours * 60 * 60 * 1000);
      const result = await purchaseBillboard(
        billboardFormId,
        billboardFormAdImage.trim(),
        billboardFormAdTarget.trim(),
        displayStart.toISOString(),
        displayEnd.toISOString()
      );
      if (!result.success || !result.data) {
        setBillboardError(result.error?.message ?? 'Could not publish this ad.');
        return;
      }
      setBillboards((prev) => prev.map((b) => (b.id === result.data!.id ? result.data! : b)));
      setBillboardFormId(null);
    } catch (error) {
      console.error('Error purchasing billboard:', error);
      setBillboardError('Could not publish this ad — please try again.');
    } finally {
      setBillboardSubmitting(false);
    }
  };

  const handleBillboardAdClick = async (billboard: Billboard) => {
    const updatedCount = await clickBillboard(billboard.id);
    if (updatedCount !== null) {
      setBillboards((prev) =>
        prev.map((b) => (b.id === billboard.id ? { ...b, click_count: updatedCount } : b))
      );
    }
    if (billboard.ad_target_url) {
      window.open(billboard.ad_target_url, '_blank', 'noopener,noreferrer');
    }
  };

  // --- Automatic parking detection ---
  // No manual "reserve a spot" button — instead, this watches the driver's
  // real GPS speed and proximity to mapped lots and infers when they've
  // actually parked, the way a person driving would experience it: you
  // slow down, stop, you're near a lot, and after a bit it's clear you've
  // parked there (not just stopped at a light). This is inherently a
  // heuristic — there's no ground-truth signal (no car-Bluetooth-disconnect
  // event, no engine-off signal) that they're actually in a spot versus
  // just stopped for a while nearby. False positives/negatives are
  // possible; the thresholds below are a reasonable first pass, not
  // something empirically tuned against real driving data.
  const PARK_RADIUS_M = 60; // how close to a lot counts as "at" it
  const PARK_SPEED_THRESHOLD_MPS = 1; // ~2mph — walking-slow or stopped
  const PARK_CONFIRM_MS = 45_000; // must be stationary this long near a lot before we call it "parked"
  const LEAVE_SPEED_THRESHOLD_MPS = 3; // ~7mph — clearly driving again
  const LEAVE_CONFIRM_MS = 8_000; // must sustain that speed this long before we call it "left"

  const stationaryNearLotSinceRef = useRef<{ lotId: string; since: number } | null>(null);
  const movingSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userLocation) return;

    if (parkedLotId) {
      // Currently parked — watch for sustained movement to detect leaving.
      if (speedMps >= LEAVE_SPEED_THRESHOLD_MPS) {
        if (movingSinceRef.current === null) {
          movingSinceRef.current = Date.now();
        } else if (Date.now() - movingSinceRef.current >= LEAVE_CONFIRM_MS) {
          movingSinceRef.current = null;
          checkoutParking()
            .then(() => setParkedLotId(null))
            .catch((error) => { console.error('Error checking out of parking:', error); setInteractionToast('Could not update parking status. Try again.'); });
        }
      } else {
        movingSinceRef.current = null;
      }
      return;
    }

    // Not currently parked — watch for sustained low speed near a lot.
    if (speedMps > PARK_SPEED_THRESHOLD_MPS) {
      stationaryNearLotSinceRef.current = null;
      return;
    }

    const nearestLot = parkingLots
      .map((lot) => ({ lot, distance: haversineDistanceMeters(userLocation, lot.location) }))
      .filter((entry) => entry.distance <= PARK_RADIUS_M)
      .sort((a, b) => a.distance - b.distance)[0]?.lot;

    if (!nearestLot) {
      stationaryNearLotSinceRef.current = null;
      return;
    }

    const tracker = stationaryNearLotSinceRef.current;
    if (!tracker || tracker.lotId !== nearestLot.id) {
      stationaryNearLotSinceRef.current = { lotId: nearestLot.id, since: Date.now() };
      return;
    }

    if (Date.now() - tracker.since >= PARK_CONFIRM_MS) {
      stationaryNearLotSinceRef.current = null;
      checkinParking(nearestLot.id, userLocation)
        .then((result) => {
          if (result.success) {
            setParkedLotId(nearestLot.id);
            if (userLocation) loadNearbyData(userLocation);
          }
        })
        .catch((error) => console.error('Error checking in to parking:', error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation, speedMps, parkedLotId, parkingLots]);

  useEffect(() => {
    // Keep the check-in alive with periodic heartbeats while parked —
    // much less frequent than the old reservation heartbeat, since being
    // stationary for a long time is the expected normal state here.
    if (!parkedLotId) return;
    const interval = window.setInterval(() => {
      parkingHeartbeat(userLocationRef.current ?? undefined).catch((error) => console.error('Error sending parking heartbeat:', error));
    }, PARKING_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [parkedLotId]);

  useEffect(() => {
    // Real-time updates: reports and parking-spot state pushed live from
    // other nearby users, instead of waiting for this client's next poll.
    // Reconnects automatically on drop; the existing poll-on-location-change
    // (loadNearbyData) stays in place as a fallback/resync baseline
    // regardless of whether the socket is currently connected.
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        // A successful connection closes the previous failure streak so a
        // later network blip starts with a short retry again.
        wsReconnectAttemptRef.current = 0;
        // Covers both "location was already known before this connection
        // finished opening" and "this is a reconnect after a drop" — in
        // both cases the server has no location filter for this (new)
        // socket until we (re-)send it.
        if (userLocationRef.current) {
          ws.send(
            JSON.stringify({ type: 'subscribe', lat: userLocationRef.current.lat, lng: userLocationRef.current.lng })
          );
        }
      };

      ws.onmessage = (event) => {
        let parsed: WsEvent;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return; // e.g. the plain "Connected" text sent on open — ignore
        }

        switch (parsed.type) {
          case 'report_created': {
            const report = parsed.report;
            const snapshot = liveTrafficStreamRef.current!.ingest(parsed);
            setLiveTraffic(snapshot.reports);
            setReports((prev) => prev.some((r) => r.id === report.id) ? prev : [report, ...prev]);
            break;
          }
          case 'report_updated': {
            const report = parsed.report;
            const snapshot = liveTrafficStreamRef.current!.ingest(parsed);
            setLiveTraffic(snapshot.reports);
            setReports((prev) => prev.map((r) => r.id === report.id ? report : r));
            break;
          }
          case 'report_removed': {
            const id = parsed.id;
            const snapshot = liveTrafficStreamRef.current!.ingest(parsed);
            setLiveTraffic(snapshot.reports);
            setReports((prev) => prev.filter((r) => r.id !== id));
            break;
          }
          case 'parking_updated': {
            const parking = parsed.parking;
            setParkingLots((prev) => {
              const exists = prev.some((p) => p.id === parking.id);
              return exists
                ? prev.map((p) => (p.id === parking.id ? parking : p))
                : [...prev, parking];
            });
            break;
          }
          case 'parking_car_updated': {
            const car = parsed.car;
            setParkedCars((prev) => prev.some((c) => c.id === car.id)
              ? prev.map((c) => c.id === car.id ? car : c)
              : [...prev, car]);
            break;
          }
          case 'parking_car_removed': {
            const id = parsed.id;
            setParkedCars((prev) => prev.filter((c) => c.id !== id));
            break;
          }
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // While offline, retrying every 3s would just spam failed
        // connection attempts until connectivity actually returns — wait
        // for the browser's 'online' event instead (handled by the
        // isOnline effect below) rather than polling blindly.
        if (!navigator.onLine) return;
        // Exponential backoff with jitter prevents a fleet of clients from
        // reconnecting in lockstep after an outage. Cap the delay so recovery
        // remains responsive once the server is healthy again.
        const attempt = Math.min(6, wsReconnectAttemptRef.current++);
        const baseDelay = Math.min(30000, 1000 * 2 ** attempt);
        const jitter = Math.floor(Math.random() * Math.min(1000, baseDelay * 0.25));
        const delay = Math.min(30000, baseDelay + jitter);
        wsReconnectTimeoutRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    // If we went offline while a reconnect was already scheduled, drop it
    // (see onclose above) — and reconnect immediately once we're back,
    // rather than waiting out whatever delay happened to be queued.
    const handleOnline = () => {
      if (wsRef.current === null || wsRef.current.readyState === WebSocket.CLOSED) {
        connect();
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      if (wsReconnectTimeoutRef.current !== null) {
        window.clearTimeout(wsReconnectTimeoutRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Tell the server what "nearby" means for this connection whenever the
    // driver's position changes meaningfully — the backend geo-filters
    // broadcast events against this so clients only get pushed updates
    // relevant to where they actually are.
    userLocationRef.current = userLocation;
    if (!userLocation || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'subscribe', lat: userLocation.lat, lng: userLocation.lng }));
  }, [userLocation]);

  // Debounced destination search. A ref-based request counter guards
  // against stale responses landing out of order (e.g. a fast first
  // keystroke's request resolving after a later one) — only the response
  // matching the most recently fired request gets applied.
  const searchRequestIdRef = useRef(0);
  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(false);
    const requestId = ++searchRequestIdRef.current;
    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await smartSearch(query, {
          userLocation: userLocationRef.current,
          route,
          destination,
          maxResults: 8,
        });
        if (requestId === searchRequestIdRef.current) {
          setSearchResults(results);
          setSearchError(false);
        }
      } catch (error) {
        console.error('Error searching for places:', error);
        if (requestId === searchRequestIdRef.current) {
          setSearchResults([]);
          setSearchError(true);
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setSearchLoading(false);
        }
      }
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, route, destination]);

  const showInteractionToast = (message: string) => {
    setInteractionToast(message);
    if (interactionToastTimerRef.current !== null) window.clearTimeout(interactionToastTimerRef.current);
    interactionToastTimerRef.current = window.setTimeout(() => setInteractionToast(null), 2200);
  };

  useEffect(() => () => {
    if (interactionToastTimerRef.current !== null) window.clearTimeout(interactionToastTimerRef.current);
  }, []);

  const handleSelectSearchResult = (result: GeocodeResult) => {
    // Selecting a new destination always returns the app to planning mode.
    // This prevents an old navigation session from silently following a new
    // destination while the user is still editing the trip.
    navigationSessionRef.current = false;
    clearNavigationSession();
    routeRequestIdRef.current += 1;
    lastPreviewRouteRef.current = null;
    setRouteOptions([]);
    setRouteDecisionProfiles([]);
    setRouteCommunityIntelligence(new Map());
    setRouteError(null);
    setRouteLoading(false);
    dispatchNavigation({ type: 'PLAN' });
    setSplitView(false);
    setActiveManeuver(null);
    setManeuverIndex(0);
    setDestination(result.location);
    setSearchQuery(result.display_name);
    setShowSearchResults(false);
    showInteractionToast(`Route ready for ${result.display_name.split(',')[0]}`);
    addRecentDestination(result);
    setRecentDestinations(getRecentDestinations());
  };

  // Same debounce/staleness-guard pattern as the destination search above,
  // for the "start" field. Duplicated rather than factored into a shared
  // hook for now — a reasonable follow-up cleanup, not done here given
  // everything else in this pass.
  const startRequestIdRef = useRef(0);
  useEffect(() => {
    const query = startQuery.trim();
    if (query.length < 3) {
      setStartResults([]);
      setStartLoading(false);
      return;
    }

    setStartLoading(true);
    setStartSearchError(false);
    const requestId = ++startRequestIdRef.current;
    const timeoutId = window.setTimeout(async () => {
      try {
        const results = await searchPlaces(query, userLocationRef.current || undefined);
        if (requestId === startRequestIdRef.current) {
          setStartResults(results);
          setStartSearchError(false);
        }
      } catch (error) {
        console.error('Error searching for places:', error);
        if (requestId === startRequestIdRef.current) {
          setStartResults([]);
          setStartSearchError(true);
        }
      } finally {
        if (requestId === startRequestIdRef.current) {
          setStartLoading(false);
        }
      }
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [startQuery]);

  const handleSelectStartResult = (result: GeocodeResult) => {
    navigationSessionRef.current = false;
    clearNavigationSession();
    dispatchNavigation({ type: 'PLAN' });
    setSplitView(false);
    setActiveManeuver(null);
    setCustomStart(result.location);
    setStartQuery(result.display_name);
    setShowStartResults(false);
    addRecentDestination(result);
    setRecentDestinations(getRecentDestinations());
  };

  const handleUseCurrentLocationAsStart = () => {
    navigationSessionRef.current = false;
    clearNavigationSession();
    dispatchNavigation({ type: 'PLAN' });
    setSplitView(false);
    setActiveManeuver(null);
    setCustomStart(null);
    setStartQuery('');
    setShowStartResults(false);
  };

  // Destination intelligence is deliberately loaded against the destination, not
  // the driver's current position. That makes parking part of trip planning
  // instead of an afterthought once the driver arrives.
  useEffect(() => {
    if (!destination || !isOnline) {
      setDestinationParkingLots([]);
      setDestinationParkingLoading(false);
      return;
    }
    let cancelled = false;
    setDestinationParkingLoading(true);
    getParking(destination)
      .then((lots) => {
        if (!cancelled) setDestinationParkingLots(rankParkingLots(lots, destination, 5));
      })
      .catch(() => {
        if (!cancelled) setDestinationParkingLots([]);
      })
      .finally(() => {
        if (!cancelled) setDestinationParkingLoading(false);
      });
    return () => { cancelled = true; };
  }, [destination?.lat, destination?.lng, isOnline]);

  const handleNavigateToParking = (lot: ParkingLot) => {
    navigationSessionRef.current = false;
    clearNavigationSession();
    dispatchNavigation({ type: 'PLAN' });
    setSplitView(false);
    setActiveManeuver(null);
    setManeuverIndex(0);
    setSelectedParkingLotId(lot.id);
    setDestination(lot.location);
    setSearchQuery(lot.name ? `Parking · ${lot.name}` : 'Parking near destination');
    setShowSearchResults(false);
  };

  const handleStartNavigation = () => {
    offRouteSamplesRef.current = 0;
    spokenGuidanceRef.current.clear();
    lastRerouteAtRef.current = 0;
    if (!route || !destination) return;

    navigationSessionRef.current = true;
    recordNavigationMetric('navigation_started');
    dispatchNavigation({ type: 'START', hasRoute: true });
    setShowSearchResults(false);
    setShowStartResults(false);
    setSplitView(false);
    setActiveManeuver(null);
    setManeuverIndex(0);

    // A manually entered start is for planning. Once Start is pressed, a
    // navigation app should use the driver's actual live position when it is
    // materially different. Do this in one request, not via the preview
    // effect, so the session never flashes back to the Enter button.
    if (userLocation && customStart) {
      const distanceFromPlannedStart = haversineDistanceMeters(userLocation, customStart);
      if (distanceFromPlannedStart > 150) {
        setCustomStart(null);
        setStartQuery('');
        loadRoute(userLocation, destination, true);
      }
    }
  };

  useEffect(() => {
    if (!navigationStarted || !destination || routeOptions.length === 0) return;
    saveNavigationSession({
      destination,
      destinationLabel: searchQuery || 'Destination',
      customStart,
      startLabel: startQuery,
      routeOptions,
      selectedRouteIndex,
      maneuverIndex,
      navigationPhase,
      navigationStartedAt: Date.now(),
      savedAt: Date.now(),
    });
  }, [navigationStarted, navigationPhase, destination, searchQuery, customStart, startQuery, routeOptions, selectedRouteIndex, maneuverIndex]);

  useEffect(() => {
    if (!navigationStarted) return;
    const timer = window.setInterval(() => touchNavigationSession(), 60_000);
    return () => window.clearInterval(timer);
  }, [navigationStarted]);

  const handleStopNavigation = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    spokenGuidanceRef.current.clear();
    offRouteSamplesRef.current = 0;
    navigationSessionRef.current = false;
    clearNavigationSession();
    dispatchNavigation({ type: 'PLAN' });
    setSplitView(false);
    setActiveManeuver(null);
    setManeuverIndex(0);
  };

  const handleSwapStartAndDestination = () => {
    // Only meaningful when both sides are fixed points — swapping "your
    // live location" into a destination is a degenerate case (a
    // destination should be a fixed point, not a moving GPS target), so
    // this is a no-op unless a custom start is already set.
    if (!destination || !customStart) return;
    const oldStart = customStart;
    const oldStartLabel = startQuery;
    setCustomStart(destination);
    setStartQuery(searchQuery);
    setDestination(oldStart);
    setSearchQuery(oldStartLabel);
  };

  useEffect(() => {
    // Note deliberately not wired into turn-by-turn/split-view logic —
    // that's pure client-side geo math against an already-loaded route
    // and keeps working fine with zero connectivity (a tunnel, a dead
    // zone). This only gates things that genuinely need the network:
    // search, rerouting, live nearby-data refresh, WebSocket updates.
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadNearbyData = async (location: Location) => {
    if (!isOnline) return;
    setNearbyLoading(true);
    setNearbyError(null);
    try {
      const [parking, parked, reportsData, billboardsData] = await Promise.all([
        getParking(location),
        getParkedCars(location),
        getReports(location),
        getBillboards(location),
      ]);
      setParkingLots(parking);
      setParkedCars(parked);
      setReports(reportsData);
      setBillboards(billboardsData);
    } catch (error) {
      console.error('Error loading nearby data:', error);
      setNearbyError(error instanceof Error ? error.message : 'Live map data is temporarily unavailable.');
    } finally {
      setNearbyLoading(false);
    }
  };

  useEffect(() => {
    if (!userLocation || !isOnline) return;
    let cancelled = false;
    const refreshParkedCars = async () => {
      try {
        const cars = await getParkedCars(userLocation, 1600);
        if (!cancelled) setParkedCars(cars);
      } catch {
        // Parking remains usable from the last known snapshot if the network blips.
      }
    };
    refreshParkedCars();
    const timer = window.setInterval(refreshParkedCars, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [userLocation?.lat, userLocation?.lng, isOnline]);

  const loadRoute = async (from: Location, to: Location, preserveNavigation = false) => {
    const requestId = ++routeRequestIdRef.current;
    const keepSession = preserveNavigation || navigationSessionRef.current;
    setRouteLoading(true);
    setRouteError(null);
    if (!keepSession) {
      navigationSessionRef.current = false;
      dispatchNavigation({ type: 'PLAN' });
    }

    try {
      let routes: Route3DHighlight[] = [];
      try {
        routes = await getRoute(from, to);
      } catch (networkError) {
        const cached = await readOfflineTrip(from, to, 7 * 24 * 60 * 60 * 1000);
        if (cached?.routes?.length) {
          routes = cached.routes;
          setInteractionToast('Using your cached route — live routing is unavailable.');
        } else {
          throw networkError;
        }
      }

      // Ignore an older response that arrived after a newer route request.
      if (requestId !== routeRequestIdRef.current) return;
      if (!routes || routes.length === 0) {
        if (keepSession) dispatchNavigation({ type: 'REROUTE_FAILED' });
        setRouteOptions([]);
        setRouteDecisionProfiles([]);
        setRouteError('No drivable route was found between these locations.');
        return;
      }

      // Commit the real routing result to the UI immediately. Community
      // intelligence, offline persistence, and map-tile caching are useful
      // enrichments, but none of them should keep the core route in a
      // "Building route…" state. This is especially important on slower
      // devices and makes the Start button reflect the actual routing result
      // rather than the completion of unrelated background work.
      const fallbackRankedRoutes = rankRoutesWithRisk(routes, [...reports, ...liveTraffic]);
      const fallbackProfiles = fallbackRankedRoutes.map((candidate) =>
        buildRouteDecisionProfiles([candidate], [...reports, ...liveTraffic], sceneContext, new Map())[0]
      );

      setRouteOptions(fallbackRankedRoutes);
      setRouteDecisionProfiles(fallbackProfiles);
      setSelectedRouteIndex(0);
      setManeuverIndex(0);
      setActiveManeuver(null);

      // The route is ready for the user now. Do not wait for optional
      // intelligence calls before enabling "Enter navigation".
      setRouteLoading(false);

      void writeOfflineTrip(from, to, fallbackRankedRoutes, {});
      void cacheRouteMapTiles(fallbackRankedRoutes[0]?.segments.flatMap((segment) =>
        segment.coords.map((coord) => ({ lat: coord.lat, lng: coord.lng }))
      ) ?? []);

      if (keepSession) {
        navigationSessionRef.current = true;
        // A successful reroute resumes the existing session; it must not be
        // treated as a fresh START event because the state machine correctly
        // rejects START while already in the rerouting state.
        dispatchNavigation(navigationState.phase === 'rerouting'
          ? { type: 'REROUTE_SUCCEEDED' }
          : { type: 'START', hasRoute: true });
      }

      // Enrich the already-visible route in the background. If the driver has
      // started navigation before this finishes, leave the active route alone
      // rather than swapping route geometry underneath the driver.
      void (async () => {
        try {
          const wayIds = Array.from(new Set(routes.flatMap((candidate) =>
            buildRouteDecisionProfiles([candidate], [], sceneContext, new Map())[0].wayIds
          ))).slice(0, 128);
          if (!wayIds.length) return;

          const communityItems = await getRoadIntelligenceBatch(wayIds, 30);
          if (requestId !== routeRequestIdRef.current || navigationSessionRef.current) return;

          const community = new Map(communityItems.map((item) => [item.way_id, item]));
          setRouteCommunityIntelligence(community);
          const profiles = buildRouteDecisionProfiles(routes, [...reports, ...liveTraffic], sceneContext, community);
          const order = rankRoutesBySpatialIntelligence(profiles);
          const enrichedRoutes = order.map((index) => routes[index]);
          const enrichedProfiles = order.map((index) => profiles[index]);

          if (requestId !== routeRequestIdRef.current || navigationSessionRef.current) return;
          setRouteOptions(enrichedRoutes);
          setRouteDecisionProfiles(enrichedProfiles);
          setSelectedRouteIndex(0);
        } catch {
          // Community intelligence is optional. The already-committed route
          // remains fully usable when this enrichment is unavailable.
          setRouteCommunityIntelligence(new Map());
        }
      })();
    } catch (error) {
      if (requestId !== routeRequestIdRef.current) return;
      console.error('Error loading route:', error);
      if (!keepSession) {
        setRouteOptions([]);
        setRouteDecisionProfiles([]);
        setRouteCommunityIntelligence(new Map());
      } else {
        dispatchNavigation({ type: 'REROUTE_FAILED' });
      }
      setRouteError(error instanceof Error ? error.message : 'We could not build this route. Check the locations and try again.');
    } finally {
      if (requestId === routeRequestIdRef.current) setRouteLoading(false);
    }
  };

  const upcomingManeuver = activeManeuver ?? maneuverDistances[maneuverIndex]?.maneuver ?? null;
  const upcomingRemainingM = activeManeuverRemainingM ?? (upcomingManeuver && userLocation && routePolyline.length >= 2
    ? (() => {
        const u = projectOntoPolyline(userLocation, routePolyline);
        const m = projectOntoPolyline(upcomingManeuver.location, routePolyline);
        return u && m ? Math.max(0, Math.round(m.distanceAlongMeters - u.distanceAlongMeters)) : null;
      })()
    : null);
  const progressRatio = route?.distance_meters && userLocation && routePolyline.length >= 2
    ? Math.min(1, Math.max(0, (projectOntoPolyline(userLocation, routePolyline)?.distanceAlongMeters ?? 0) / route.distance_meters))
    : 0;
  const routeProgressMeters = route?.distance_meters && userLocation && routePolyline.length >= 2
    ? (projectOntoPolyline(userLocation, routePolyline)?.distanceAlongMeters ?? null)
    : null;
  const navigationEta = estimateNavigationEta(
    routeProgressMeters,
    route?.distance_meters ?? null,
    route?.duration_seconds ?? null,
    speedMps,
  );
  const navigationEtaLabel = navigationEta.arrivalTimeMs != null
    ? new Date(navigationEta.arrivalTimeMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '—';

  const routeLaneEstimate = useMemo(() => {
    if (!upcomingManeuver || !userLocation || routePolyline.length < 2) return null;
    const projection = projectOntoPolyline(userLocation, routePolyline);
    if (!projection) return null;
    const laneCount = Math.max(1, upcomingManeuver.lanes?.length ?? 1);
    return estimateDriverLane(signedLateralOffset(userLocation, routePolyline, projection.segmentIndex), laneCount);
  }, [upcomingManeuver, userLocation, routePolyline]);

  const routeRisk = useMemo(() => routeRiskSummary(route, [...reports, ...liveTraffic]), [route, reports, liveTraffic, hazardRefreshAt]);
  const spatialCue = useMemo(() => {
    const spatial = navigationEngineSnapshot.spatialIntelligence;
    const guidance = navigationEngineSnapshot.spatialGuidance;
    if (!navigationStarted || guidance.action === 'continue') return null;
    const road = spatial.roadName ? ` on ${spatial.roadName}` : '';
    const distance = spatial.maneuverDistanceMeters != null ? ` · ${Math.max(0, Math.round(spatial.maneuverDistanceMeters))} m` : '';
    switch (guidance.action) {
      case 'slow':
        return { icon: '↓', title: 'Slow down', detail: spatial.speedLimitKph ? `Known limit ${Math.round(spatial.speedLimitKph)} km/h${road}` : `Reduce speed${road}`, tone: 'slow' };
      case 'high-alert':
        return { icon: '!', title: 'Complex maneuver ahead', detail: `${spatial.maneuver.replace('-', ' ')}${distance}${road}`, tone: 'alert' };
      case 'prepare':
        return { icon: '→', title: 'Prepare for the next move', detail: `${spatial.maneuver.replace('-', ' ')}${distance}${road}`, tone: 'prepare' };
      case 'uncertain':
        return { icon: '?', title: 'Road information uncertain', detail: 'Streept is using route guidance without adding assumptions.', tone: 'uncertain' };
      default:
        return null;
    }
  }, [navigationEngineSnapshot.spatialGuidance, navigationEngineSnapshot.spatialIntelligence, navigationStarted]);
  const handleMapClick = (e: L.LeafletMouseEvent) => {
    const newDest: Location = {
      lat: e.latlng.lat,
      lng: e.latlng.lng,
    };
    setDestination(newDest);
    setShowSearchResults(false);
  };

  const intelligencePresentation = useMemo(() => presentNavigationIntelligence(navigationEngineSnapshot), [navigationEngineSnapshot]);
  useEffect(() => {
    if (routeOptions.length < 2) { setTripRouteRanks([]); return; }
    let cancelled = false;
    void Promise.all(routeOptions.slice(0, 4).map(candidate => analyzeTrip(candidate, [...reports, ...liveTraffic]).catch(() => null)))
      .then(summaries => {
        if (cancelled) return;
        const valid = summaries.filter((x): x is TripIntelligenceSummary => Boolean(x));
        setTripRouteRanks(valid.length > 1 ? rankTripAlternatives(valid) : []);
      });
    return () => { cancelled = true; };
  }, [routeOptions, reports, liveTraffic]);

  useEffect(() => {
    if (!route) { setTripIntelligence(null); setTripStops([]); return; }
    let cancelled = false;
    setTripIntelligenceLoading(true);
    void analyzeTrip(route, [...reports, ...liveTraffic]).then(summary => {
      if (cancelled) return;
      setTripIntelligence(summary);
      void findTripStops(route).then(stops => { if (!cancelled) setTripStops(stops); });
    }).catch(() => { if (!cancelled) { setTripIntelligence(null); setTripStops([]); } })
      .finally(() => { if (!cancelled) setTripIntelligenceLoading(false); });
    return () => { cancelled = true; };
  }, [route, reports, liveTraffic]);

  const selectedRouteProfile = routeDecisionProfiles[selectedRouteIndex] ?? null;
  const selectedRouteGraph = useMemo(() => route ? buildRouteIntelligenceGraph(route, selectedRouteIndex, sceneContext, routeCommunityIntelligence, selectedRouteProfile, upcomingRemainingM) : null, [route, selectedRouteIndex, sceneContext, routeCommunityIntelligence, selectedRouteProfile, upcomingRemainingM]);

  const navigationConnectivityLabel = !isOnline
    ? 'OFFLINE MODE'
    : gpsStatus === 'lost'
      ? 'GPS SIGNAL LOST'
      : gpsStatus === 'weak'
        ? 'WEAK GPS'
        : navigationStarted
          ? 'LIVE NAVIGATION'
          : 'READY';

  return (
    <div className={`navigation-view ${splitView ? 'split-view' : ''}`}>
      {/* Left Pane: 2D Map */}
      <div className="map-pane">
        {!isOnline && (
          <div className="offline-banner">
            Offline — turn-by-turn keeps working, but search, rerouting, and live updates won't until you're
            back.
          </div>
        )}
        <div className="brand-mark" aria-label="Streept">
          <span>STREEPT</span><small>DRIVE BETTER</small>
        </div>
        {isOnline && nearbyLoading && (
          <div className="live-data-status" role="status" aria-live="polite">
            <span className="loading-spinner" /> Updating live road data…
          </div>
        )}
        {isOnline && nearbyError && !nearbyLoading && (
          <div className="live-data-error" role="status">
            <span>Live data couldn't refresh.</span>
            {userLocation && <button type="button" onClick={() => loadNearbyData(userLocation)}>Retry</button>}
          </div>
        )}
        {(destination || navigationStarted || navigationPhase === 'arrived') && (
          <div className="journey-rail" aria-label="Trip progress">
            <span className={!destination ? 'is-done' : 'is-done'}><b>1</b> Plan</span>
            <i />
            <span className={destination && !navigationStarted && navigationPhase !== 'arrived' ? 'is-active' : 'is-done'}><b>2</b> Review</span>
            <i />
            <span className={navigationStarted && navigationPhase !== 'arrived' ? 'is-active' : navigationPhase === 'arrived' ? 'is-done' : ''}><b>3</b> Drive</span>
            {navigationPhase === 'arrived' && <><i /><span className="is-active"><b>✓</b> Arrived</span></>}
          </div>
        )}
        <div className={`gps-status gps-status--${gpsStatus}`} role="status" aria-live="polite">
          <span className="gps-status-dot" />
          {navigationConnectivityLabel}
        {navigationStarted && <span className={`navigation-health navigation-health-${navigationHealth.gps}`} aria-label={`GPS ${navigationHealth.gps}`}>{navigationHealth.gps === 'good' ? 'GPS ready' : navigationHealth.gps === 'weak' ? 'GPS weak' : 'GPS reacquiring'}</span>}
        </div>
        {navigationStarted && navigationPhase !== 'arrived' && (
          <div className="nav-cockpit" aria-live="polite">
            <div className="nav-cockpit-header">
              <div className="nav-cockpit-live"><span /> LIVE</div>
              <div className="nav-cockpit-destination">{searchQuery || 'Active trip'} <span>·</span> {navigationHealth.gps === 'good' ? 'GPS locked' : 'Reacquiring GPS'}</div>
              <button type="button" className="nav-cockpit-more" aria-label="Navigation options">•••</button>
            </div>

            <div className={`nav-cockpit-main ${navigationPhase === 'rerouting' ? 'is-rerouting' : ''}`}>
              <div className="nav-cockpit-turn-icon">
                <span>{navigationPhase === 'rerouting' ? '↻' : (upcomingManeuver?.modifier?.includes('left') ? '↖' : upcomingManeuver?.modifier?.includes('right') ? '↗' : upcomingManeuver?.modifier === 'uturn' ? '↩' : '↑')}</span>
              </div>
              <div className="nav-cockpit-turn-copy">
                <div className="nav-cockpit-distance">{upcomingRemainingM != null ? `${upcomingRemainingM} m` : '—'}</div>
                <div className="nav-cockpit-kicker">{navigationPhase === 'rerouting' ? 'RECALCULATING YOUR ROUTE' : 'NEXT MANEUVER'}</div>
                <div className="nav-cockpit-instruction">{upcomingManeuver?.instruction ?? 'Continue on your route'}</div>
              </div>
              <div className="nav-cockpit-lanes">
                {upcomingManeuver?.lanes?.length ? upcomingManeuver.lanes.slice(0,5).map((lane, idx) => (
                  <span key={idx} className={`nav-cockpit-lane ${lane.valid ? 'is-valid' : ''} ${lane.recommended ? 'is-recommended' : ''}`}>
                    {(lane.indications?.[0] && LANE_INDICATION_ARROW[lane.indications[0]]) || '↑'}
                  </span>
                )) : <span className="nav-cockpit-lane is-valid">{upcomingManeuver?.modifier?.includes('left') ? '↖' : upcomingManeuver?.modifier?.includes('right') ? '↗' : '↑'}</span>}
              </div>
            </div>

            <div className="nav-cockpit-progress" aria-label={`${Math.round(progressRatio * 100)} percent of route completed`}><span style={{ width: `${progressRatio * 100}%` }} /></div>

            <div className="nav-cockpit-signals">
              <div className="nav-cockpit-signal"><strong>{speedMps > 0.5 ? Math.round(speedMps * 3.6) : 0}</strong><span>km/h</span></div>
              <div className="nav-cockpit-signal"><strong>{navigationEta.remainingSeconds != null ? Math.max(1, Math.round(navigationEta.remainingSeconds / 60)) : '—'}</strong><span>min left</span></div>
              <div className="nav-cockpit-signal"><strong>{navigationEtaLabel}</strong><span>arrival</span></div>
              {routeRisk.count > 0 && <div className="nav-cockpit-alert"><span>!</span><div><strong>{routeRisk.count} alert{routeRisk.count === 1 ? '' : 's'}</strong><small>ahead on route</small></div></div>}
              {intelligencePresentation.level !== 'clear' && <div className={`nav-cockpit-intelligence nav-cockpit-intelligence--${intelligencePresentation.level}`}><span>✦</span><div><strong>{intelligencePresentation.title}</strong><small>{intelligencePresentation.detail}</small></div></div>}
              {destinationParkingLots.length > 0 && <div className="nav-cockpit-parking"><span>P</span><div><strong>{destinationParkingLots[0].occupied_spaces}/{destinationParkingLots[0].total_spaces}</strong><small>parking near end</small></div></div>}
            </div>

            <div className="nav-cockpit-actions">
              <button type="button" onClick={() => { if (!userLocation) return; followMapRef.current = true; mapRef.current?.flyTo([userLocation.lat, userLocation.lng], 17, { duration: .7 }); }} disabled={!userLocation} aria-label="Center on my location">◎</button>
              <button type="button" onClick={() => setSplitView((v) => !v)} aria-label="Toggle 2D and 3D view">{splitView ? '2D' : '3D'}</button>
              <button type="button" onClick={() => { const next = !voiceEnabled; setVoiceEnabled(next); try { localStorage.setItem('streept_voice_enabled', next ? '1' : '0'); } catch {} }} aria-label={voiceEnabled ? 'Mute voice guidance' : 'Enable voice guidance'}>{voiceEnabled ? '🔊' : '🔇'}</button>
              <button type="button" onClick={handleStopNavigation} className="nav-cockpit-stop">End</button>
            </div>
          </div>
        )}
        <button type="button" className="theme-toggle nav-theme-toggle" onClick={onToggleTheme} title="Toggle light/dark">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        {!navigationStarted && !destination && (
          <section className="home-command-center" aria-label="Trip planning">
            <div className="home-command-head">
              <div>
                <span className="home-eyebrow">STREEPT LIVE</span>
                <h1>Where are you going?</h1>
                <p>Routes, parking and road conditions — before you leave.</p>
              </div>
              <span className="home-live-dot" aria-label="Live data" />
            </div>
            <div className="home-command-actions">
              <button type="button" onClick={() => { setShowSearchResults(true); setTimeout(() => document.querySelector<HTMLInputElement>('.trip-search-input[placeholder*="destination"]')?.focus(), 0); }}>
                <span className="home-action-icon">⌕</span>
                <span><strong>Plan a trip</strong><small>Search a destination</small></span>
                <b>›</b>
              </button>
              <button type="button" onClick={() => setShowParkingPanel(true)}>
                <span className="home-action-icon home-action-icon--parking">P</span>
                <span><strong>Find parking</strong><small>{parkingLots.length ? `${parkingLots.length} nearby lots live` : 'See availability nearby'}</small></span>
                <b>›</b>
              </button>
            </div>
            {savedPlaces.length > 0 && (
              <div className="home-recent home-saved-places">
                <div><span>SAVED PLACES</span><button type="button" onClick={() => setSavedPlaces(getSavedPlaces())}>Refresh</button></div>
                {savedPlaces.slice(0, 4).map((place) => (
                  <button key={place.id} type="button" onClick={() => handleSelectSearchResult(place)}>
                    <span className="home-recent-icon">★</span><span>{place.display_name}</span><b>›</b>
                  </button>
                ))}
              </div>
            )}
            {recentDestinations.length > 0 && (
              <div className="home-recent">
                <div><span>RECENT</span><button type="button" onClick={() => { setShowSearchResults(true); setSearchQuery(''); }}>See all</button></div>
                {recentDestinations.slice(0, 3).map((result, idx) => (
                  <button key={idx} type="button" onClick={() => handleSelectSearchResult(result)}>
                    <span className="home-recent-icon">↗</span><span>{result.display_name}</span><b>›</b>
                  </button>
                ))}
              </div>
            )}
            {parkingLots.length > 0 && (
              <div className="home-parking-snapshot">
                <div><span className="home-eyebrow">PARKING NEAR YOU</span><strong>{parkedCars.length} Streept cars are sharing parking data</strong></div>
                <button type="button" onClick={() => setShowParkingPanel(true)}>Explore ›</button>
              </div>
            )}
          </section>
        )}
        <div className="trip-search">
          <div className="trip-search-fields">
            <div className="trip-search-field-group">
              <span className="trip-search-icon trip-search-icon-start" aria-hidden="true" />
              <input
                type="text"
                className="trip-search-input"
                placeholder="Your location"
                value={startQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowStartResults(false); (e.currentTarget as HTMLInputElement).blur(); }
                  if (e.key === 'Enter' && startResults[0]) handleSelectStartResult(startResults[0]);
                }}
                onChange={(e) => {
                  setStartQuery(e.target.value);
                  setShowStartResults(true);
                }}
                onFocus={() => setShowStartResults(true)}
              />
              {customStart && (
                <button
                  type="button"
                  className="trip-search-clear"
                  onClick={handleUseCurrentLocationAsStart}
                  title="Use current location"
                >
                  ✕
                </button>
              )}
              {showStartResults && startQuery.trim().length === 0 && recentDestinations.length > 0 && (
                <div className="trip-search-results">
                  <div className="trip-search-section-label">Recent</div>
                  {recentDestinations.map((result, idx) => (
                    <button key={idx} className="trip-search-result" onClick={() => handleSelectStartResult(result)}>
                      🕑 {result.display_name}
                    </button>
                  ))}
                </div>
              )}
              {showStartResults && startQuery.trim().length >= 3 && (
                <div className="trip-search-results">
                  {startLoading && <div className="trip-search-status">Searching…</div>}
                  {!startLoading &&
                    startResults.map((result, idx) => (
                      <button key={idx} className="trip-search-result" onClick={() => handleSelectStartResult(result)}>
                        {result.display_name}
                      </button>
                    ))}
                  {!startLoading && startSearchError && (
                    <div className="trip-search-status trip-search-status--error">Search is temporarily unavailable. Try again.</div>
                  )}
                  {!startLoading && !startSearchError && startResults.length === 0 && (
                    <div className="trip-search-status">No places found</div>
                  )}
                  <div className="trip-search-attribution">Search powered by OpenStreetMap · Streept ranks for your trip</div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="trip-search-swap"
              onClick={handleSwapStartAndDestination}
              disabled={!customStart || !destination}
              title="Swap start and destination"
            >
              ⇅
            </button>

            <div className="trip-search-field-group">
              <span className="trip-search-icon trip-search-icon-destination" aria-hidden="true" />
              <input
                type="text"
                className="trip-search-input"
                placeholder="Search for a destination…"
                value={searchQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowSearchResults(false); (e.currentTarget as HTMLInputElement).blur(); }
                  if (e.key === 'Enter' && searchResults[0]) handleSelectSearchResult(searchResults[0]);
                }}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchResults(true);
                }}
                onFocus={() => setShowSearchResults(true)}
              />
              {searchQuery && (
                <button type="button" className="trip-search-clear trip-search-clear--destination" onClick={() => { setSearchQuery(''); setSearchResults([]); setShowSearchResults(true); }} aria-label="Clear destination">×</button>
              )}
              {showSearchResults && searchQuery.trim().length === 0 && (
                <div className="trip-search-results trip-search-results--smart-home">
                  <div className="trip-search-section-label">Quick search</div>
                  <div className="smart-search-presets">
                    {SEARCH_CATEGORY_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="smart-search-preset"
                        onClick={() => {
                          setSearchQuery(route ? `${preset.query} on my route` : preset.query);
                          setShowSearchResults(true);
                        }}
                      >
                        <span>{preset.icon}</span>{preset.label}
                      </button>
                    ))}
                  </div>
                  {route && (
                    <button type="button" className="smart-search-route-action" onClick={() => { setSearchQuery('coffee on my route'); setShowSearchResults(true); }}>
                      <span>↗</span><strong>Find something on my route</strong><small>Searches ahead instead of around you</small>
                    </button>
                  )}
                  {recentDestinations.length > 0 && (
                    <>
                      <div className="trip-search-section-label smart-search-recent-label">Recent</div>
                      {recentDestinations.slice(0, 5).map((result, idx) => (
                        <button key={idx} className="trip-search-result" onClick={() => handleSelectSearchResult(result)}>
                          🕑 {result.display_name}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
              {showSearchResults && searchQuery.trim().length >= 3 && (
                <div className="trip-search-results">
                  {searchLoading && <div className="trip-search-status">Searching…</div>}
                  {!searchLoading &&
                    searchResults.map((result, idx) => (
                      <button
                        key={idx}
                        className="trip-search-result trip-search-result--smart"
                        onClick={() => handleSelectSearchResult(result)}
                      >
                        <span className="smart-result-main">
                          <strong>{result.display_name.split(',')[0]}</strong>
                          <small>{result.category ? result.category.replace(/_/g, ' ') : (result.display_name.includes(',') ? result.display_name.slice(result.display_name.indexOf(',') + 1).trim() : 'OpenStreetMap place')}</small>
                        </span>
                        <span className="smart-result-meta">
                          {result.detourLabel && <b>{result.detourLabel}</b>}
                          {result.distanceLabel && <small>{result.distanceLabel}</small>}
                        </span>
                      </button>
                    ))}
                  {!searchLoading && searchError && (
                    <div className="trip-search-status trip-search-status--error">Search is temporarily unavailable. Try again.</div>
                  )}
                  {!searchLoading && !searchError && searchResults.length === 0 && (
                    <div className="trip-search-status">No places found</div>
                  )}
                  <div className="trip-search-attribution">Search powered by OpenStreetMap data</div>
                </div>
              )}
            </div>
          </div>
        </div>
        {routeOptions.length > 1 && (
          <div className="route-picker">
            {routeOptions.map((option, idx) => {
              const minutes = option.duration_seconds != null ? Math.round(option.duration_seconds / 60) : null;
              const km = option.distance_meters != null ? (option.distance_meters / 1000).toFixed(1) : null;
              return (
                <button
                  key={idx}
                  className={`route-picker-option ${idx === selectedRouteIndex ? 'route-picker-option--selected' : ''}`}
                  onClick={() => { setSelectedRouteIndex(idx); showInteractionToast(idx === 0 ? 'Fastest balanced route selected' : `Alternative route ${idx + 1} selected`); }}
                >
                  <span className="route-picker-time">{minutes !== null ? `${minutes} min` : `Route ${idx + 1}`}</span>
                  {km !== null && <span className="route-picker-distance">{km} km</span>}
                </button>
              );
            })}
          </div>
        )}
        {destination && !navigationStarted && (customStart || userLocation) && (
          <section className="destination-command-center" aria-label="Trip intelligence">
            <div className="destination-command-head">
              <div className="destination-command-title">
                <span className="home-eyebrow">TRIP INTELLIGENCE</span>
                <strong>{searchQuery || 'Destination'}</strong>
                <span>Everything you need before you pull away.</span>
              </div>
              <button type="button" className="destination-command-close" onClick={() => { setDestination(null); setRouteOptions([]); setRouteError(null); setSelectedParkingLotId(null); }}>×</button>
            </div>

            {route && !routeLoading && !routeError && (
              <div className="destination-route-summary">
                <div className="destination-route-primary">
                  <strong>{route.duration_seconds != null ? Math.max(1, Math.round(route.duration_seconds / 60)) : '—'}</strong>
                  <span>min</span>
                </div>
                <div><strong>{route.distance_meters != null ? (route.distance_meters / 1609.344).toFixed(1) : '—'}</strong><span>mi</span></div>
                <div><strong>{routeRisk.count}</strong><span>{routeRisk.count === 1 ? 'alert' : 'alerts'}</span></div>
                <div className="destination-route-arrival"><strong>{route.duration_seconds != null ? new Date(Date.now() + route.duration_seconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</strong><span>arrival</span></div>
              </div>
            )}

            {tripIntelligence && (
              <div className="destination-intelligence-strip trip-intelligence-strip">
                <div><strong>{tripIntelligence.difficulty >= 70 ? 'Demanding journey' : tripIntelligence.difficulty >= 45 ? 'Mixed driving' : 'Generally easy drive'}</strong><small>Road quality {tripIntelligence.roadQuality}/100 · traffic pressure {tripIntelligence.trafficPressure}/100</small></div>
                <div><strong>{tripIntelligence.characters.slice(0,3).map(x => `${x.character} ${x.percent}%`).join(' · ')}</strong><small>{tripIntelligence.chapters.length} journey chapters · {tripIntelligence.dataCoverage}% data coverage</small></div>
                {tripIntelligence.maxGradePercent >= 5 && <div><strong>Steep terrain ahead</strong><small>Maximum sampled grade {tripIntelligence.maxGradePercent}% · +{tripIntelligence.elevationGainMeters} m climb</small></div>}
              </div>
            )}
            {tripIntelligenceLoading && <div className="destination-intelligence-strip"><div><strong>Analyzing the journey…</strong><small>Road character, traffic, quality and terrain</small></div></div>}
            {tripStops.length > 0 && (
              <div className="trip-stop-hints"><strong>Useful stops along the journey</strong>{tripStops.slice(0,4).map(stop => <span key={`${stop.category}-${stop.location.lat}-${stop.location.lng}`}>{stop.category}: {stop.name.split(',')[0]}</span>)}</div>
            )}
            {selectedRouteGraph && (selectedRouteGraph.difficultNodes > 0 || selectedRouteGraph.highAttentionNodes > 0) && (
              <div className="destination-intelligence-strip">
                <span>✦</span>
                <div><strong>{selectedRouteGraph.highAttentionNodes > 0 ? `${selectedRouteGraph.highAttentionNodes} high-attention point${selectedRouteGraph.highAttentionNodes === 1 ? '' : 's'}` : `${selectedRouteGraph.difficultNodes} learned difficulty point${selectedRouteGraph.difficultNodes === 1 ? '' : 's'}`}</strong><small>Streept will stage guidance before these decisions.</small></div>
              </div>
            )}

            {routeOptions.length > 1 && (
              <div className="destination-routes">
                <div className="destination-section-label">ROUTES</div>
                {routeOptions.map((option, idx) => {
                  const mins = option.duration_seconds != null ? Math.max(1, Math.round(option.duration_seconds / 60)) : null;
                  const km = option.distance_meters != null ? (option.distance_meters / 1000).toFixed(1) : null;
                  return (
                    <button key={idx} type="button" className={`destination-route-option ${idx === selectedRouteIndex ? 'is-selected' : ''}`} onClick={() => { setSelectedRouteIndex(idx); showInteractionToast(idx === 0 ? 'Recommended route selected' : `Alternative route ${idx + 1} selected`); }}>
                      <span className="destination-route-dot" />
                      <span><strong>{mins != null ? `${mins} min` : `Route ${idx + 1}`}</strong><small>{km ? `${km} km` : 'Alternative route'}{idx === 0 ? ' · Best balance' : ''}{routeDecisionProfiles[idx]?.difficultRoads ? ` · ${routeDecisionProfiles[idx].difficultRoads} learned difficulty` : ''}{tripRouteRanks.find(r => r.routeIndex === idx)?.reasons.slice(0, 2).map(reason => ` · ${reason}`).join('') ?? ''}</small></span>
                      <b>{idx === selectedRouteIndex ? '✓' : '›'}</b>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="destination-place-actions">
              <button type="button" onClick={() => {
                if (!destination) return;
                const already = isSavedPlace(destination);
                if (already) { setInteractionToast('Already saved to your places'); return; }
                savePlace({ display_name: searchQuery || 'Saved place', location: destination });
                setSavedPlaces(getSavedPlaces());
                setInteractionToast('Saved to your places');
              }}>{destination && isSavedPlace(destination) ? '★ Saved place' : '☆ Save place'}</button>
              {destination && isSavedPlace(destination) && <button type="button" onClick={() => {
                const match = getSavedPlaces().find(p => Math.abs(p.location.lat - destination.lat) < 1e-5 && Math.abs(p.location.lng - destination.lng) < 1e-5);
                if (match) removeSavedPlace(match.id);
                setSavedPlaces(getSavedPlaces());
                setInteractionToast('Removed from saved places');
              }}>Remove</button>}
            </div>

            <div className="destination-alert-strip">
              <span className="destination-alert-icon">{routeRisk.count > 0 ? '!' : '✓'}</span>
              <span><strong>{routeRisk.count > 0 ? `${routeRisk.count} road ${routeRisk.count === 1 ? 'alert' : 'alerts'} on this trip` : 'Road looks clear'}</strong><small>{routeRisk.count > 0 ? 'Streept is watching the route for you.' : 'No active Streept reports are affecting the route.'}</small></span>
            </div>

            <div className="destination-parking">
              <div className="destination-section-head">
                <div><span className="destination-section-label">PARK NEAR DESTINATION</span><strong>{destinationParkingLoading ? 'Checking nearby lots…' : destinationParkingLots.length ? `${destinationParkingLots.length} lots with live availability` : 'No live lots nearby yet'}</strong></div>
                <span className="destination-parking-live">● LIVE</span>
              </div>
              {!destinationParkingLoading && destinationParkingLots.length > 0 && (
                <div className="destination-parking-list">
                  {[...destinationParkingLots].sort((a,b) => (a.occupied_spaces / Math.max(1,a.total_spaces)) - (b.occupied_spaces / Math.max(1,b.total_spaces))).slice(0, 3).map((lot) => {
                    const ratio = lot.occupied_spaces / Math.max(1, lot.total_spaces);
                    const available = Math.max(0, lot.total_spaces - lot.occupied_spaces);
                    const streeptCars = parkedCars.filter((car) => car.lot_id === lot.id).length;
                    return (
                      <button key={lot.id} type="button" className={`destination-parking-row ${selectedParkingLotId === lot.id ? 'is-selected' : ''}`} onClick={() => { setSelectedParkingLotId(lot.id); showInteractionToast(`${lot.name || 'Parking lot'} selected`); }}>
                        <span className={`destination-parking-badge ${ratio >= .9 ? 'is-full' : ratio >= .7 ? 'is-busy' : ''}`}>P</span>
                        <span className="destination-parking-copy"><strong>{lot.name || 'Parking lot'}</strong><small>{available} likely open · {streeptCars} Streept car{streeptCars === 1 ? '' : 's'}</small></span>
                        <span className="destination-parking-capacity"><b>{Math.round(ratio * 100)}%</b><small>full</small></span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedParkingLotId && (() => { const lot = destinationParkingLots.find((item) => item.id === selectedParkingLotId); return lot ? <button type="button" className="destination-park-button" onClick={() => handleNavigateToParking(lot)}>Navigate to {lot.name || 'this parking lot'} <span>→</span></button> : null; })()}
            </div>
          </section>
        )}

        {(destination && navigationPhase !== 'arrived' && !navigationStarted && (customStart || userLocation)) && (
          <div className={`start-navigation-card ${routePreviewFocused ? "is-focused" : ""}`} aria-live="polite">
            <div className="start-navigation-route-head">
              <div>
                <span className="start-navigation-eyebrow">TRIP PREVIEW</span>
                <strong>{routeLoading ? 'Building your route…' : routeError ? 'Route unavailable' : 'Ready to go'}</strong>
              </div>
              <span className="start-navigation-destination">{searchQuery || 'Destination selected'}</span>
            </div>
            {route && !routeLoading && !routeError ? (
              <div className="start-navigation-metrics">
                <div><strong>{route.duration_seconds != null ? Math.max(1, Math.round(route.duration_seconds / 60)) : '--'}</strong><span>min</span></div>
                <div><strong>{route.distance_meters != null ? (route.distance_meters / 1609.344).toFixed(1) : '--'}</strong><span>mi</span></div>
                <div><strong>{routeRisk.count}</strong><span>{routeRisk.count === 1 ? 'road alert' : 'road alerts'}</span></div>
              </div>
            ) : (
              <div className={`start-navigation-status ${routeError ? 'is-error' : ''}`}>
                <span>{routeError ?? 'Finding the best drivable route…'}</span>
                {routeError && !routeLoading && (customStart || userLocation) && destination && (
                  <button
                    type="button"
                    className="route-retry-button"
                    onClick={() => loadRoute(customStart ?? userLocation!, destination)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <div className="start-navigation-actions">
              <button type="button" className="start-navigation-secondary" onClick={() => setRoutePreviewFocused((v) => !v)}>
                {routePreviewFocused ? 'Route details' : 'Hide details'}
              </button>
              <button
                type="button"
                className="start-navigation-button"
                onClick={handleStartNavigation}
                disabled={!route || !!routeError}
              >
                <span className="start-navigation-button-icon">➤</span>
                <span>{routeLoading && !route ? 'Building route…' : 'Enter navigation'}</span>
              </button>
            </div>
          </div>
        )}
        {navigationStarted && routeLoading && (
          <div className="navigation-recalculating" role="status">
            <span className="navigation-recalculating-dot" />
            Recalculating your route…
          </div>
        )}
        {navigationPhase === 'arrived' && destination && (
          <div className="arrival-experience" role="status" aria-live="polite">
            <div className="arrival-experience-head">
              <div className="arrival-check">✓</div>
              <div className="arrival-copy">
                <span className="arrival-eyebrow">YOU'VE ARRIVED</span>
                <strong>{searchQuery || 'Destination'}</strong>
                <small>Your route is complete. Now find the easiest place to leave the car.</small>
              </div>
              <button type="button" className="arrival-dismiss" aria-label="Close arrival card" onClick={() => { clearNavigationSession(); setDestination(null); setRouteOptions([]); dispatchNavigation({ type: 'RESET' }); setSearchQuery(''); }}>×</button>
            </div>
            <div className="arrival-parking-head">
              <div><span className="arrival-section-label">PARKING AROUND YOU</span><strong>{destinationParkingLoading ? 'Checking live availability…' : destinationParkingLots.length ? 'Choose where to park' : 'No live parking lots found'}</strong></div>
              {destinationParkingLots.length > 0 && <span className="arrival-live">● LIVE</span>}
            </div>
            {destinationParkingLots.length > 0 && (
              <div className="arrival-parking-grid">
                {[...destinationParkingLots].sort((a,b) => (a.occupied_spaces / Math.max(1,a.total_spaces)) - (b.occupied_spaces / Math.max(1,b.total_spaces))).slice(0, 2).map((lot) => {
                  const ratio = lot.occupied_spaces / Math.max(1, lot.total_spaces);
                  const free = Math.max(0, lot.total_spaces - lot.occupied_spaces);
                  const streeptCars = parkedCars.filter((car) => car.lot_id === lot.id).length;
                  return (
                    <div key={lot.id} className="arrival-parking-card">
                      <div className={`arrival-parking-icon ${ratio >= .9 ? 'is-full' : ratio >= .7 ? 'is-busy' : ''}`}>P</div>
                      <div className="arrival-parking-info"><strong>{lot.name || 'Parking lot'}</strong><span>{free} likely open · {streeptCars} Streept car{streeptCars === 1 ? '' : 's'}</span></div>
                      <div className="arrival-parking-capacity"><b>{Math.round(ratio * 100)}%</b><span>full</span></div>
                      <button type="button" onClick={() => handleNavigateToParking(lot)}>Go</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="arrival-footer">
              <span><b>{Math.round(progressRatio * 100)}%</b> of the trip completed</span>
              {parkedLotId ? <span className="arrival-parked">✓ Parking detected</span> : <span>Streept will detect when you park</span>}
              <button type="button" onClick={() => { clearNavigationSession(); setDestination(null); setRouteOptions([]); dispatchNavigation({ type: 'RESET' }); setSearchQuery(''); }}>Done</button>
            </div>
          </div>
        )}
        {routeLoading && (
          <div className="route-loading-pill" role="status" aria-live="polite">
            <span className="loading-spinner" />
            <span>{navigationPhase === 'rerouting' ? 'Finding a better route…' : 'Building your route…'}</span>
          </div>
        )}
        <MapContainer
          ref={mapRef}
          center={userLocation ? [userLocation.lat, userLocation.lng] : [37.7749, -122.4194]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url={LEAFLET_BASE_TILE_URL}
            attribution={getLeafletAttribution()}
            maxZoom={16}
          />
          <TileLayer
            url={LEAFLET_REFERENCE_TILE_URL}
            attribution=""
            maxZoom={16}
            zIndex={400}
            opacity={0.96}
          />
          {userLocation && (
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={
                headingDeg !== null
                  ? L.divIcon({
                      html: `<div class="vehicle-arrow-wrap" style="transform: rotate(${headingDeg}deg)"><svg width="32" height="32" viewBox="0 0 32 32" class="vehicle-arrow-svg"><path class="vehicle-arrow-path" d="M16 2 L28 28 L16 22 L4 28 Z"/></svg></div>`,
                      className: 'vehicle-marker-icon',
                      iconSize: [32, 32],
                      iconAnchor: [16, 16],
                    })
                  : L.divIcon({
                      html: `<div class="vehicle-dot"></div>`,
                      className: 'vehicle-marker-icon',
                      iconSize: [18, 18],
                      iconAnchor: [9, 9],
                    })
              }
            >
              <Popup>Your Location</Popup>
            </Marker>
          )}
          {destination && (
            <Marker position={[destination.lat, destination.lng]}>
              <Popup>Destination</Popup>
            </Marker>
          )}
          {route &&
            route.segments.map((segment, idx) => {
              const positions = segment.coords.map((c) => [c.lat, c.lng] as [number, number]);
              // Dark casing underneath + bright electric-green fill on top — the
              // reference-inspired route treatment, needed for legibility
              // against any basemap (especially satellite imagery, whose
              // colors are unpredictable). Casing color is fixed regardless
              // of app theme since it's about contrast with the *map*, not
              // matching the UI chrome. Literal hex values here, not CSS
              // var() — Leaflet sets these as raw SVG attributes, which
              // don't resolve CSS custom properties the way stylesheet
              // rules do.
              return (
                <React.Fragment key={idx}>
                  <Polyline positions={positions} color="#0b0c0e" weight={10} opacity={0.9} />
                  <Polyline positions={positions} color={ROUTE_LINE_COLOR[theme]} weight={6} />
                </React.Fragment>
              );
            })}
          {showReportsLayer && reports.map((report) => {
            const meta = REPORT_TYPE_META[report.type] ?? { label: report.type, emoji: '📍' };
            return (
              <Marker
                key={report.id}
                position={[report.location.lat, report.location.lng]}
                icon={L.divIcon({
                  html: `<div class="report-marker">${meta.emoji}</div>`,
                  className: '',
                  iconSize: [28, 28],
                })}
              >
                <Popup>
                  <div>
                    <p>
                      <strong>{meta.label}</strong>
                    </p>
                    <p>
                      👍 {report.confirmations} still there &nbsp; 👎 {report.dismissals} gone
                    </p>
                    <button onClick={() => handleConfirmReport(report)}>Still there</button>{' '}
                    <button onClick={() => handleDismissReport(report)}>Not there</button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {billboards.map((billboard) => {
            const loc = billboard.location as Location;
            const isMine = billboard.purchased_by === currentUserId;
            const isFormOpen = billboardFormId === billboard.id;
            return (
              <Marker
                key={billboard.id}
                position={[loc.lat, loc.lng]}
                icon={L.divIcon({
                  html: `<div class="billboard-marker">📢</div>`,
                  className: '',
                  iconSize: [28, 28],
                })}
              >
                <Popup minWidth={220}>
                  <div>
                    {billboard.is_purchased && billboard.ad_image_url ? (
                      <div>
                        <img
                          src={billboard.ad_image_url}
                          alt="Advertisement"
                          style={{ width: '100%', maxHeight: 100, objectFit: 'cover', cursor: 'pointer' }}
                          onClick={() => handleBillboardAdClick(billboard)}
                        />
                        <p style={{ fontSize: 12, color: '#666' }}>
                          {billboard.click_count} click{billboard.click_count === 1 ? '' : 's'}
                          {billboard.display_end &&
                            ` · live until ${new Date(billboard.display_end).toLocaleString()}`}
                        </p>
                        {isMine && <p style={{ fontSize: 12 }}>Your test ad is live on Streept.</p>}
                      </div>
                    ) : isFormOpen ? (
                      <div className="billboard-form">
                        <div className="billboard-form-title">Publish on this billboard</div>
                        <div className="billboard-form-badge">FREE BETA · LIVE IMMEDIATELY</div>
                        <input
                          type="text"
                          placeholder="Ad image URL (https://…)"
                          value={billboardFormAdImage}
                          onChange={(e) => setBillboardFormAdImage(e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Ad target URL (https://…)"
                          value={billboardFormAdTarget}
                          onChange={(e) => setBillboardFormAdTarget(e.target.value)}
                        />
                        <select
                          value={billboardFormDurationHours}
                          onChange={(e) => setBillboardFormDurationHours(Number(e.target.value))}
                        >
                          <option value={24}>24 hours</option>
                          <option value={24 * 7}>7 days</option>
                          <option value={24 * 30}>30 days (max)</option>
                        </select>
                        {billboardError && <p className="billboard-form-error">{billboardError}</p>}
                        <button onClick={handlePurchaseBillboard} disabled={billboardSubmitting}>
                          {billboardSubmitting ? 'Publishing...' : 'Publish ad — free'}
                        </button>
                        <button onClick={() => setBillboardFormId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div>
                        <p><strong>Free beta ad space</strong></p>
                        <p className="billboard-beta-copy">Publish a test ad here for free. No payment or advertiser account required.</p>
                        <button onClick={() => openBillboardForm(billboard)}>Publish an ad</button>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
          {parkingOnly && parkedCars.map((car) => (
            <Marker
              key={`parked-car-${car.id}`}
              position={[car.location.lat, car.location.lng]}
              icon={L.divIcon({
                html: '<div class="parked-car-marker"><span>🚗</span></div>',
                className: '',
                iconSize: [30, 30],
                iconAnchor: [15, 15],
              })}
            >
              <Popup>
                <div className="parking-car-popup">
                  <strong>Parked here</strong>
                  <span>Anonymous Streept driver</span>
                  <small>Live occupancy signal</small>
                </div>
              </Popup>
            </Marker>
          ))}
          {parkingOnly && parkingLots.map((lot) => {
            const loc = lot.location as Location;
            const ratio = lot.total_spaces > 0 ? lot.occupied_spaces / lot.total_spaces : 0;
            const status = ratio >= 1 ? 'full' : ratio >= .82 ? 'busy' : ratio >= .55 ? 'moderate' : 'open';
            const isMine = parkedLotId === lot.id;
            const lotCars = parkedCars.filter((car) => car.lot_id === lot.id);
            return (
              <Marker
                key={lot.id}
                position={[loc.lat, loc.lng]}
                icon={L.divIcon({
                  html: `<div class="parking-lot-marker parking-lot-marker--${status}${isMine ? ' parking-lot-marker--mine' : ''}"><span class="parking-lot-marker-icon">P</span><span>${lot.occupied_spaces}/${lot.total_spaces}</span></div>`,
                  className: '',
                  iconSize: [82, 34],
                  iconAnchor: [41, 17],
                })}
                eventHandlers={{ click: () => setShowParkingPanel(true) }}
              >
                <Popup>
                  <div className="parking-popup">
                    <div className="parking-popup-head">
                      <div><strong>{lot.name ?? 'Parking'}</strong><span>{status === 'full' ? 'Full' : status === 'busy' ? 'Busy' : 'Spaces available'}</span></div>
                      <b>{Math.max(0, lot.total_spaces - lot.occupied_spaces)}</b>
                    </div>
                    <div className="parking-popup-meter"><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                    <p>{lot.occupied_spaces} of {lot.total_spaces} spaces occupied</p>
                    <p className="parking-popup-live">● {lotCars.length} Streept car{lotCars.length === 1 ? '' : 's'} detected</p>
                    {isMine && <p className="parking-popup-mine">Your car is sharing this location</p>}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
        <div className="map-intelligence-strip" aria-label="Live map intelligence">
          <div className="map-intelligence-live"><span />LIVE MAP</div>
          <div className="map-intelligence-items">
            <span><b>{reports.length}</b> reports</span>
            <span><b>{parkingLots.length}</b> parking lots</span>
            <span><b>{liveTrafficVehicles.length}</b> traffic signals</span>
          </div>
        </div>
        {userLocation && (
          <div className="map-location-control">
            <button
              type="button"
              className="locate-me-button"
              onClick={() => {
                if (!mapRef.current || !userLocation) return;
                hasCenteredOnLocationRef.current = true;
                mapRef.current.flyTo([userLocation.lat, userLocation.lng], Math.max(mapRef.current.getZoom(), 16), { duration: 0.8 });
              }}
              title="Center map on my location"
              aria-label="Center map on my location"
            >
              ◎
            </button>
          </div>
        )}
        <div className="map-zoom-control" aria-label="Map zoom controls">
          <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button>
        </div>
        <div className="map-utility-stack">
          <button className={`map-utility-button ${showParkingPanel ? 'is-active' : ''}`} onClick={() => setShowParkingPanel(v => !v)} aria-label="Parking">
            <span>⌾</span><small>Parking</small>
          </button>
          <button className={`map-utility-button ${showLayersPanel ? 'is-active' : ''}`} onClick={() => setShowLayersPanel(v => !v)} aria-label="Map layers">
            <span>≋</span><small>Layers</small>
          </button>
        </div>
        {showLayersPanel && (
          <div className="map-layer-panel">
            <div><strong>Map layers</strong><button onClick={() => setShowLayersPanel(false)}>×</button></div>
            <label><span><i className="layer-swatch layer-swatch--parking" />Parking</span><input type="checkbox" checked={parkingOnly} onChange={(e) => setParkingOnly(e.target.checked)} /></label>
            <label><span><i className="layer-swatch layer-swatch--reports" />Road reports</span><input type="checkbox" checked={showReportsLayer} onChange={(e) => setShowReportsLayer(e.target.checked)} /></label>
            <label><span><i className="layer-swatch layer-swatch--traffic" />Live traffic</span><input type="checkbox" checked={showTrafficLayer} onChange={(e) => setShowTrafficLayer(e.target.checked)} /></label>
            <div className="map-layer-legend">
              <span><i className="map-legend-line map-legend-line--route" />Route</span>
              <span><i className="map-legend-dot map-legend-dot--traffic" />Slow traffic</span>
              <span><i className="map-legend-dot map-legend-dot--report" />Incident</span>
            </div>
          </div>
        )}
        {showParkingPanel && (
          <div className="parking-discovery-panel">
            <div className="parking-discovery-head">
              <div><span className="eyebrow">LIVE PARKING</span><strong>Find a spot before you arrive</strong></div>
              <button onClick={() => setShowParkingPanel(false)}>×</button>
            </div>
            <div className="parking-discovery-stats"><span><b>{parkingLots.length}</b> lots</span><span><b>{parkedCars.length}</b> cars seen</span></div>
            <div className="parking-discovery-list">
              {parkingLots.slice().sort((a,b) => (a.occupied_spaces / Math.max(1,a.total_spaces)) - (b.occupied_spaces / Math.max(1,b.total_spaces))).slice(0,4).map((lot) => {
                const free = Math.max(0, lot.total_spaces - lot.occupied_spaces);
                return <button key={lot.id} onClick={() => { mapRef.current?.flyTo([lot.location.lat, lot.location.lng], 17, { duration: .7 }); setShowParkingPanel(false); }}><span className="parking-mini-icon">P</span><span className="parking-mini-copy"><strong>{lot.name ?? 'Parking lot'}</strong><small>{free > 0 ? `${free} spaces likely available` : 'Looks full'} · {lot.occupied_spaces}/{lot.total_spaces}</small></span><span className="parking-mini-arrow">›</span></button>;
              })}
            </div>
          </div>
        )}

        <div className="report-button-container">
          {showReportMenu ? (
            <div className="report-menu">
              {Object.entries(REPORT_TYPE_META).map(([type, meta]) => (
                <button
                  key={type}
                  onClick={() => handleCreateReport(type)}
                  disabled={reportSubmitting || !userLocation}
                >
                  {meta.emoji} {meta.label}
                </button>
              ))}
              <button className="report-menu-cancel" onClick={() => setShowReportMenu(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="report-fab"
              onClick={() => setShowReportMenu(true)}
              disabled={!userLocation}
              title="Report something at your location"
            >
              ⚠️ Report
            </button>
          )}
        </div>
        {interactionToast && <div className="interaction-toast" role="status">{interactionToast}</div>}
        {reportError && (
          <div className="floating-error">
            <p>{reportError}</p>
            <button onClick={() => setReportError(null)}>Dismiss</button>
          </div>
        )}
        {parkedLotId && (
          <div className="parking-status">
            <p>Parked</p>
            <p>{parkingLots.find((l) => l.id === parkedLotId)?.name ?? 'Detected automatically'}</p>
            <button
              onClick={() => {
                checkoutParking()
                  .then(() => setParkedLotId(null))
                  .catch((error) => { console.error('Error checking out of parking:', error); setInteractionToast('Could not update parking status. Try again.'); });
              }}
            >
              I've left
            </button>
          </div>
        )}
        {spatialCue && (
          <div className={`spatial-cue spatial-cue--${spatialCue.tone}`} role="status" aria-live="polite">
            <span className="spatial-cue-icon" aria-hidden="true">{spatialCue.icon}</span>
            <div className="spatial-cue-copy">
              <strong>{spatialCue.title}</strong>
              <span>{spatialCue.detail}</span>
            </div>
          </div>
        )}
        <div className="navigation-instructions">
          <h3>Turn-by-Turn</h3>
          {activeManeuver && activeManeuverRemainingM !== null ? (
            <div>
              <p>
                <strong>{activeManeuver.instruction}</strong>
              </p>
              <p>In {activeManeuverRemainingM} m</p>
              {activeManeuver.lanes && activeManeuver.lanes.length > 0 && (
                <div className="lane-guidance">
                  {activeManeuver.lanes.map((lane, idx) => (
                    <div key={idx} className={`lane-guidance-lane ${lane.valid ? 'lane-guidance-lane--valid' : ''} ${lane.recommended ? 'lane-guidance-lane--recommended' : ''}`}>
                      {LANE_INDICATION_ARROW[lane.indications[0]] ?? '•'}
                    </div>
                  ))}
                  <span className="lane-guidance-label">{laneGuidanceLabel(activeManeuver, currentLaneEstimate?.laneIndex ?? routeLaneEstimate?.laneIndex ?? null) ?? 'Lane guidance'}{currentLaneEstimate?.laneIndex != null ? ` · Current lane ${currentLaneEstimate.laneIndex + 1}` : ''}{laneExecution && laneExecution.phase !== 'idle' ? ` · ${laneExecution.phase === 'completed' ? 'Lane change complete' : laneExecution.phase === 'missed' ? 'Re-routing for missed lane' : laneExecution.phase === 'changing' ? 'Changing lane' : 'Prepare lane change'}` : ''}</span>
                </div>
              )}
            </div>
          ) : route ? (
            <p>Follow the highlighted route</p>
          ) : (
            <p>Click the map to set a destination</p>
          )}
          {(destination || activeManeuver) && (
            <button className="ar-trigger-button" onClick={() => setShowArOverlay(true)}>
              📷 View in AR
            </button>
          )}
        </div>
      </div>

      {/* Right Pane: predictive immersive 3D view. It stays mounted so the
          Cesium renderer keeps its GPU resources warm between turn previews. */}
      <div className="map3d-pane" style={{ display: splitView ? 'block' : 'none' }}>
        <ImmersiveTurnView
          route={route}
          userLocation={userLocation}
          maneuver={activeManeuver}
          remainingMeters={activeManeuverRemainingM}
          speedMps={speedMps}
          onSceneContext={(scene) => { setSceneContext(scene); navigationEngineRef.current?.setSceneContext(scene); }}
          destinationLabel={searchQuery || 'Destination'}
          currentLaneIndex={currentLaneEstimate?.laneIndex ?? null}
          currentLaneConfidence={currentLaneEstimate?.confidence ?? 0}
          laneExecution={laneExecution}
          liveTrafficVehicles={liveTrafficVehicles}
          sceneContext={sceneContext}
          billboards={billboards}
          navigationSnapshot={navigationEngineSnapshot}
        />
      </div>

      {showArOverlay && userLocation && (destination || activeManeuver) && (
        <ArOverlay
          userLocation={userLocation}
          targetLocation={activeManeuver?.location ?? destination!}
          targetLabel={activeManeuver?.instruction ?? 'Destination'}
          onClose={() => setShowArOverlay(false)}
        />
      )}
    </div>
  );
};

export default NavigationView;

