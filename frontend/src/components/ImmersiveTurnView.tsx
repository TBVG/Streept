import React, { useEffect, useRef, useState } from 'react';
import { getSceneContext } from '../services/api';
import { Location, Maneuver, Route3DHighlight, RouteCoord, SceneContext, Billboard, SceneRoad } from '../types';
import { destinationPoint, bearingDegrees } from '../utils/geo';
import { buildSceneGuidancePlan, sceneLanePoint, laneCenterOffsetMeters } from '../navigation/sceneGuidance';
import { buildRouteAheadContinuityPlan, continuityLanePolygon } from '../navigation/routeAheadContinuity';
import { buildPhysicalLaneTopology } from '../navigation/physicalLaneTopology';
import { chooseDestinationLane } from '../navigation/destinationLaneIntelligence';
import { LaneChangeExecutionState } from '../navigation/laneChangeExecution';
import { budgetSceneContext, routeRenderStride } from '../navigation/scenePerformance';
import { buildLiveTraffic3D } from '../navigation/liveTraffic3D';
import { SceneBubbleStreamer } from '../navigation/sceneBubbleStreaming';
import { buildSceneRenderPlan } from '../navigation/sceneRenderLifecycle';
import { buildRouteScenePrefetchPlan } from '../navigation/routeScenePrefetch';
import { TrafficInterpolator } from '../navigation/trafficInterpolation';
import { prioritizeTrafficCandidates } from '../navigation/trafficPrioritization';
import { TrafficVehicle } from '../types';
import { splitSceneIntoChunks, sceneChunkPlanKey } from '../navigation/sceneChunks';
import { sceneLodForObject, sceneLodPolicyForQuality } from '../navigation/sceneLod';
import { AdaptiveRenderQuality, RenderQualityTier } from '../navigation/adaptiveRenderQuality';
import { buildJunctionCuePlan } from '../navigation/junctionCues';
import { buildMultiManeuverChoreography } from '../navigation/multiManeuverChoreography';
import { buildPredictiveJunctionApproach } from '../navigation/predictiveJunctionApproach';
import { buildSceneConfidence } from '../navigation/sceneConfidence';
import { buildDriverGuidanceFallback } from '../navigation/driverGuidanceFallback';
import { GuidanceTransitionSmoother } from '../navigation/guidanceTransitionSmoothing';
import { SceneFreshnessTracker } from '../navigation/sceneFreshness';
import { buildSceneRecoveryPlan } from '../navigation/sceneRecovery';
import { buildSceneComposition, SceneCompositionPlan } from '../navigation/sceneComposition';
import { RuntimeFrameMonitor } from '../navigation/productionQa';
import { buildSceneReacquisitionPlan } from '../navigation/sceneReacquisition';
import { buildPredictiveScenePrefetchPlan } from '../navigation/scenePredictivePrefetch';
import { ScenePrimitivePool } from '../navigation/scenePrimitivePool';
import { SceneResidencyManager } from '../navigation/sceneResidency';
import { SceneLifecycleGuard } from '../navigation/sceneLifecycleGuard';
import { buildImmersiveNavigationState, ImmersiveNavigationState } from '../navigation/immersiveNavigationRuntime';
import { NavigationEngineSnapshot } from '../navigation/navigationEngine';
import { deriveJunctionGuidanceState } from '../navigation/junctionGuidanceState';
import { assessBillboardSafety } from '../navigation/billboardSafety';
import './ImmersiveTurnView.css';

// CesiumJS is loaded at runtime so the core app remains key-free. The
// immersive scene deliberately uses only open geographic data and locally
// generated navigation geometry; it does not require Cesium ion.
const CESIUM_JS = 'https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/Cesium.js';
const CESIUM_CSS = 'https://cesium.com/downloads/cesiumjs/releases/1.144/Build/Cesium/Widgets/widgets.css';

type CesiumLike = any;

interface Props {
  route: Route3DHighlight | null;
  userLocation: Location | null;
  maneuver: Maneuver | null;
  remainingMeters: number | null;
  speedMps?: number | null;
  onSceneContext?: (scene: SceneContext) => void;
  destinationLabel?: string | null;
  currentLaneIndex?: number | null;
  currentLaneConfidence?: number;
  laneExecution?: LaneChangeExecutionState | null;
  liveTrafficVehicles?: TrafficVehicle[];
  sceneContext?: SceneContext | null;
  billboards?: Billboard[];
  navigationSnapshot?: NavigationEngineSnapshot | null;
}

type SceneData = SceneContext;

function loadCesium(): Promise<CesiumLike> {
  const w = window as any;
  if (w.Cesium) return Promise.resolve(w.Cesium);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${CESIUM_JS}"]`) as HTMLScriptElement | null;
    const cssExists = document.querySelector(`link[href="${CESIUM_CSS}"]`);
    if (!cssExists) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = CESIUM_CSS;
      document.head.appendChild(css);
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(w.Cesium));
      existing.addEventListener('error', () => reject(new Error('Cesium failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = CESIUM_JS;
    script.async = true;
    script.onload = () => resolve(w.Cesium);
    script.onerror = () => reject(new Error('Cesium failed to load'));
    document.head.appendChild(script);
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let delta = ((b - a + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
};

const ImmersiveTurnView: React.FC<Props> = ({ route, userLocation, maneuver, remainingMeters, speedMps = 0, onSceneContext, destinationLabel, currentLaneIndex = null, currentLaneConfidence = 0, laneExecution = null, liveTrafficVehicles = [], sceneContext = null, billboards = [], navigationSnapshot = null }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const destroyedRef = useRef(false);
  const sceneKeyRef = useRef('');
  const sceneCacheRef = useRef<Map<string, SceneData>>(new Map());
  const sceneFetchedAtRef = useRef(new SceneFreshnessTracker());
  const cameraTargetRef = useRef<{ location: Location; bearing: number } | null>(null);
  const cameraCurrentRef = useRef<{ location: Location; bearing: number } | null>(null);
  const hasInitialCameraRef = useRef(false);
  const staticPrimitiveRef = useRef<any>(null);
  const sceneGenerationRef = useRef(0);
  const scenePlanRef = useRef<string>('');
  const sceneChunkPrimitivesRef = useRef<Map<string, any>>(new Map());
  const sceneChunkEntitiesRef = useRef<Map<string, Set<any>>>(new Map());
  const scenePrimitivePoolRef = useRef(new ScenePrimitivePool<any>(8));
  const sceneChunkRetireAtRef = useRef<Map<string, number>>(new Map());
  const sceneResidencyRef = useRef(new SceneResidencyManager());
  const sceneLifecycleRef = useRef(new SceneLifecycleGuard());
  const routeGenerationRef = useRef(0);
  const sceneReacquisitionLocationRef = useRef<Location | null>(null);
  const guidanceEntitiesRef = useRef<Set<any>>(new Set());
  const vehicleEntityRef = useRef<any>(null);
  const trafficVehicleEntitiesRef = useRef<Map<string, any>>(new Map());
  const trafficInterpolatorRef = useRef(new TrafficInterpolator());
  const vehicleHeadingRef = useRef(0);
  const remainingMetersRef = useRef<number | null>(remainingMeters);
  const sceneContextFromCallbackRef = useRef<SceneContext | null>(null);
  const [dynamicSceneContext, setDynamicSceneContext] = useState<SceneContext | null>(null);
  const [renderQualityTier, setRenderQualityTier] = useState<RenderQualityTier>('high');
  const adaptiveQualityRef = useRef(new AdaptiveRenderQuality());
  const runtimeFrameMonitorRef = useRef(new RuntimeFrameMonitor());
  const guidanceSmootherRef = useRef(new GuidanceTransitionSmoother(650));
  const billboardsRef = useRef<Billboard[]>(billboards);
  billboardsRef.current = billboards;
  const immersiveNavigationState = buildImmersiveNavigationState({ snapshot: navigationSnapshot, route, maneuver, userLocation, scene: sceneContext ?? dynamicSceneContext, sceneAgeMs: null });
  const sceneBubbleStreamerRef = useRef<SceneBubbleStreamer | null>(null);
  if (!sceneBubbleStreamerRef.current) sceneBubbleStreamerRef.current = new SceneBubbleStreamer();

  useEffect(() => {
    let cancelled = false;
    destroyedRef.current = false;

    const start = async () => {
      if (!containerRef.current) return;
      try {
        const Cesium = await loadCesium();
        if (cancelled || !containerRef.current) return;

        // Use an open global quantized-mesh terrain source when available.
        // It gives the first-person scene real elevation instead of a flat
        // ellipsoid while keeping the default build free of ion/API keys.
        let terrainProvider = new Cesium.EllipsoidTerrainProvider();
        try {
          terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
            'https://terrain.reearth.land/cesium-mesh/ellipsoid',
            { requestVertexNormals: true, requestWaterMask: true }
          );
        } catch (terrainError) {
          console.warn('Open terrain unavailable; falling back to ellipsoid.', terrainError);
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          timeline: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          baseLayerPicker: false,
          creditContainer: document.createElement('div'),
          terrainProvider,
        });
        viewerRef.current = viewer;
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#9fc4d7');
        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#6fa85a');
        viewer.scene.globe.maximumScreenSpaceError = 0.5;
        viewer.scene.fog.density = 0.00010;
        // Cesium's tile LOD knobs are also respected if a real 3D tileset is
        // introduced later; the local generated scene uses the same near/far
        // philosophy below.
        (viewer.scene as any).dynamicScreenSpaceError = true;
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.globe.showGroundAtmosphere = true;
        viewer.scene.skyAtmosphere.show = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.00012;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
        viewer.scene.highDynamicRange = true;
        // Render above 1x on dense displays so lane/building edges stay crisp.
        const pixelRatio = window.devicePixelRatio || 1;
        const cores = navigator.hardwareConcurrency || 4;
        // Spend GPU budget where the driver actually looks. High-DPI devices
        // get a crisp render, while low-end hardware avoids an expensive
        // supersampled frame that would make the turn preview stutter.
        viewer.resolutionScale = cores >= 8
          ? Math.min(2, Math.max(1, pixelRatio))
          : Math.min(1.5, Math.max(1, pixelRatio));
        // Street-level views benefit from an aggressively refined near field
        // while distant terrain can remain coarser. This mirrors the LOD
        // philosophy used by streamed 3D Tiles without requiring a paid tile
        // service.
        viewer.scene.globe.maximumScreenSpaceError = cores >= 8 ? 0.65 : 1.1;
        viewer.scene.globe.tileCacheSize = cores >= 8 ? 1200 : 700;
        viewer.scene.globe.preloadSiblings = true;
        viewer.scene.globe.preloadAncestors = true;
        (viewer.scene as any).foveatedScreenSpaceError = true;
        (viewer.scene as any).foveatedTimeDelay = 0.12;
        viewer.scene.postProcessStages.fxaa.enabled = true;
        viewer.camera.frustum.fov = Cesium.Math.toRadians(76);

        // Minimal driver vehicle: deliberately generated from primitives so
        // the immersive view has no external 3D-model dependency.
        vehicleEntityRef.current = viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0.72),
          orientation: Cesium.Transforms.headingPitchRollQuaternion(
            Cesium.Cartesian3.fromDegrees(0, 0, 0.72),
            new Cesium.HeadingPitchRoll(0, 0, 0)
          ),
          cylinder: {
            length: 2.7,
            topRadius: 0.48,
            bottomRadius: 0.62,
            material: Cesium.Color.fromCssColorString('#ffd33d'),
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.95),
          },
          point: {
            pixelSize: 8,
            color: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.fromCssColorString('#ffd33d'),
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        // Use a public aerial basemap underneath the OSM-derived geometry.
        // This is intentionally an imagery layer, not a paid SDK or API-key
        // dependency. If the imagery service is unavailable, the generated
        // road/building scene remains fully usable.
        try {
          const imagery = new Cesium.UrlTemplateImageryProvider({
            url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            maximumLevel: 21,
            credit: 'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
          });
          viewer.imageryLayers.addImageryProvider(imagery);
        } catch (imageryError) {
          console.warn('High-resolution aerial imagery unavailable; using generated scene.', imageryError);
        }
        await renderScene(Cesium, viewer, route, maneuver, sceneCacheRef.current, sceneKeyRef, hasInitialCameraRef, staticPrimitiveRef, sceneGenerationRef.current, sceneGenerationRef, onSceneContext, currentLaneIndex, currentLaneConfidence, destinationLabel, laneExecution, userLocation, speedMps, liveTrafficVehicles, trafficVehicleEntitiesRef, null, scenePlanRef, guidanceEntitiesRef, vehicleEntityRef, sceneChunkPrimitivesRef, sceneChunkEntitiesRef, adaptiveQualityRef.current.getTier(), billboards, guidanceSmootherRef, sceneFetchedAtRef, sceneResidencyRef, scenePrimitivePoolRef, sceneLifecycleRef, sceneReacquisitionLocationRef, sceneChunkRetireAtRef, cameraTargetRef, immersiveNavigationState, navigationSnapshot, remainingMeters);

        // One persistent animation loop smooths GPS changes. We never snap
        // the camera to every browser geolocation fix.
        let lastFrameMs = performance.now();
        const applyQuality = (tier: RenderQualityTier) => {
          const profile = adaptiveQualityRef.current.getProfile();
          const cores = navigator.hardwareConcurrency || 4;
          const pixelRatio = window.devicePixelRatio || 1;
          const baseScale = cores >= 8 ? Math.min(2, Math.max(1, pixelRatio)) : Math.min(1.5, Math.max(1, pixelRatio));
          viewer.scene.highDynamicRange = profile.highDynamicRange;
          viewer.scene.postProcessStages.fxaa.enabled = profile.fxaa;
          viewer.scene.globe.maximumScreenSpaceError = tier === 'high' ? (cores >= 8 ? 0.65 : 1.1) : tier === 'balanced' ? 1.25 : 1.8;
          viewer.scene.globe.tileCacheSize = tier === 'high' ? (cores >= 8 ? 1200 : 700) : tier === 'balanced' ? 550 : 350;
          viewer.resolutionScale = baseScale * profile.resolutionScale;
        };
        const tick = () => {
          if (cancelled || destroyedRef.current || viewer.isDestroyed()) return;
          const frameNow = performance.now();
          const frameMs = frameNow - lastFrameMs;
          lastFrameMs = frameNow;
          runtimeFrameMonitorRef.current.record(frameMs, adaptiveQualityRef.current.getProfile().frameBudgetMs);
          const previousQuality = adaptiveQualityRef.current.getTier();
          const nextQuality = adaptiveQualityRef.current.update(frameMs);
          if (nextQuality !== previousQuality) {
            applyQuality(nextQuality);
            setRenderQualityTier(nextQuality);
          }
          const target = cameraTargetRef.current;
          if (target) {
            const current = cameraCurrentRef.current ?? {
              location: target.location,
              bearing: target.bearing,
            };
            const t = 0.085;
            current.location = {
              lat: lerp(current.location.lat, target.location.lat, t),
              lng: lerp(current.location.lng, target.location.lng, t),
            };
            current.bearing = lerpAngle(current.bearing, target.bearing, t);
            cameraCurrentRef.current = current;

            // Driver-perspective camera: keep the vehicle near the lower third
            // of the frame and look farther ahead as speed rises. This is the
            // actual immersive turn view, rather than a top-down 3D map.
            const liveRemaining = remainingMetersRef.current ?? 42;
            const speedHint = Math.max(0, Math.min(28, liveRemaining / 2));
            const lookAheadMeters = Math.max(38, Math.min(78, 44 + speedHint));
            const lookAhead = destinationPoint(current.location, current.bearing, lookAheadMeters);
            const cameraSpot = destinationPoint(current.location, (current.bearing + 180) % 360, 3.2);
            const position = Cesium.Cartesian3.fromDegrees(cameraSpot.lng, cameraSpot.lat, 2.05);
            const targetPosition = Cesium.Cartesian3.fromDegrees(lookAhead.lng, lookAhead.lat, 2.35);
            const direction = Cesium.Cartesian3.normalize(
              Cesium.Cartesian3.subtract(targetPosition, position, new Cesium.Cartesian3()),
              new Cesium.Cartesian3()
            );
            const up = Cesium.Cartesian3.normalize(position, new Cesium.Cartesian3());
            viewer.camera.setView({ destination: position, orientation: { direction, up } });

            // A lightweight vehicle marker makes the 3D scene read as a
            // navigation experience: the driver can see where the car is
            // relative to the physical lane geometry and highlighted turn.
            const vehicle = vehicleEntityRef.current;
            if (vehicle) {
              const vehiclePosition = Cesium.Cartesian3.fromDegrees(current.location.lng, current.location.lat, 0.72);
              vehicle.position = vehiclePosition;
              vehicleHeadingRef.current = lerpAngle(vehicleHeadingRef.current, current.bearing, 0.14);
              vehicle.orientation = Cesium.Transforms.headingPitchRollQuaternion(
                vehiclePosition,
                new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(vehicleHeadingRef.current), 0, 0)
              );
            }
            animateTrafficVehicles(Cesium, viewer, trafficVehicleEntitiesRef, trafficInterpolatorRef.current, performance.timeOrigin + performance.now());
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (error) {
        console.error('Immersive turn view failed to initialize:', error);
      }
    };

    start();

    return () => {
      cancelled = true;
      destroyedRef.current = true;
      sceneGenerationRef.current += 1;
      sceneLifecycleRef.current.dispose();
      sceneBubbleStreamerRef.current?.reset();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      runtimeFrameMonitorRef.current.reset();
      rafRef.current = null;
      vehicleEntityRef.current = null;
      trafficInterpolatorRef.current.clear();
      if (viewerRef.current) {
        trafficVehicleEntitiesRef.current.clear();
        sceneChunkPrimitivesRef.current.clear();
        sceneChunkEntitiesRef.current.clear();
        scenePrimitivePoolRef.current.clear();
        sceneChunkRetireAtRef.current.clear();
        sceneResidencyRef.current.clear();
        sceneReacquisitionLocationRef.current = null;
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewer || !Cesium || !route) return;
    const generation = ++sceneGenerationRef.current;
    const routeGeneration = navigationSnapshot?.routeGeneration ?? 0;
    if (routeGeneration !== routeGenerationRef.current) {
      routeGenerationRef.current = routeGeneration;
      sceneLifecycleRef.current.invalidate();
    }
    sceneLifecycleRef.current.begin();
    void renderScene(Cesium, viewer, route, maneuver, sceneCacheRef.current, sceneKeyRef, hasInitialCameraRef, staticPrimitiveRef, generation, sceneGenerationRef, onSceneContext, currentLaneIndex, currentLaneConfidence, destinationLabel, laneExecution, userLocation, speedMps, liveTrafficVehicles, trafficVehicleEntitiesRef, sceneContext ?? dynamicSceneContext, scenePlanRef, guidanceEntitiesRef, vehicleEntityRef, sceneChunkPrimitivesRef, sceneChunkEntitiesRef, adaptiveQualityRef.current.getTier(), billboards, guidanceSmootherRef, sceneFetchedAtRef, sceneResidencyRef, scenePrimitivePoolRef, sceneLifecycleRef, sceneReacquisitionLocationRef, sceneChunkRetireAtRef, cameraTargetRef, immersiveNavigationState, navigationSnapshot, remainingMeters);
  }, [route, maneuver, currentLaneIndex, currentLaneConfidence, destinationLabel, laneExecution, sceneContext, dynamicSceneContext, renderQualityTier, billboards, navigationSnapshot?.routeGeneration, immersiveNavigationState?.overallConfidence]);

  useEffect(() => {
    if (!route || !userLocation) return;
    const legacyPlan = buildRouteScenePrefetchPlan(route, userLocation, route.maneuvers ?? [], { horizonMeters: 1100, maxLocations: 8, spacingMeters: 220 });
    const predictivePlan = buildPredictiveScenePrefetchPlan(route, userLocation, speedMps ?? 0, route.maneuvers ?? [], [], renderQualityTier);
    const locations = [...predictivePlan.targets.map((target) => target.location), ...legacyPlan.locations]
      .filter((location, index, all) => all.findIndex((other) => Math.abs(other.lat - location.lat) < 0.00025 && Math.abs(other.lng - location.lng) < 0.00025) === index)
      .slice(0, renderQualityTier === 'high' ? 8 : renderQualityTier === 'balanced' ? 6 : 4);
    if (locations.length) {
      // Predictive targets lead the warm set; the older route-ahead planner
      // remains as a broad safety net for sparse route geometry.
      void Promise.resolve().then(async () => {
        const { prefetchSceneContext } = await import('../services/api');
        prefetchSceneContext(locations, 220);
      });
    }
  }, [route, userLocation, speedMps, renderQualityTier]);

  useEffect(() => {
    if (!userLocation) return;
    let cancelled = false;
    const streamer = sceneBubbleStreamerRef.current!;
    void streamer.ensure(userLocation, async (location, radiusMeters) => {
      const scene = await getSceneContext(location, radiusMeters);
      if (!cancelled) return scene;
      return scene;
    }).then((scene) => {
      if (cancelled || !scene) return;
      sceneContextFromCallbackRef.current = scene;
      setDynamicSceneContext(scene);
    }).catch((error) => {
      if (!cancelled) console.warn('Dynamic scene bubble unavailable:', error);
    });
    return () => { cancelled = true; };
  }, [userLocation]);

  // Vehicle telemetry is a high-frequency stream and must not rebuild the
  // static Cesium corridor. Keep it on its own synchronization path so a
  // provider update can move/remove traffic immediately without touching
  // buildings, lane geometry, or the navigation camera.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;
    syncTrafficVehicles(
      Cesium,
      viewer,
      userLocation,
      sceneContextFromCallbackRef.current ?? sceneContext,
      liveTrafficVehicles,
      trafficVehicleEntitiesRef,
      trafficInterpolatorRef.current,
      cameraTargetRef.current?.bearing ?? null,
      currentLaneIndex,
      maneuver?.location ?? null,
      immersiveNavigationState?.trafficReady ? adaptiveQualityRef.current.getProfile().maxTrafficVehicles : 0,
    );
  }, [liveTrafficVehicles, userLocation, sceneContext, currentLaneIndex, maneuver]);

  useEffect(() => {
    if (!userLocation || !maneuver) return;
    // Point the camera along the route rather than directly at the turn. On
    // curving roads this avoids the unnatural sideways-looking camera that a
    // straight-line bearing to the maneuver can create.
    let bearing = bearingDegrees(userLocation, maneuver.location);
    const routeCoords = route?.segments.flatMap((segment) => segment.coords) ?? [];
    let nearest = 0;
    if (routeCoords.length >= 2) {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < routeCoords.length; i += 1) {
        const d = Math.hypot(routeCoords[i].lat - userLocation.lat, routeCoords[i].lng - userLocation.lng);
        if (d < best) { best = d; nearest = i; }
      }
      const lookIndex = Math.min(routeCoords.length - 1, nearest + 8);
      bearing = bearingDegrees(routeCoords[nearest], routeCoords[lookIndex]);
    }
    remainingMetersRef.current = remainingMeters;
    // As the vehicle enters the final approach, gradually look through the
    // junction toward the exit instead of keeping the camera locked to the
    // approach bearing. Farther out, preserve the road-following heading.
    if (routeCoords.length >= 2 && maneuver) {
      const maneuverBearing = bearingDegrees(maneuver.location, routeCoords[Math.min(routeCoords.length - 1, nearest + 10)] ?? maneuver.location);
      const proximity = Math.max(0, Math.min(1, 1 - ((remainingMeters ?? 120) - 18) / 90));
      const delta = ((maneuverBearing - bearing + 540) % 360) - 180;
      bearing = (bearing + delta * proximity + 360) % 360;
    }
    cameraTargetRef.current = { location: userLocation, bearing };
    if (!cameraCurrentRef.current) cameraCurrentRef.current = { location: userLocation, bearing };
  }, [userLocation, maneuver, route, remainingMeters]);

  const durationMinutes = route?.duration_seconds != null ? Math.max(1, Math.round(route.duration_seconds / 60)) : null;
  const distanceMiles = route?.distance_meters != null ? (route.distance_meters / 1609.344).toFixed(1) : null;
  const arrival = durationMinutes != null
    ? new Date(Date.now() + durationMinutes * 60_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  const laneArrows = (maneuver?.lanes ?? []).slice(0, 5).map((lane) => {
    const indication = lane.indications?.[0] ?? 'straight';
    return LANE_ARROW[indication] ?? '↑';
  });
  const fallbackArrows = maneuver?.modifier?.includes('left')
    ? ['↑', '↑', '↖', '←', '↙']
    : maneuver?.modifier?.includes('right')
      ? ['↑', '↑', '↗', '→', '↘']
      : ['↑', '↑', '↑', '↑', '↑'];
  const arrows = laneArrows.length > 0 ? laneArrows : fallbackArrows;
  const highlightIndex = currentLaneIndex != null ? Math.min(arrows.length - 1, Math.max(0, currentLaneIndex)) : (arrows.length > 0 ? Math.min(arrows.length - 1, Math.max(0, arrows.length - 2)) : 0);
  const instruction = maneuver?.instruction ?? 'Follow the route';
  const exitMatch = instruction.match(/\b(?:exit|junction|ramp)\s+([A-Za-z0-9-]+)/i);
  const junctionGuidance = deriveJunctionGuidanceState(
    navigationSnapshot?.spatialIntelligence.intersectionIntelligence,
    navigationSnapshot?.spatialIntelligence.laneIntelligence,
    navigationSnapshot?.spatialIntelligence.maneuverDistanceMeters ?? remainingMeters,
  );

  return (
    <div className="immersive-turn-view">
      <div ref={containerRef} className="immersive-cesium" />
      <div className="immersive-vignette" />
      <div className="immersive-road-horizon" />

      <section className="immersive-top-card" aria-label="Upcoming maneuver">
        <div className="immersive-lane-strip">
          {arrows.map((arrow, index) => (
            <span key={`${arrow}-${index}`} className={`immersive-lane-arrow ${index === highlightIndex ? 'is-active' : ''}`}>
              {arrow}
            </span>
          ))}
        </div>
        <div className="immersive-maneuver-row">
          <div>
            <div className="immersive-distance">{remainingMeters !== null ? `${Math.max(0, Math.round(remainingMeters))} m` : 'Upcoming'}</div>
            <div className="immersive-instruction">{instruction}</div>
            <div className="immersive-subtitle">{maneuver?.lanes?.length ? `${maneuver.lanes.length}-lane approach · predictive turn preview` : 'Predictive turn preview'}{currentLaneIndex != null ? ` · You are in lane ${currentLaneIndex + 1}` : ''}{laneExecution?.phase === 'changing' ? ' · Changing lane' : laneExecution?.phase === 'completed' ? ' · Lane change complete' : laneExecution?.phase === 'missed' ? ' · Lane change missed' : ''}</div>
            {junctionGuidance.label && <div className={`immersive-junction-state is-${junctionGuidance.urgency}`}>
              <strong>{junctionGuidance.label}</strong>
              {junctionGuidance.detail && <span>{junctionGuidance.detail}</span>}
            </div>}
          </div>
          {exitMatch && <div className="immersive-exit-badge">Exit {exitMatch[1]}</div>}
        </div>
      </section>

      <div className="immersive-side-controls" aria-hidden="true">
        <button type="button">🔊</button>
        <button type="button">⌖</button>
        <button type="button">＋</button>
      </div>

      <div className="immersive-route-label">{maneuver?.instruction?.split(' ').slice(-3).join(' ') || 'STREEPT ROUTE'}</div>

      <section className="immersive-bottom-card" aria-label="Trip summary">
        <div className="immersive-trip-stat">
          <strong>{arrival ?? '--:--'}</strong>
          <span>arrival</span>
        </div>
        <div className="immersive-trip-stat">
          <strong>{durationMinutes ?? '--'}</strong>
          <span>min</span>
        </div>
        <div className="immersive-trip-stat">
          <strong>{distanceMiles ?? '--'}</strong>
          <span>mi</span>
        </div>
        <button className="immersive-collapse-button" type="button" aria-label="Collapse trip summary">⌃</button>
      </section>

      <div className="immersive-free-badge">Aerial imagery + OpenStreetMap 3D · no Streept API key</div>
    </div>
  );
};

const LANE_ARROW: Record<string, string> = {
  left: '←', right: '→', straight: '↑', through: '↑',
  'slight left': '↖', 'slight right': '↗',
  'sharp left': '↙', 'sharp right': '↘', uturn: '↩',
};

async function renderScene(
  Cesium: CesiumLike,
  viewer: CesiumLike,
  route: Route3DHighlight | null,
  maneuver: Maneuver | null,
  cache: Map<string, SceneData>,
  sceneKeyRef: React.MutableRefObject<string>,
  hasInitialCameraRef: React.MutableRefObject<boolean>,
  staticPrimitiveRef: React.MutableRefObject<any>,
  generation: number,
  generationRef: React.MutableRefObject<number>,
  onSceneContext?: (scene: SceneContext) => void,
  currentLaneIndex: number | null = null,
  currentLaneConfidence = 0,
  destinationLabel: string | null = null,
  laneExecution: LaneChangeExecutionState | null = null,
  userLocation: Location | null = null,
  speedMps: number | null = 0,
  liveTrafficVehicles: TrafficVehicle[] = [],
  trafficVehicleEntitiesRef: React.MutableRefObject<Map<string, any>> | null = null,
  providedSceneContext: SceneContext | null = null,
  scenePlanRef: React.MutableRefObject<string> | null = null,
  guidanceEntitiesRef: React.MutableRefObject<Set<any>> | null = null,
  vehicleEntityRef: React.MutableRefObject<any> | null = null,
  sceneChunkPrimitivesRef: React.MutableRefObject<Map<string, any>> | null = null,
  sceneChunkEntitiesRef: React.MutableRefObject<Map<string, Set<any>>> | null = null,
  renderQualityTier: RenderQualityTier = 'high',
  billboards: Billboard[] = [],
  guidanceSmootherRef: React.MutableRefObject<GuidanceTransitionSmoother> | null = null,
  sceneFreshnessRef: React.MutableRefObject<SceneFreshnessTracker> | null = null,
  sceneResidencyRef: React.MutableRefObject<SceneResidencyManager> | null = null,
  scenePrimitivePoolRef: React.MutableRefObject<ScenePrimitivePool<any>> | null = null,
  sceneLifecycleRef: React.MutableRefObject<SceneLifecycleGuard> | null = null,
  sceneReacquisitionLocationRef: React.MutableRefObject<Location | null> | null = null,
  sceneChunkRetireAtRef: React.MutableRefObject<Map<string, number>> | null = null,
  cameraTargetRef: React.MutableRefObject<{ location: Location; bearing: number } | null> | null = null,
  immersiveNavigationState: ImmersiveNavigationState | null = null,
  navigationSnapshot: NavigationEngineSnapshot | null = null,
  remainingMeters: number | null = null,
) {
  if (!route || viewer.isDestroyed() || generation !== generationRef.current) return;
  const lifecycleToken = sceneLifecycleRef?.current.begin() ?? null;
  const isCurrent = () => lifecycleToken == null || sceneLifecycleRef!.current.isCurrent(lifecycleToken);
  const coords = route.segments.flatMap((segment) => segment.coords);
  if (coords.length < 2) return;

  const routeKey = coords.filter((_, i) => i % Math.max(1, Math.floor(coords.length / 12)) === 0).map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`).join('|');
  const sceneKey = maneuver
    ? `corridor:${maneuver.location.lat.toFixed(4)},${maneuver.location.lng.toFixed(4)}:${maneuver.type}:${maneuver.modifier ?? ''}`
    : `route:${routeKey}`;
  const scenePlan = buildSceneRenderPlan(providedSceneContext, maneuver?.location ?? coords[0]);
  const sceneFreshness = maneuver && sceneFreshnessRef ? sceneFreshnessRef.current.getPlan(sceneKey) : null;
  const billboardSafety = assessBillboardSafety({ distanceToManeuverMeters: navigationSnapshot?.spatialIntelligence.maneuverDistanceMeters ?? remainingMeters, maneuverCritical: Boolean(navigationSnapshot?.spatialPriorities?.some((p: { priority?: string }) => p.priority === 'critical-navigation')), speedMps: speedMps ?? 0 });
  const sceneAgeMs = sceneFreshness?.ageMs ?? null;
  const chunks = splitSceneIntoChunks(providedSceneContext, maneuver?.location ?? coords[0]);
  const billboardKey = (billboardSafety.allowed ? billboards : []).map((billboard) => `${billboard.id}:${billboard.ad_image_url ?? ''}:${billboard.display_end ?? ''}:${billboard.is_purchased ? 'live' : 'empty'}`).sort().join('|');
  const freshnessState = sceneFreshness?.state ?? 'unknown';
  const lifecycleKey = `${sceneKey}|scene:${scenePlan.key}|freshness:${freshnessState}|chunks:${sceneChunkPlanKey(chunks)}|billboards:${billboardKey}`;
  if (sceneKeyRef.current === lifecycleKey && viewer.scene.primitives.contains?.(staticPrimitiveRef.current)) return;
  sceneKeyRef.current = lifecycleKey;
  const oldStaticPrimitives = staticPrimitiveRef.current;
  if (scenePlanRef) scenePlanRef.current = scenePlan.key;
  if (vehicleEntityRef && !vehicleEntityRef.current) vehicleEntityRef.current = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(coords[0].lng, coords[0].lat, 0.72),
    orientation: Cesium.Transforms.headingPitchRollQuaternion(
      Cesium.Cartesian3.fromDegrees(coords[0].lng, coords[0].lat, 0.72),
      new Cesium.HeadingPitchRoll(0, 0, 0)
    ),
    cylinder: {
      length: 2.7, topRadius: 0.48, bottomRadius: 0.62,
      material: Cesium.Color.fromCssColorString('#2d7ff9'),
      outline: true, outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
    },
    point: { pixelSize: 8, color: Cesium.Color.WHITE, outlineColor: Cesium.Color.fromCssColorString('#2d7ff9'), outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
  });
  // All generated static geometry for the current maneuver lives inside one
  // primitive collection. This prevents stale road/building primitives from
  // accumulating every time GPS advances to a new maneuver.
  const scenePrimitives = new Cesium.PrimitiveCollection();

  let scene: SceneData | null = maneuver ? cache.get(sceneKey) ?? null : null;
  if (maneuver && sceneFreshness?.state === 'stale') {
    scene = null;
    cache.delete(sceneKey);
  }
  if (maneuver && providedSceneContext && sceneFreshnessRef) sceneFreshnessRef.current.markIfMissing(sceneKey);
  if (!scene && providedSceneContext) scene = budgetSceneContext(providedSceneContext, maneuver?.location ?? coords[0]);
  const qualityProfile = { high: 1, balanced: 1.25, performance: 1.7 }[renderQualityTier];
  const detailStride = Math.max(1, Math.ceil(routeRenderStride(coords.length, Boolean(maneuver?.is_complex)) * qualityProfile));
  addRoadCorridor(Cesium, coords, scenePrimitives, detailStride);
  // Driver-first hierarchy: the immediate route lane is rendered as a subtle
  // physical surface before buildings/signage, so the road itself answers
  // the driver's primary question: where should I be driving?
  if (maneuver) {
    addDriverFirstRoadGeometry(Cesium, route, maneuver, scenePrimitives, scene, destinationLabel, currentLaneIndex, currentLaneConfidence, laneExecution, userLocation, speedMps, sceneAgeMs, guidanceSmootherRef, navigationSnapshot);
    addRouteAheadContinuity(Cesium, route, maneuver, scenePrimitives, userLocation);
  }

  if (maneuver) {
    try {
      if (!scene) {
        scene = await fetchOsmContext(maneuver.location.lat, maneuver.location.lng);
        scene = budgetSceneContext(scene, maneuver.location);
        cache.set(sceneKey, scene);
        sceneFreshnessRef?.current.markFetched(sceneKey);
        onSceneContext?.(scene);
      }
      onSceneContext?.(scene);
      if (viewer.isDestroyed()) return;
      // Render OSM context as independently reusable spatial chunks. Existing
      // chunks stay attached to Cesium while only entering/leaving chunks are
      // built or retired.
      const allChunks = splitSceneIntoChunks(scene, maneuver.location);
      const center = userLocation ?? maneuver.location;
      const chunkPrimitives = sceneChunkPrimitivesRef?.current ?? new Map<string, any>();
      const chunkEntities = sceneChunkEntitiesRef?.current ?? new Map<string, Set<any>>();
      const previousCenter = sceneReacquisitionLocationRef?.current ?? null;
      const existingKeys = new Set(chunkPrimitives.keys());
      const staleKeys = sceneFreshness?.state === 'stale' ? new Set(existingKeys) : new Set<string>();
      const predictivePlan = buildPredictiveScenePrefetchPlan(route, center, speedMps ?? 0, route.maneuvers ?? [], allChunks, renderQualityTier);
      const reacquisition = buildSceneReacquisitionPlan(allChunks, center, previousCenter, existingKeys, staleKeys, renderQualityTier, predictivePlan.orderedChunkKeys);
      const chunkByKey = new Map(allChunks.map((chunk) => [chunk.key, chunk]));
      const activePrimaryKey = reacquisition.primaryKey;
      const residency = sceneResidencyRef?.current.plan(
        allChunks,
        center,
        existingKeys,
        predictivePlan.orderedChunkKeys,
        [activePrimaryKey, ...reacquisition.desiredKeys.slice(0, 2)].filter(Boolean) as string[],
        renderQualityTier,
      );
      // Residency is the final memory/GC gate: anything outside the bounded
      // set is explicitly retired before more Cesium primitives are created.
      for (const key of residency?.evictKeys ?? []) {
        const primitive = chunkPrimitives.get(key);
        if (primitive) { try { viewer.scene.primitives.remove(primitive); } catch {} scenePrimitivePoolRef?.current.release(primitive); }
        for (const entity of chunkEntities.get(key) ?? []) viewer.entities.remove(entity);
        chunkEntities.delete(key);
        chunkPrimitives.delete(key);
        sceneChunkRetireAtRef?.current.delete(key);
      }
      const residencyKeys = new Set(residency?.keepKeys ?? reacquisition.renderKeys);

      // Stale bubbles are discarded before their replacement is built, while
      // non-stale bubbles outside the desired set remain available during the
      // short movement-aware handoff window.
      for (const key of staleKeys) {
        const primitive = chunkPrimitives.get(key);
        if (!primitive) continue;
        try { viewer.scene.primitives.remove(primitive); } catch {}
        scenePrimitivePoolRef?.current.release(primitive);
        for (const entity of chunkEntities.get(key) ?? []) viewer.entities.remove(entity);
        chunkEntities.delete(key);
        chunkPrimitives.delete(key);
        sceneChunkRetireAtRef?.current.delete(key);
      }

      for (const key of reacquisition.renderKeys.filter((key) => residencyKeys.has(key))) {
        const chunk = chunkByKey.get(key);
        if (!chunk) continue;
        let primitive = chunkPrimitives.get(key);
        if (!primitive) {
          primitive = scenePrimitivePoolRef?.current.acquire(() => new Cesium.PrimitiveCollection()) ?? new Cesium.PrimitiveCollection();
          const entities = new Set<any>();
          addOsmContext(Cesium, viewer, chunk.scene, primitive, chunk.center, entities, cameraTargetRef?.current?.bearing ?? null, center, sceneLodPolicyForQuality(renderQualityTier), key === activePrimaryKey ? billboards : [], immersiveNavigationState?.composition ?? immersiveNavigationState?.composition ?? buildSceneCompositionForContext(route, maneuver, currentLaneIndex, currentLaneConfidence, userLocation, chunk.scene, sceneAgeMs));
          chunkEntities.set(key, entities);
          viewer.scene.primitives.add(primitive);
          chunkPrimitives.set(key, primitive);
        }
        if (reacquisition.desiredKeys.includes(key)) {
          sceneChunkRetireAtRef?.current.delete(key);
        } else if (!sceneChunkRetireAtRef?.current.has(key)) {
          sceneChunkRetireAtRef?.current.set(key, Date.now() + reacquisition.handoffDurationMs);
        }
      }

      // Retire handoff bubbles only after their overlap window has elapsed.
      // This turns chunk boundaries into a warm handoff rather than a hard swap.
      const now = Date.now();
      for (const [key, retireAt] of [...(sceneChunkRetireAtRef?.current ?? new Map())]) {
        if (reacquisition.renderKeys.includes(key) && residencyKeys.has(key) && now < retireAt) continue;
        if (reacquisition.desiredKeys.includes(key)) { sceneChunkRetireAtRef?.current.delete(key); continue; }
        const primitive = chunkPrimitives.get(key);
        if (primitive) { try { viewer.scene.primitives.remove(primitive); } catch {} scenePrimitivePoolRef?.current.release(primitive); }
        for (const entity of chunkEntities.get(key) ?? []) viewer.entities.remove(entity);
        chunkEntities.delete(key);
        chunkPrimitives.delete(key);
        sceneChunkRetireAtRef?.current.delete(key);
      }
      if (sceneReacquisitionLocationRef) sceneReacquisitionLocationRef.current = center;
    } catch (error) {
      console.warn('OSM context unavailable; keeping generated road scene.', error);
      if (generation !== generationRef.current || !isCurrent() || viewer.isDestroyed()) return;
      addProceduralContext(Cesium, viewer, coords, maneuver, scenePrimitives);
    }
  }

  // Keep the previous guidance visible while the replacement scene is being
  // fetched/built. Retire it only once the new static scene is ready.
  if (guidanceEntitiesRef) {
    for (const entity of guidanceEntitiesRef.current) viewer.entities.remove(entity);
    guidanceEntitiesRef.current.clear();
  }
  // Always paint navigation guidance last so the route remains visually
  // dominant over the reconstructed road network.
  if (generation !== generationRef.current || !isCurrent() || viewer.isDestroyed()) return;
  addRouteLine(Cesium, viewer, coords, scenePrimitives);
  if (maneuver) {
    addLaneGuidanceGeometry(Cesium, route, maneuver, scenePrimitives, scene ?? undefined, destinationLabel, currentLaneIndex, currentLaneConfidence, laneExecution, guidanceSmootherRef, userLocation, sceneAgeMs);
    addTurnGuidance(Cesium, viewer, maneuver, coords, scenePrimitives, scene ?? undefined);
  }
  if (guidanceEntitiesRef) {
    // Record only entities created by this render. They can be retired on the
    // next scene swap without disturbing the persistent driver/traffic layer.
    for (const entity of viewer.entities.values) {
      if (entity !== vehicleEntityRef?.current && ![...((trafficVehicleEntitiesRef?.current ?? new Map()).values())].includes(entity)) {
        guidanceEntitiesRef.current.add(entity);
      }
    }
  }

  if (generation !== generationRef.current || viewer.isDestroyed()) {
    try { viewer.scene.primitives.remove(scenePrimitives); } catch {}
    return;
  }
  // Atomic static-scene swap: the old bubble remains visible while the new
  // bubble is fetched and constructed, then is retired only after the new
  // primitive collection is ready. Camera, driver and telemetry entities stay.
  if (oldStaticPrimitives) {
    try { viewer.scene.primitives.remove(oldStaticPrimitives); } catch {}
  }
  viewer.scene.primitives.add(scenePrimitives);
  staticPrimitiveRef.current = scenePrimitives;

  // Give the first render a useful establishing shot. The live camera loop
  // will smoothly take over as soon as a GPS target exists.
  if (!hasInitialCameraRef.current) {
    const first = coords[0];
    const second = coords[Math.min(4, coords.length - 1)];
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(first.lng, first.lat, 12),
      orientation: { heading: Cesium.Math.toRadians(bearingDegrees(first, second)), pitch: Cesium.Math.toRadians(-4), roll: 0 },
      duration: 0.5,
    });
    hasInitialCameraRef.current = true;
  }
  if (trafficVehicleEntitiesRef) syncTrafficVehicles(Cesium, viewer, userLocation, scene, liveTrafficVehicles, trafficVehicleEntitiesRef);
}

function syncTrafficVehicles(
  Cesium: CesiumLike,
  viewer: CesiumLike,
  userLocation: Location | null,
  scene: SceneContext | null,
  vehicles: TrafficVehicle[],
  entitiesRef: React.MutableRefObject<Map<string, any>>,
  interpolator: TrafficInterpolator | null = null,
  userHeadingDegrees: number | null = null,
  currentLaneIndex: number | null = null,
  maneuverLocation: Location | null = null,
  maxVehicles = 100,
) {
  if (!userLocation || viewer.isDestroyed()) return;
  const candidates = buildLiveTraffic3D(vehicles, userLocation, scene, { maxDistanceMeters: 350, maxVehicles: 120 });
  const prioritized = prioritizeTrafficCandidates(candidates, { userLocation, userHeadingDegrees, currentLaneIndex, maneuverLocation }, maxVehicles);
  const activeIds = new Set(prioritized.map((candidate) => candidate.id));
  interpolator?.removeMissing(activeIds);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  for (const candidate of prioritized) {
    const vehicle = vehicleById.get(candidate.id);
    if (vehicle) interpolator?.update(vehicle, candidate.location, candidate.headingDegrees, candidate.laneSnapped, Date.now());
  }
  const wanted = activeIds;
  for (const [id, entity] of entitiesRef.current) {
    if (!wanted.has(id)) {
      viewer.entities.remove(entity);
      entitiesRef.current.delete(id);
    }
  }
  for (const candidate of candidates) {
    const position = Cesium.Cartesian3.fromDegrees(candidate.location.lng, candidate.location.lat, 1.35);
    const rotation = Cesium.Math.toRadians(-candidate.headingDegrees);
    let entity = entitiesRef.current.get(candidate.id);
    if (!entity) {
      entity = viewer.entities.add({
        id: `traffic-${candidate.id}`,
        position,
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString('#ffb300').withAlpha(Math.max(0.55, candidate.confidence)),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
          outlineWidth: 2,
          disableDepthTestDistance: 80,
        },
      });
      entitiesRef.current.set(candidate.id, entity);
    } else {
      entity.position = position;
      entity.point.pixelSize = 10;
      entity.point.color = Cesium.Color.fromCssColorString('#ffb300').withAlpha(Math.max(0.55, candidate.confidence));
    }
    entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(rotation, 0, 0),
    );
  }
}

function animateTrafficVehicles(
  Cesium: CesiumLike,
  viewer: CesiumLike,
  entitiesRef: React.MutableRefObject<Map<string, any>>,
  interpolator: TrafficInterpolator,
  nowMs: number,
) {
  if (viewer.isDestroyed()) return;
  for (const [id, entity] of entitiesRef.current) {
    const sample = interpolator.sample(id, nowMs);
    if (!sample) continue;
    const position = Cesium.Cartesian3.fromDegrees(sample.location.lng, sample.location.lat, 1.35);
    entity.position = position;
    entity.point.color = Cesium.Color.fromCssColorString('#ffb300').withAlpha(Math.max(0.35, sample.confidence));
    entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(-sample.headingDegrees), 0, 0),
    );
  }
}

function addRouteLine(Cesium: CesiumLike, viewer: CesiumLike, coords: RouteCoord[], _primitives: any) {
  viewer.entities.add({
    polyline: {
      positions: coords.map((c) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 0.45)),
      width: 7,
      clampToGround: true,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.16,
        color: Cesium.Color.fromCssColorString('#20F28A'),
      }),
    },
  });
}

function addRoadCorridor(Cesium: CesiumLike, coords: RouteCoord[], primitives: any, detailStride = 1) {
  const roadInstances: any[] = [];
  const vergeInstances: any[] = [];
  const laneInstances: any[] = [];
  const edgeInstances: any[] = [];
  const stride = Math.max(detailStride, Math.floor(coords.length / 120));

  for (let i = 0; i < coords.length - stride; i += stride) {
    const a = coords[i];
    const b = coords[Math.min(i + stride, coords.length - 1)];
    const bearing = bearingDegrees(a, b);
    const left = destinationPoint(a, (bearing + 90) % 360, 7.5);
    const right = destinationPoint(a, (bearing + 270) % 360, 7.5);
    const left2 = destinationPoint(b, (bearing + 90) % 360, 7.5);
    const right2 = destinationPoint(b, (bearing + 270) % 360, 7.5);

    vergeInstances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([
          left.lng, left.lat, right.lng, right.lat, right2.lng, right2.lat, left2.lng, left2.lat,
        ])),
        height: -0.03,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#79ad61').withAlpha(0.95)) },
    }));

    const roadLeft = destinationPoint(a, (bearing + 90) % 360, 5.4);
    const roadRight = destinationPoint(a, (bearing + 270) % 360, 5.4);
    const roadLeft2 = destinationPoint(b, (bearing + 90) % 360, 5.4);
    const roadRight2 = destinationPoint(b, (bearing + 270) % 360, 5.4);
    roadInstances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray([
          roadLeft.lng, roadLeft.lat, roadRight.lng, roadRight.lat, roadRight2.lng, roadRight2.lat, roadLeft2.lng, roadLeft2.lat,
        ])),
        height: 0.01,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#30363c')) },
    }));

    const centerA = Cesium.Cartesian3.fromDegrees(a.lng, a.lat, 0.16);
    const centerB = Cesium.Cartesian3.fromDegrees(b.lng, b.lat, 0.16);
    laneInstances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({ positions: [centerA, centerB], width: 1.45, vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE.withAlpha(0.8)) },
    }));

    if (i % (stride * 2) === 0) {
      for (const side of [1, -1]) {
        const edgeA = destinationPoint(a, (bearing + (side === 1 ? 90 : 270)) % 360, 4.95);
        const edgeB = destinationPoint(b, (bearing + (side === 1 ? 90 : 270)) % 360, 4.95);
        edgeInstances.push(new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({
            positions: [Cesium.Cartesian3.fromDegrees(edgeA.lng, edgeA.lat, 0.18), Cesium.Cartesian3.fromDegrees(edgeB.lng, edgeB.lat, 0.18)],
            width: 1.1,
            vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
          }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#f3d35d').withAlpha(0.86)) },
        }));
      }
    }
  }

  if (vergeInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: vergeInstances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
  if (roadInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: roadInstances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false, closed: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
  if (laneInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: laneInstances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
  if (edgeInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: edgeInstances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
}


function addRouteAheadContinuity(
  Cesium: CesiumLike,
  route: Route3DHighlight,
  maneuver: Maneuver,
  primitives: any,
  userLocation: Location | null,
) {
  const plan = buildRouteAheadContinuityPlan(route, maneuver, userLocation ? { ...userLocation, alt: 0 } : null);
  const choreography = buildMultiManeuverChoreography(route, maneuver, userLocation ? { ...userLocation, alt: 0 } : null);
  if (!plan || !choreography?.next) return;
  const coords = route.segments.flatMap((segment) => segment.coords);
  const choreographedStart = choreography.nextApproachStartIndex ?? plan.startIndex;
  const choreographedEnd = choreography.nextApproachEndIndex ?? plan.endIndex;
  const startIndex = Math.max(plan.startIndex, choreographedStart);
  const endIndex = Math.min(plan.endIndex, choreographedEnd);
  if (endIndex <= startIndex + 1) return;
  const choreographedPlan = { ...plan, startIndex, endIndex, emphasis: Math.min(plan.emphasis, choreography.next.strength) };
  const laneCount = Math.max(1, maneuver.lanes?.length ?? 1);
  const recommended = maneuver.lanes?.findIndex((lane) => lane.recommended) ?? -1;
  const laneIndex = recommended >= 0 ? recommended : Math.floor(laneCount / 2);
  const polygon = continuityLanePolygon(coords, choreographedPlan, laneIndex, laneCount, Math.min(10, Math.max(6, laneCount * 3.3)));
  if (polygon.length < 4) return;

  const positions = polygon.map((point, index) => {
    const t = index / Math.max(1, polygon.length - 1);
    return Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.16 + t * 0.04);
  });
  primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(positions),
        height: 0.16,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          Cesium.Color.fromCssColorString('#2d7ff9').withAlpha(choreographedPlan.emphasis),
        ),
      },
    }),
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
    asynchronous: true,
    releaseGeometryInstances: true,
  }));
}

function addDriverFirstRoadGeometry(
  Cesium: CesiumLike,
  route: Route3DHighlight,
  maneuver: Maneuver,
  primitives: any,
  scene: SceneData | null,
  destinationLabel: string | null | undefined,
  currentLaneIndex: number | null,
  currentLaneConfidence: number,
  laneExecution: LaneChangeExecutionState | null,
  userLocation: Location | null,
  speedMps: number | null = 0,
  sceneAgeMs: number | null = null,
  guidanceSmootherRef: React.MutableRefObject<GuidanceTransitionSmoother> | null = null,
  navigationSnapshot: NavigationEngineSnapshot | null = null,
) {
  const coords = route.segments.flatMap((segment) => segment.coords);
  if (coords.length < 2) return;
  const plan = buildSceneGuidancePlan(route, maneuver, currentLaneIndex, currentLaneConfidence || 1, scene);
  if (!plan) return;
  const confidence = buildSceneConfidence(plan, currentLaneConfidence, userLocation, route, scene ?? null);
  const recovery = buildSceneRecoveryPlan({ confidence, sceneAgeMs });
  const physicalConnectorAvailable = plan.connectorTopology.connectors.some((candidate) => candidate.points.length >= 2);
  const fallback = buildDriverGuidanceFallback(confidence, plan.laneCount > 0 && (maneuver.lanes?.length ?? 0) > 0, physicalConnectorAvailable);
  const guidanceAuthority = guidanceSmootherRef?.current.update(
    `${maneuver.type}:${maneuver.location.lat.toFixed(5)},${maneuver.location.lng.toFixed(5)}`,
    { level: fallback.level, lane: fallback.laneAuthority, branch: fallback.branchAuthority, continuity: fallback.continuityAuthority },
  ) ?? { level: fallback.level, lane: fallback.laneAuthority, branch: fallback.branchAuthority, continuity: fallback.continuityAuthority, transition: 1, previousLevel: null };
  const composition = buildSceneComposition(confidence, recovery, fallback);

  const nearest = userLocation ? nearestRouteIndex(coords, userLocation) : plan.routeStartIndex;
  const start = Math.max(0, Math.min(nearest, plan.maneuverIndex - 1));
  const end = Math.min(coords.length - 1, plan.maneuverIndex + 3);
  if (end <= start) return;

  const lanes = maneuver.lanes ?? [];
  const preferred = lanes.findIndex((lane) => lane.recommended);
  const destinationRoad = scene?.roads
    ?.filter((road) => (road.destination_lanes?.length ?? 0) > 0)
    .sort((a, b) => Math.min(...a.geometry.map((p) => haversineMetersToScene(p, maneuver.location))) - Math.min(...b.geometry.map((p) => haversineMetersToScene(p, maneuver.location))))[0] ?? null;
  const destinationLane = destinationRoad ? chooseDestinationLane(destinationRoad, maneuver, destinationLabel ?? null) : null;
  const laneIndex = destinationLane ?? (preferred >= 0 ? preferred : currentLaneIndex ?? Math.max(0, Math.floor(plan.laneCount / 2)));
  const roadWidth = Math.min(10, Math.max(6, plan.laneCount * 3.3));
  const halfLane = Math.max(1.25, Math.min(1.65, roadWidth / Math.max(2, plan.laneCount * 2)));

  const surfacePositions: any[] = [];
  const left: RouteCoord[] = [];
  const right: RouteCoord[] = [];
  for (let i = start; i <= end; i += 1) {
    const point = coords[i];
    const next = coords[Math.min(i + 1, coords.length - 1)];
    const bearing = bearingDegrees(point, next);
    left.push(destinationPoint(point, (bearing + 90) % 360, laneCenterOffsetMeters(laneIndex, plan.laneCount, roadWidth) - halfLane));
    right.push(destinationPoint(point, (bearing + 90) % 360, laneCenterOffsetMeters(laneIndex, plan.laneCount, roadWidth) + halfLane));
  }
  for (const point of left) surfacePositions.push(Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.20));
  for (let i = right.length - 1; i >= 0; i -= 1) surfacePositions.push(Cesium.Cartesian3.fromDegrees(right[i].lng, right[i].lat, 0.20));
  if (surfacePositions.length >= 4) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: new Cesium.PolygonHierarchy(surfacePositions),
          height: 0.20,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#2d7ff9').withAlpha(0.06 + (guidanceAuthority.level === 'lane' ? composition.guidanceAlpha * recovery.guidanceAlpha * guidanceAuthority.lane * 0.18 : guidanceAuthority.continuity * 0.08))) },
      }),
      appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }

  // At a junction, make the selected physical branch wider and easier to read
  // than the surrounding inferred geometry. Prefer the same OSM connector
  // topology used by the navigation engine, with a safe route fallback.
  const connector = plan.connectorTopology.connectors
    .filter((candidate) => candidate.points.length >= 2)
    .filter((candidate) => plan.targetLaneIndex == null || candidate.toLane == plan.targetLaneIndex)
    .sort((a, b) => b.confidence - a.confidence)[0]
    ?? plan.connectorTopology.connectors.filter((candidate) => candidate.points.length >= 2).sort((a, b) => b.confidence - a.confidence)[0];
  if (connector) {
    const positions = connector.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0.34));
    primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({ positions, width: laneExecution?.phase === 'changing' ? 4.8 : 4.2, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#50d8ff').withAlpha(0.18 + confidence.overall * composition.branchAlpha * guidanceAuthority.branch * 0.72)) },
      }),
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }

  // Junction comprehension is layered on top of the physical lane surface:
  // approach prepares the driver, decision makes the selected branch dominant,
  // and exit confirms the committed path. Simple turns stay intentionally quiet.
  const cuePlan = buildJunctionCuePlan(route, maneuver, plan.junctionBehavior);
  const predictive = userLocation ? buildPredictiveJunctionApproach(route, maneuver, userLocation, speedMps) : null;
  const intersection = navigationSnapshot?.spatialIntelligence.intersectionIntelligence ?? null;
  // The navigation engine is the source of truth for junction complexity. The
  // renderer may fall back to its local maneuver classifier, but it never
  // upgrades a junction beyond what the engine has actually established.
  const engineComplex = intersection?.complexity === 'complex';
  const enginePreparation = intersection?.preparationDistanceMeters ?? 0;
  const junctionBehavior = intersection?.behavior ?? plan.junctionBehavior.kind;
  const junctionProminence = engineComplex && predictive
    ? Math.max(predictive.prominence, Math.min(1, 0.55 + (enginePreparation > 0 ? Math.max(0, 1 - (predictive.distanceToManeuverMeters / Math.max(1, enginePreparation))) * 0.45 : 0)))
    : predictive?.prominence ?? 0;

  if (cuePlan) {
    const roadWidthCue = Math.min(11, Math.max(6.6, plan.laneCount * 3.3));
    const addZone = (startIndex: number, endIndex: number, alpha: number) => {
      if (endIndex <= startIndex) return;
      const a = coords[startIndex];
      const b = coords[endIndex];
      const bearing = bearingDegrees(a, b);
      const left = destinationPoint(a, (bearing + 90) % 360, roadWidthCue / 2);
      const right = destinationPoint(a, (bearing - 90 + 360) % 360, roadWidthCue / 2);
      const endLeft = destinationPoint(b, (bearing + 90) % 360, roadWidthCue / 2);
      const endRight = destinationPoint(b, (bearing - 90 + 360) % 360, roadWidthCue / 2);
      const positions = [left, right, endRight, endLeft].map((point) => Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.24));
      primitives.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolygonGeometry({ polygonHierarchy: new Cesium.PolygonHierarchy(positions), height: 0.24, vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#2d7ff9').withAlpha(alpha)) },
        }),
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
        asynchronous: true,
        releaseGeometryInstances: true,
      }));
    };
    cuePlan.zones.forEach((zone) => {
      const predictiveScale = predictive && zone.zone === 'approach' ? Math.max(0.55, engineComplex ? junctionProminence : predictive.prominence) : 1;
      addZone(zone.startIndex, zone.endIndex, zone.emphasis * 0.20 * predictiveScale * confidence.guidanceAlpha * recovery.guidanceAlpha);
    });

    if (engineComplex && navigationSnapshot?.spatialIntelligence.maneuverDistanceMeters != null) {
      const distance = navigationSnapshot.spatialIntelligence.maneuverDistanceMeters;
      const active = enginePreparation > 0 && distance <= enginePreparation;
      if (active) {
        const labels = new Cesium.LabelCollection();
        labels.add({
          position: Cesium.Cartesian3.fromDegrees(maneuver.location.lng, maneuver.location.lat, 3.2),
          text: junctionBehavior.replace('-', ' ').toUpperCase(),
          font: '700 13px system-ui',
          fillColor: Cesium.Color.WHITE.withAlpha(Math.max(0.55, junctionProminence)),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#101714').withAlpha(0.82),
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        primitives.add(labels);
      }
    }

    const branchCandidates = plan.connectorTopology.connectors.filter((candidate) => candidate.points.length >= 2);
    branchCandidates.forEach((candidate) => {
      const selected = (plan.targetLaneIndex != null && candidate.toLane === plan.targetLaneIndex)
        || (plan.targetLaneIndex == null && candidate.fromLane === currentLaneIndex);
      if (!selected && !cuePlan.showBranchAlternatives) return;
      const positions = candidate.points.map((point) => Cesium.Cartesian3.fromDegrees(point.lng, point.lat, selected ? 0.52 : 0.43));
      primitives.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({ positions, width: selected ? 5.8 : 2.2, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(selected ? '#20f0ff' : '#50d8ff').withAlpha(selected ? cuePlan.branchEmphasis * confidence.branchAlpha * guidanceAuthority.branch : 0.06 + confidence.branchAlpha * guidanceAuthority.branch * 0.16)) },
        }),
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
        releaseGeometryInstances: true,
      }));
    });

  }

  // Recovery is deliberately a soft physical cue, not a blocking error. The
  // route stays continuous while the renderer tells the driver which part of
  // the world model is being re-acquired.
  if (recovery.showRecoveryCue && coords.length >= 2) {
    const start = Math.max(0, nearest);
    const end = Math.min(coords.length - 1, start + 5);
    const positions = coords.slice(start, end + 1).map((point) => Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.56));
    if (positions.length >= 2) {
      primitives.add(new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.PolylineGeometry({ positions, width: 2.6, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
          attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE.withAlpha(0.22 + recovery.continuityAlpha * 0.22)) },
        }),
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: true,
        releaseGeometryInstances: true,
      }));
    }
  }
}

function addLaneGuidanceGeometry(Cesium: CesiumLike, route: Route3DHighlight, maneuver: Maneuver, primitives: any, scene?: SceneData, destinationLabel?: string | null, currentLaneIndex: number | null = null, currentLaneConfidence = 0, laneExecution: LaneChangeExecutionState | null = null, guidanceSmootherRef: React.MutableRefObject<GuidanceTransitionSmoother> | null = null, userLocation: Location | null = null, sceneAgeMs: number | null = null) {
  const plan = buildSceneGuidancePlan(route, maneuver, currentLaneIndex, currentLaneConfidence || 1, scene);
  const lanes = maneuver.lanes ?? [];
  if (!plan || !lanes.length) return;
  const confidence = buildSceneConfidence(plan, currentLaneConfidence, userLocation, route, scene ?? null);
  const physicalConnectorAvailable = plan.connectorTopology.connectors.some((candidate) => candidate.points.length >= 2);
  const fallback = buildDriverGuidanceFallback(confidence, lanes.length > 0, physicalConnectorAvailable);
  const recovery = buildSceneRecoveryPlan({ confidence, sceneAgeMs });
  const guidanceAuthority = guidanceSmootherRef?.current.update(
    `${maneuver.type}:${maneuver.location.lat.toFixed(5)},${maneuver.location.lng.toFixed(5)}`,
    { level: fallback.level, lane: fallback.laneAuthority, branch: fallback.branchAuthority, continuity: fallback.continuityAuthority },
  ) ?? { level: fallback.level, lane: fallback.laneAuthority, branch: fallback.branchAuthority, continuity: fallback.continuityAuthority, transition: 1, previousLevel: null };
  const composition = buildSceneComposition(confidence, recovery, fallback);
  const coords = route.segments.flatMap((segment) => segment.coords);
  const laneInstances: any[] = [];

  // Draw a short lane-level corridor rather than painting every route lane.
  // This makes the 3D scene answer the actual navigation question: which
  // lane leads to the upcoming maneuver?
  const preferred = lanes
    .map((lane, index) => ({ lane, index }))
    .filter(({ lane }) => lane.recommended);
  const destinationRoad = scene?.roads?.filter((road) => (road.destination_lanes?.length ?? 0) > 0).sort((a, b) => {
    const da = Math.min(...a.geometry.map((p) => haversineMetersToScene(p, maneuver.location)));
    const db = Math.min(...b.geometry.map((p) => haversineMetersToScene(p, maneuver.location)));
    return da - db;
  })[0] ?? null;
  const destinationLane = destinationRoad ? chooseDestinationLane(destinationRoad, maneuver, destinationLabel ?? null) : null;
  const destinationPreferred = destinationLane != null ? [{ lane: lanes[destinationLane] ?? lanes[0], index: destinationLane }] : [];
  const targets = destinationPreferred.length ? destinationPreferred : preferred.length ? preferred : lanes.map((lane, index) => ({ lane, index }));
  const roadWidth = Math.min(10, Math.max(6.0, plan.laneCount * 3.3));

  (fallback.level === 'lane' ? targets.slice(0, 3) : []).forEach(({ index }) => {
    const positions: any[] = [];
    for (let i = plan.routeStartIndex; i < plan.maneuverIndex && i < coords.length - 1; i += 1) {
      const bearing = bearingDegrees(coords[i], coords[i + 1]);
      const p = sceneLanePoint(coords[i], bearing, index, plan.laneCount, roadWidth);
      positions.push(Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0.30));
    }
    if (positions.length >= 2) {
      laneInstances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({ positions, width: 3.2, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#50d8ff').withAlpha(0.28 + composition.guidanceAlpha * 0.62)) },
      }));
    }
  });

  // Feed the same OSM-node physical topology used by navigation into the
  // Cesium layer. This is the important bridge between lane intelligence and
  // the actual 3D IRL view: the highlighted lane must terminate on a real
  // lane-to-lane junction connector, not merely on a proportional screen
  // offset.
  // During an actual lane change, draw a short physical lateral trajectory
  // between the source and target lane centers. This is deliberately rendered
  // in geographic coordinates so the first-person Cesium view shows the same
  // maneuver the lane execution state machine is tracking.
  if (fallback.level === 'lane' && laneExecution?.phase === 'changing' && laneExecution.sourceLane != null && laneExecution.targetLane != null && plan.laneCount > 1) {
    const physicalTrajectory = plan.laneChangeTrajectory?.sourceLane === laneExecution.sourceLane && plan.laneChangeTrajectory?.targetLane === laneExecution.targetLane
      ? plan.laneChangeTrajectory
      : null;
    const changePositions: any[] = physicalTrajectory?.reachable && physicalTrajectory.points.length >= 2
      ? physicalTrajectory.points.map((point) => Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.62))
      : (() => {
          const startIndex = Math.max(plan.routeStartIndex, plan.maneuverIndex - 16);
          const endIndex = Math.min(plan.maneuverIndex - 1, startIndex + 10, coords.length - 2);
          if (endIndex <= startIndex) return [];
          return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => {
            const i = startIndex + offset;
            const t = offset / Math.max(1, endIndex - startIndex);
            const lane = lerp(laneExecution.sourceLane!, laneExecution.targetLane!, t);
            const bearing = bearingDegrees(coords[i], coords[i + 1]);
            const point = sceneLanePoint(coords[i], bearing, lane, plan.laneCount, roadWidth);
            return Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.62);
          });
        })();
    if (changePositions.length >= 2) {
      laneInstances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({ positions: changePositions, width: 6.5, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.98)) },
      }));
    }
  }

  if (scene?.roads?.length) {
    const physical = buildPhysicalLaneTopology(
      scene.roads,
      maneuver,
      (() => {
        const destinationRoad = scene.roads.filter((road) => (road.destination_lanes?.length ?? 0) > 0).sort((a, b) => {
          const da = Math.min(...a.geometry.map((p) => haversineMetersToScene(p, maneuver.location)));
          const db = Math.min(...b.geometry.map((p) => haversineMetersToScene(p, maneuver.location)));
          return da - db;
        })[0];
        return destinationRoad ? chooseDestinationLane(destinationRoad, maneuver, destinationLabel ?? null) ?? plan.targetLaneIndex : plan.targetLaneIndex;
      })(),
      scene.restrictions,
    );
    const routeTargetLane = plan.targetLaneIndex;
    const rankedConnectors = [...physical.connectors].sort((a, b) => {
      const aTarget = routeTargetLane != null && a.toLane === routeTargetLane ? 1 : 0;
      const bTarget = routeTargetLane != null && b.toLane === routeTargetLane ? 1 : 0;
      return (bTarget * 10 + b.confidence) - (aTarget * 10 + a.confidence);
    });
    for (const connector of rankedConnectors) {
      if (connector.points.length < 2) continue;
      const isCurrent = currentLaneIndex != null && connector.fromLane === currentLaneIndex;
      const isTarget = routeTargetLane != null && connector.toLane === routeTargetLane;
      const isActive = fallback.level === 'lane' && (isTarget || (isCurrent && routeTargetLane == null));
      const positions = connector.points.map((point) =>
        Cesium.Cartesian3.fromDegrees(point.lng, point.lat, isActive ? 0.48 : 0.40)
      );
      laneInstances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.PolylineGeometry({
          positions,
          width: isActive ? 5.4 : 2.4,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            Cesium.Color.fromCssColorString(isActive ? '#20f0ff' : '#50d8ff')
              .withAlpha(isActive ? 0.98 : Math.max(0.08, connector.confidence * composition.branchAlpha * guidanceAuthority.branch * 0.84))
          ),
        },
      }));
    }
  }

  // Render the explicit connector topology produced by the navigation core.
  // Geometry is marked as inferred in the topology because OSRM lane metadata
  // does not contain physical connector centerlines.
  for (const connector of plan.connectorTopology.connectors) {
    if (connector.points.length < 2) continue;
    const positions = connector.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, connector.kind === 'change' ? 0.36 : 0.33));
    laneInstances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({ positions, width: connector.kind === 'change' ? 2.5 : 2.0, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(connector.kind === 'change' ? '#ffffff' : '#50d8ff').withAlpha(Math.max(0.10, connector.confidence * confidence.guidanceAlpha * (guidanceAuthority.level === 'lane' ? 1 : 0.45)))) },
    }));
  }

  if (laneInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: laneInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
}

function nearestRouteIndex(coords: RouteCoord[], location: { lat: number; lng: number }): number {
  let bestIndex = 0; let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i += 1) { const d = Math.hypot(coords[i].lat - location.lat, coords[i].lng - location.lng); if (d < best) { best = d; bestIndex = i; } }
  return bestIndex;
}

function addTurnGuidance(
  Cesium: CesiumLike,
  viewer: CesiumLike,
  maneuver: Maneuver,
  coords: RouteCoord[],
  _primitives: any,
  scene?: SceneData,
  destinationLabel?: string | null,
) {
  const fallbackPlan = buildSceneGuidancePlan(
    { segments: [{ coords, is_highlighted: true, color: '#fff', lane_index: null }], maneuvers: [], duration_seconds: null, distance_meters: null },
    maneuver,
  );
  const idx = fallbackPlan?.maneuverIndex ?? 0;
  const before = coords[Math.max(0, idx - 8)] ?? coords[Math.max(0, idx - 1)] ?? maneuver.location;
  const after = coords[Math.min(coords.length - 1, idx + 10)] ?? coords[Math.min(coords.length - 1, idx + 1)] ?? maneuver.location;
  const approachBearing = bearingDegrees(before, maneuver.location);
  const exitBearing = bearingDegrees(maneuver.location, after);
  const fallbackApproach = destinationPoint(maneuver.location, (approachBearing + 180) % 360, 38);
  const fallbackExit = destinationPoint(maneuver.location, exitBearing, 72);

  // Prefer the same physical OSM lane connector that was used by lane
  // guidance. This makes the turn animation travel through the real junction
  // rather than jumping across it at the maneuver coordinate.
  let turnPath: RouteCoord[] = [fallbackApproach, { ...maneuver.location, alt: 0 }, fallbackExit];
  if (scene?.roads?.length) {
    const physical = buildPhysicalLaneTopology(
      scene.roads,
      maneuver,
      (() => {
        const routeRoad = scene.roads.find((road) => road.osm_id != null && (road.destination_lanes?.length ?? 0) > 0) ?? null;
        return routeRoad ? chooseDestinationLane(routeRoad, maneuver, destinationLabel ?? null) ?? maneuver.lanes?.findIndex((lane) => lane.recommended) ?? null : maneuver.lanes?.findIndex((lane) => lane.recommended) ?? null;
      })(),
      scene.restrictions,
    );
    const preferred = physical.connectors
      .filter((connector) => connector.points.length >= 3)
      .sort((a, b) => {
        const aTarget = maneuver.lanes?.findIndex((lane) => lane.recommended) ?? null;
        const bTarget = aTarget;
        const aScore = (aTarget != null && a.toLane === aTarget ? 2 : 0) + a.confidence;
        const bScore = (bTarget != null && b.toLane === bTarget ? 2 : 0) + b.confidence;
        return bScore - aScore;
      })[0];
    if (preferred) turnPath = preferred.points;
  }

  const positions = turnPath.map((point) => Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0.95));
  const maneuverPoint = Cesium.Cartesian3.fromDegrees(maneuver.location.lng, maneuver.location.lat, 0.95);
  viewer.entities.add({
    polyline: {
      positions,
      width: 14,
      clampToGround: true,
      material: new Cesium.PolylineArrowMaterialProperty(
        Cesium.Color.fromCssColorString('#2d7ff9').withAlpha(0.98),
      ),
    },
  });

  // A moving marker communicates the intended path through the junction. It
  // is deliberately time-based, so it remains smooth even when GPS updates
  // arrive at an irregular cadence.
  const cumulative: number[] = [0];
  for (let i = 1; i < turnPath.length; i += 1) {
    cumulative.push(cumulative[i - 1] + routePointDistance(turnPath[i - 1], turnPath[i]));
  }
  const total = cumulative[cumulative.length - 1];
  const startedAt = Date.now();
  const pointAlong = (distance: number): RouteCoord => {
    if (turnPath.length < 2 || total <= 0) return turnPath[0] ?? maneuver.location;
    const d = Math.max(0, Math.min(total, distance));
    let segment = 1;
    while (segment < cumulative.length && cumulative[segment] < d) segment += 1;
    const a = turnPath[Math.max(0, segment - 1)];
    const b = turnPath[Math.min(turnPath.length - 1, segment)];
    const span = Math.max(0.001, cumulative[segment] - cumulative[segment - 1]);
    const t = (d - cumulative[segment - 1]) / span;
    return { lat: lerp(a.lat, b.lat, t), lng: lerp(a.lng, b.lng, t), alt: lerp(a.alt, b.alt, t) };
  };

  viewer.entities.add({
    position: new Cesium.CallbackPositionProperty(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const progress = (elapsed % 3.8) / 3.8;
      const point = pointAlong(total * progress);
      return Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 1.55);
    }, false),
    point: {
      pixelSize: 12,
      color: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString('#2d7ff9'),
      outlineWidth: 4,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  // Keep the junction visually anchored even when the physical connector is
  // offset from the exact OSRM maneuver coordinate.
  viewer.entities.add({
    position: maneuverPoint,
    point: { pixelSize: 18, color: Cesium.Color.fromCssColorString('#2d7ff9'), outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
  });

  const label = maneuver.type === 'roundabout' ? 'ROUNDABOUT' : maneuver.type === 'fork' ? 'FORK' : maneuver.type === 'merge' ? 'MERGE' : (maneuver.modifier ? maneuver.modifier.toUpperCase() : 'TURN');
  viewer.entities.add({
    position: maneuverPoint,
    label: { text: label, font: '700 16px system-ui', fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#101714').withAlpha(0.9), pixelOffset: new Cesium.Cartesian2(0, -30) },
  });
}

function routePointDistance(a: RouteCoord, b: RouteCoord): number {
  const latScale = 111320;
  const lngScale = 111320 * Math.max(0.2, Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180));
  return Math.hypot((b.lat - a.lat) * latScale, (b.lng - a.lng) * lngScale);
}

async function fetchOsmContext(lat: number, lng: number): Promise<SceneData> {
  // The browser talks only to Streept's backend. The backend performs one
  // combined Overpass query and caches the result, keeping public OSM
  // infrastructure out of the live GPS/render loop.
  return getSceneContext({ lat, lng }, 220);
}

function haversineMetersToScene(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function buildSceneCompositionForContext(
  route: Route3DHighlight,
  maneuver: Maneuver,
  currentLaneIndex: number | null,
  currentLaneConfidence: number,
  userLocation: Location | null,
  scene: SceneData,
  sceneAgeMs: number | null = null,
): SceneCompositionPlan {
  const plan = buildSceneGuidancePlan(route, maneuver, currentLaneIndex, currentLaneConfidence || 1, scene);
  if (!plan) {
    const confidence = { overall: 0.45, lane: 0.35, topology: 0.45, gps: 0.45, scene: 0.55, guidanceAlpha: 0.7, branchAlpha: 0.5 };
    const recovery = buildSceneRecoveryPlan({ confidence, sceneAgeMs });
    return buildSceneComposition(confidence, recovery, { level: 'route', laneAuthority: 0.08, branchAuthority: 0.12, continuityAuthority: 0.55, reason: 'scene plan unavailable' });
  }
  const confidence = buildSceneConfidence(plan, currentLaneConfidence, userLocation, route, scene ?? null);
  const recovery = buildSceneRecoveryPlan({ confidence, sceneAgeMs });
  const connectorAvailable = plan.connectorTopology.connectors.some((candidate) => candidate.points.length >= 2);
  const fallback = buildDriverGuidanceFallback(confidence, plan.laneCount > 0 && (maneuver.lanes?.length ?? 0) > 0, connectorAvailable);
  return buildSceneComposition(confidence, recovery, fallback);
}

function addOsmContext(Cesium: CesiumLike, viewer: CesiumLike, scene: SceneData, primitives: any, maneuverLocation?: { lat: number; lng: number }, entityRegistry: Set<any> = new Set(), headingDegrees: number | null = null, lodCenter: { lat: number; lng: number } | null = null, lodPolicy = sceneLodPolicyForQuality('high'), billboards: Billboard[] = [], composition: SceneCompositionPlan | null = null): void {
  const addEntity = (entity: any) => { const created = viewer.entities.add(entity); entityRegistry.add(created); return created; };
  const worldAlpha = composition?.worldAlpha ?? 0.82;
  const infrastructureAlpha = composition?.infrastructureAlpha ?? 0.76;
  const billboardAlpha = composition?.billboardAlpha ?? 0.66;
  const worldDetail = composition?.maxWorldDetail ?? 1;
  const buildingLimit = Math.max(180, Math.floor(1200 * worldDetail));
  const roadLimit = Math.max(80, Math.floor(300 * worldDetail));
  const infrastructureLimit = Math.max(20, Math.floor(80 * worldDetail));
  const buildingInstances: any[] = [];
  const roadInstances: any[] = [];
  const laneMarkingInstances: any[] = [];

  // Near-field receives most building detail; the far field is deliberately
  // capped to keep the street-level frame focused and responsive.
  scene.buildings.slice(0, buildingLimit).forEach((building) => {
    const geometry = building.geometry;
    if (!Array.isArray(geometry) || geometry.length < 3) return;
    const center = geometry.reduce((acc: any, p: any) => ({ lat: acc.lat + p.lat / geometry.length, lng: acc.lng + p.lng / geometry.length }), { lat: 0, lng: 0 });
    const buildingLod = lodCenter ? sceneLodForObject('building', lodCenter, center, headingDegrees, lodPolicy) : 'near';
    if (buildingLod === 'hidden') return;
    const coords = geometry.map((p: any) => [p.lng, p.lat]);
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) coords.push(coords[0]);
    const height = buildingLod === 'far' ? Math.max(3, Math.min(45, building.height ?? 8)) : Math.max(3, Math.min(90, building.height ?? 8));
    const tone = height > 28 ? '#8b9891' : height > 14 ? '#74827b' : '#697872';
    const hierarchy = new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(coords.flat()));
    buildingInstances.push(new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        height: 0,
        extrudedHeight: height,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(tone).withAlpha((buildingLod === 'near' ? 0.97 : buildingLod === 'mid' ? 0.9 : 0.78) * worldAlpha)) },
    }));
  });

  const buildingPrimitive = new Cesium.Primitive({
    geometryInstances: buildingInstances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: true }),
    asynchronous: true,
    releaseGeometryInstances: true,
  });

  scene.roads.slice(0, roadLimit).forEach((road) => {
    const geometry = road.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) return;
    const roadCenter = geometry[Math.floor(geometry.length / 2)];
    const roadLod = lodCenter ? sceneLodForObject('road', lodCenter, roadCenter, headingDegrees, lodPolicy) : 'near';
    if (roadLod === 'hidden') return;
    const pedestrianRoad = ['footway', 'path', 'cycleway', 'pedestrian', 'steps', 'track', 'service'].includes(road.highway ?? '');
    const majorRoad = ['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(road.highway ?? '');
    const lanes = Math.max(1, Math.min(6, road.lanes ?? (majorRoad ? 3 : 2)));
    const roadWidth = pedestrianRoad ? 2.5 : Math.min(24, Math.max(5.5, lanes * 3.35));
    const material = pedestrianRoad
      ? Cesium.Color.fromCssColorString('#9da6a0').withAlpha(0.84 * worldAlpha)
      : road.bridge
        ? Cesium.Color.fromCssColorString('#3f4a55').withAlpha(0.99 * worldAlpha)
        : road.tunnel
          ? Cesium.Color.fromCssColorString('#24292e').withAlpha(0.99 * worldAlpha)
          : majorRoad
            ? Cesium.Color.fromCssColorString('#2b3036').withAlpha(0.99 * worldAlpha)
            : Cesium.Color.fromCssColorString('#34393f').withAlpha(0.97 * worldAlpha);

    const positions = geometry.map((p: any) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0.06));
    if (positions.length >= 2) {
      roadInstances.push(new Cesium.GeometryInstance({
        geometry: new Cesium.CorridorGeometry({
          positions,
          width: roadWidth,
          height: road.bridge ? 1.8 : 0.06,
          extrudedHeight: road.bridge ? 1.8 : 0.06,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(material) },
      }));
    }

    // Sparse, near-camera lane separators are intentionally separate so the
    // road surface stays a single batched primitive instead of hundreds of
    // individual polygon entities.
    if (!pedestrianRoad && lanes > 1 && roadLod !== 'far') {
      const segmentStride = Math.max(1, Math.floor(geometry.length / 18));
      for (let i = 0; i < geometry.length - 1; i += segmentStride) {
        const a = geometry[i];
        const b = geometry[Math.min(i + segmentStride, geometry.length - 1)];
        const bearing = bearingDegrees(a, b);
        for (let lane = 1; lane < lanes; lane += 1) {
          const offset = -roadWidth / 2 + (roadWidth * lane / lanes);
          const la = destinationPoint(a, (bearing + 90) % 360, offset);
          const lb = destinationPoint(b, (bearing + 90) % 360, offset);
          laneMarkingInstances.push(new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: [
                Cesium.Cartesian3.fromDegrees(la.lng, la.lat, 0.18),
                Cesium.Cartesian3.fromDegrees(lb.lng, lb.lat, 0.18),
              ],
              width: majorRoad ? 1.15 : 0.9,
              vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
            }),
            attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE.withAlpha(0.72 * infrastructureAlpha)) },
          }));
        }
      }
    }

    if (road.name && geometry.length >= 2 && roadLod !== 'far') {
      const mid = geometry[Math.floor(geometry.length / 2)];
      addEntity({
        position: Cesium.Cartesian3.fromDegrees(mid.lng, mid.lat, 2.6),
        label: {
          text: road.name,
          font: '600 11px system-ui',
          fillColor: Cesium.Color.fromCssColorString('#edf3ef').withAlpha(0.9 * infrastructureAlpha),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#101418').withAlpha(0.72 * infrastructureAlpha),
          pixelOffset: new Cesium.Cartesian2(0, -4),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150),
        },
      });
    }

    // OSM lane arrows are one of the most useful pieces of scene metadata at
    // a decision point. Show them only when the approach is close to the
    // upcoming maneuver, keeping the street scene uncluttered elsewhere.
    if (road.turn_lanes?.length && maneuverLocation && geometry.length >= 2 && roadLod === 'near') {
      const mid = geometry[Math.floor(geometry.length / 2)];
      if (haversineMetersToScene(maneuverLocation, mid) <= 115) {
        const arrowText = road.turn_lanes.map((value) => value
          .split(';')
          .map((v) => ({ left: '←', through: '↑', right: '→', slight_left: '↖', slight_right: '↗', sharp_left: '↙', sharp_right: '↘', merge_to_left: '↞', merge_to_right: '↠' } as Record<string, string>)[v.trim()] ?? '•')
          .join('')).join('  ');
        addEntity({
          position: Cesium.Cartesian3.fromDegrees(mid.lng, mid.lat, 0.72),
          label: {
            text: arrowText,
            font: '800 14px system-ui',
            fillColor: Cesium.Color.WHITE,
            showBackground: false,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 105),
          },
        });
      }
    }
  });

  if (maneuverLocation && scene.roads.length) {
    // OSM node IDs give us real junction anchors. Render these connectors only
    // when the scene extract actually contains topology; otherwise the older
    // inferred lane ribbons remain the safe fallback.
    const syntheticManeuver = {
      type: 'turn', modifier: null, location: maneuverLocation, bearing_before: 0,
      instruction: 'junction', is_complex: true, lanes: null,
    } as any;
    const physical = buildPhysicalLaneTopology(scene.roads, syntheticManeuver, null, scene.restrictions);
    const connectorInstances: any[] = physical.connectors.map((connector) => new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: connector.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0.24)),
        width: 2.8, vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#ffdf6b').withAlpha(connector.confidence)) },
    }));
    if (connectorInstances.length) {
      primitives.add(new Cesium.Primitive({
        geometryInstances: connectorInstances,
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        asynchronous: true, releaseGeometryInstances: true,
      }));
    }
  }

  const roadPrimitive = new Cesium.Primitive({
    geometryInstances: roadInstances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
    asynchronous: true,
    releaseGeometryInstances: true,
  });

  (scene.street_lamps ?? []).slice(0, infrastructureLimit).forEach((lamp: any) => {
    if (lodCenter && sceneLodForObject('street-lamp', lodCenter, lamp, headingDegrees, lodPolicy) === 'hidden') return;
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(lamp.lng, lamp.lat, 2.8),
      cylinder: { length: 5.6, topRadius: 0.10, bottomRadius: 0.16, material: Cesium.Color.fromCssColorString('#3b403f') },
    });
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(lamp.lng, lamp.lat, 5.8),
      point: { pixelSize: 5, color: Cesium.Color.fromCssColorString('#f6df9a') },
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 95),
    });
  });

  scene.trees.slice(0, Math.max(30, Math.floor(160 * worldDetail))).forEach((tree) => {
    if (lodCenter && sceneLodForObject('tree', lodCenter, tree, headingDegrees, lodPolicy) === 'hidden') return;
    const base = Cesium.Cartesian3.fromDegrees(tree.lng, tree.lat, 0.7);
    addEntity({
      position: base,
      cylinder: { length: 2.8, topRadius: 0.18, bottomRadius: 0.28, material: Cesium.Color.fromCssColorString('#6a4b35') },
    });
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(tree.lng, tree.lat, 3.1),
      ellipsoid: { radii: new Cesium.Cartesian3(2.2, 2.2, 2.7), material: Cesium.Color.fromCssColorString('#4f9b54').withAlpha(0.94) },
    });
  });


  // Roadside wayfinding/signage makes the reconstructed world read as one
  // physical environment instead of only a road-and-building mesh. Prefer
  // real OSM destination/maxspeed metadata and keep the number of signs
  // deliberately small in the immersive near field.
  const signRoads = scene.roads
    .filter((road) => road.geometry.length >= 2 && !['footway', 'path', 'cycleway', 'pedestrian', 'steps'].includes(road.highway ?? '') && (road.destination_lanes?.length || road.maxspeed || road.name))
    .slice(0, 36);
  signRoads.forEach((road) => {
    const midIndex = Math.floor(road.geometry.length / 2);
    const center = road.geometry[midIndex];
    const lod = lodCenter ? sceneLodForObject('road-sign', lodCenter, center, headingDegrees, lodPolicy) : 'near';
    if (lod === 'hidden' || lod === 'far') return;
    const next = road.geometry[Math.min(midIndex + 1, road.geometry.length - 1)];
    const bearing = bearingDegrees(center, next);
    const side = destinationPoint(center, (bearing + 90) % 360, 5.0);
    const label = road.destination_lanes?.[0] || road.maxspeed || road.name || '';
    if (!label) return;
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(side.lng, side.lat, 3.0),
      cylinder: { length: 3.0, topRadius: 0.055, bottomRadius: 0.08, material: Cesium.Color.fromCssColorString('#4a514e') },
    });
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(side.lng, side.lat, 4.45),
      label: {
        text: road.maxspeed && !road.destination_lanes?.length ? `${label} km/h` : label,
        font: '700 10px system-ui',
        fillColor: Cesium.Color.WHITE.withAlpha(billboardAlpha),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#1a2420').withAlpha(0.9),
        pixelOffset: new Cesium.Cartesian2(0, -2),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 135),
      },
    });
  });

  scene.signals.slice(0, Math.max(12, Math.floor(40 * worldDetail))).forEach((signal) => {
    if (lodCenter && sceneLodForObject('signal', lodCenter, signal, headingDegrees, lodPolicy) === 'hidden') return;
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(signal.lng, signal.lat, 4),
      cylinder: { length: 6, topRadius: 0.35, bottomRadius: 0.35, material: Cesium.Color.fromCssColorString('#3a4541') },
    });
  });

  scene.crossings.slice(0, Math.max(12, Math.floor(40 * worldDetail))).forEach((crossing) => {
    if (lodCenter && sceneLodForObject('crossing', lodCenter, crossing, headingDegrees, lodPolicy) === 'hidden') return;
    for (let stripe = -3; stripe <= 3; stripe += 1) {
      const p = destinationPoint(crossing, 0, stripe * 1.1);
      addEntity({
        position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0.19),
        ellipse: { semiMajorAxis: 0.42, semiMinorAxis: 3.8, material: Cesium.Color.WHITE.withAlpha(0.78) },
      });
    }
  });

  scene.stops.slice(0, Math.max(10, Math.floor(30 * worldDetail))).forEach((stop) => {
    if (lodCenter && sceneLodForObject('stop', lodCenter, stop, headingDegrees, lodPolicy) === 'hidden') return;
    addEntity({
      position: Cesium.Cartesian3.fromDegrees(stop.lng, stop.lat, 1.2),
      point: { pixelSize: 8, color: Cesium.Color.fromCssColorString('#f0c75e') },
      label: { text: 'STOP', font: '700 10px system-ui', fillColor: Cesium.Color.WHITE, showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#171c1a').withAlpha(0.85), pixelOffset: new Cesium.Cartesian2(0, -16) },
    });
  });
  addRoadsideBillboards(Cesium, viewer, billboards, scene.roads, lodCenter ?? maneuverLocation ?? null, headingDegrees, lodPolicy, entityRegistry, billboardAlpha);

  primitives.add(buildingPrimitive);
  primitives.add(roadPrimitive);
  if (laneMarkingInstances.length) {
    primitives.add(new Cesium.Primitive({
      geometryInstances: laneMarkingInstances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
      asynchronous: true,
      releaseGeometryInstances: true,
    }));
  }
}
function addRoadsideBillboards(
  Cesium: CesiumLike,
  viewer: CesiumLike,
  billboards: Billboard[],
  roads: SceneRoad[],
  lodCenter: { lat: number; lng: number } | null,
  headingDegrees: number | null,
  lodPolicy: ReturnType<typeof sceneLodPolicyForQuality>,
  entityRegistry: Set<any>,
  billboardAlpha = 0.66,
): void {
  if (!billboards.length || viewer.isDestroyed()) return;
  const addEntity = (entity: any) => { const created = viewer.entities.add(entity); entityRegistry.add(created); return created; };

  for (const billboard of billboards.slice(0, 80)) {
    const center = billboard.location;
    const lod = lodCenter ? sceneLodForObject('billboard', lodCenter, center, headingDegrees, lodPolicy) : 'near';
    if (lod === 'hidden') continue;

    let roadBearing = headingDegrees ?? 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const road of roads.slice(0, 180)) {
      for (let i = 0; i < road.geometry.length - 1; i += Math.max(1, Math.floor(road.geometry.length / 12))) {
        const a = road.geometry[i];
        const b = road.geometry[Math.min(i + 1, road.geometry.length - 1)];
        const d = haversineMetersToScene(center, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 });
        if (d < bestDistance) {
          bestDistance = d;
          roadBearing = bearingDegrees(a, b);
        }
      }
    }
    if (bestDistance > 80) continue;

    const width = lod === 'far' ? 6.5 : 8;
    const height = lod === 'far' ? 2.5 : 3.2;
    const boardBottom = 3.2;
    const rightBearing = (roadBearing + 90) % 360;
    const leftCenter = destinationPoint(center, rightBearing, -width / 2);
    const rightCenter = destinationPoint(center, rightBearing, width / 2);

    const bottomLeft = Cesium.Cartesian3.fromDegrees(leftCenter.lng, leftCenter.lat, boardBottom);
    const bottomRight = Cesium.Cartesian3.fromDegrees(rightCenter.lng, rightCenter.lat, boardBottom);
    const topLeft = Cesium.Cartesian3.fromDegrees(leftCenter.lng, leftCenter.lat, boardBottom + height);
    const topRight = Cesium.Cartesian3.fromDegrees(rightCenter.lng, rightCenter.lat, boardBottom + height);
    const image = billboard.is_purchased && billboard.ad_image_url ? billboard.ad_image_url : null;

    addEntity({
      id: `roadside-billboard-${billboard.id}`,
      position: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, boardBottom + height / 2),
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy([bottomLeft, bottomRight, topRight, topLeft]),
        material: image ? new Cesium.ImageMaterialProperty({ image, transparent: true, color: Cesium.Color.WHITE.withAlpha(billboardAlpha) }) : Cesium.Color.fromCssColorString('#101418').withAlpha(0.96 * billboardAlpha),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#d8e1dc').withAlpha(0.86),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, lod === 'far' ? 430 : 320),
      },
      label: image ? undefined : {
        text: billboard.is_purchased ? 'LIVE AD' : 'AD SPACE',
        font: '800 13px system-ui',
        fillColor: Cesium.Color.WHITE.withAlpha(billboardAlpha),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#101418').withAlpha(0.76 * billboardAlpha),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 190),
      },
    });

    for (const support of [leftCenter, rightCenter]) {
      addEntity({
        position: Cesium.Cartesian3.fromDegrees(support.lng, support.lat, boardBottom / 2),
        cylinder: {
          length: boardBottom,
          topRadius: 0.07,
          bottomRadius: 0.10,
          material: Cesium.Color.fromCssColorString('#30383a').withAlpha(billboardAlpha),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 260),
        },
      });
    }
  }
}

function addProceduralContext(Cesium: CesiumLike, viewer: CesiumLike, coords: RouteCoord[], maneuver: Maneuver, _primitives: any) {
  const stride = Math.max(2, Math.floor(coords.length / 20));
  for (let i = 2; i < coords.length - 2; i += stride) {
    const a = coords[i];
    const b = coords[Math.min(i + 1, coords.length - 1)];
    const bearing = bearingDegrees(a, b);
    [bearing + 90, bearing - 90].forEach((side, sideIndex) => {
      const spot = destinationPoint(a, (side + 360) % 360, 18 + ((i + sideIndex) % 3) * 7);
      const height = 7 + ((i * 13 + sideIndex * 11) % 18);
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(spot.lng, spot.lat, height / 2),
        box: {
          dimensions: new Cesium.Cartesian3(10, 10, height),
          material: Cesium.Color.fromCssColorString(sideIndex === 0 ? '#718078' : '#596762').withAlpha(0.88),
        },
      });
    });
  }
  // Keep the fallback visibly tied to the real maneuver rather than looking
  // like a generic city block.
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(maneuver.location.lng, maneuver.location.lat, 7),
    ellipsoid: { radii: new Cesium.Cartesian3(2.5, 2.5, 14), material: Cesium.Color.fromCssColorString('#45d6c0').withAlpha(0.72) },
  });
}


export default ImmersiveTurnView;
