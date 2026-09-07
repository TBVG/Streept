## Alpha 126 — Production Vehicle Telemetry Ingestion
- [x] Add a provider-neutral authenticated telemetry webhook for real vehicle observations.
- [x] Validate coordinates, confidence, source identity, and bounded batch size before ingestion.
- [x] Publish accepted observations through the existing lane-aware WebSocket stream.
- [x] Keep ingestion disabled when no VEHICLE_INGEST_TOKEN is configured.

## Alpha 122 — Live Scene Lane Topology Replay
- [x] Feed replay maneuvers from live `SceneContext` road geometry when available.
- [x] Match route positions to real OSM ways instead of always creating replay-only roads.
- [x] Resolve marked junctions through shared-node physical lane topology and real OSM restrictions.
- [x] Preserve deterministic synthetic fallback when live scene context is unavailable.

## Alpha 123 — Persistent Lane-Aware Traffic Tracks
- [x] Attach replay vehicles to optional live OSM way identities.
- [x] Project tracked vehicles onto physical lane centerlines when live scene geometry is available.
- [x] Preserve deterministic vehicle motion and lane changes across replay frames.
- [x] Reuse real junction lane continuity when resolving route-wide junction maneuvers.
- [x] Keep synthetic route projection as a safe fallback when a live way is unavailable.
- [ ] Feed persistent vehicle tracks from the real backend/WebSocket traffic stream.

## Alpha 124 — Live Traffic Stream Integration
- [x] Unify REST traffic snapshots and WebSocket report deltas behind one client stream.
- [x] Prevent stale REST responses from overwriting newer live events.
- [x] Prune expired/stale road-intelligence reports before navigation consumes them.
- [x] Feed the normalized stream into NavigationView while preserving the existing report UI.
- [ ] Add a real backend vehicle-telemetry provider and lane-positioned vehicle WebSocket events.

- **Alpha 127 — Cesium live traffic layer:** completed. Real telemetry is now rendered as bounded, stable 3D traffic entities, with physical lane snapping only when OSM way/lane identity is available.

## Alpha 128 — Dynamic Immersive Scene Streaming
- [x] Add a framework-neutral scene bubble streamer with movement-based refresh thresholds.
- [x] Reuse the existing bounded scene cache instead of refetching every GPS fix.
- [x] Prevent late scene requests from overwriting newer driver-position bubbles.
- [x] Feed the immersive view from a user-centered scene bubble when available.
- [x] Keep scene delivery independent from high-frequency vehicle telemetry updates.

### Alpha 129 — Production 3D scene lifecycle
- [x] Added renderer-neutral scene render plans and stable object identities.
- [x] Added scene-plan diffing for added/removed/unchanged objects.
- [x] Replaced global Cesium `entities.removeAll()` scene resets with persistent driver/traffic entities.
- [x] Build new static primitive collection before atomically swapping the live scene.
- [x] Preserve previous navigation guidance until the replacement scene is ready.
- [x] Guard late asynchronous scene builds with generation checks.

### Alpha 134 — Immersive Scene LOD + Visibility — COMPLETED
- Added camera-local near/mid/far/hidden scene LOD.
- Added heading-aware far-field culling.
- Reduced distant small-object and lane-detail rendering while preserving large forms.
- Kept LOD inside reusable scene chunks and separate from traffic/navigation layers.

### Alpha 135 — Adaptive 3D Render Quality — COMPLETED
- Added sustained frame-time EMA + hysteresis quality controller.
- Dynamically adjusts Cesium quality knobs without per-frame React updates.
- Ties scene LOD, route detail, active chunks, and traffic cap to quality tier.
- Added deterministic anti-oscillation tests.

## Alpha 136 — Immersive Roadside Billboard Objects — COMPLETED
- [x] Render live billboard inventory as physical roadside 3D objects.
- [x] Render free-beta ad creatives directly on billboard faces.
- [x] Align billboard orientation to nearby mapped road geometry.
- [x] Keep billboard rendering inside the existing scene LOD/lifecycle system.

## Alpha 137 — Roadside World Reconstruction — COMPLETED
- [x] Treat the immersive view as a coherent roadside environment rather than isolated map primitives.
- [x] Preserve real OSM road, building, lane, crossing, signal, lamp, tree, stop, and billboard context.
- [x] Add lightweight physical roadside wayfinding/signage from available OSM road metadata.
- [x] Keep signage bounded by the existing scene LOD policy so street-level detail does not overwhelm the driver view.
- [x] Preserve live billboard creatives through every scene refresh.

## Alpha 138 — Driver-First 3D Road Geometry — COMPLETED
- [x] Make the camera-facing route lane a visible physical surface, not only a glowing line.
- [x] Prefer the current/recommended/destination lane for the near-field road focus.
- [x] Emphasize the selected physical junction branch using the same connector topology as navigation.
- [x] Preserve lane-change visualization while keeping the driver-first surface lightweight.
- [x] Keep road focus bounded by existing scene lifecycle, adaptive quality, and streaming budgets.

## Alpha 139 — Junction Comprehension & Driver Cues — COMPLETED
- [x] Add clearer approach/decision/exit zones around complex junctions.
- [x] Make branch selection readable earlier without cluttering the near field.
- [x] Connect lane arrows, physical lane surface, signs, and maneuver instruction into one visual cue hierarchy.
- [x] Add deterministic framework-neutral cue planning for simple turns, merges, splits, ramps, U-turns, and roundabouts.
- [x] Keep alternative branches muted and selected branches dominant in complex junctions.

## Alpha 140 — Route-Ahead Visual Continuity — COMPLETED
- [x] Extend the driver-first physical lane focus farther ahead without turning the whole route into a glowing ribbon.
- [x] Blend junction exit cues back into normal road geometry smoothly.
- [x] Preserve scene streaming/LOD budgets while keeping the next maneuver visually legible before it becomes near-field.
- [x] Add deterministic validation for consecutive maneuvers and back-to-back junctions.

## Alpha 141 — Multi-Maneuver Scene Choreography — COMPLETED
- [x] Coordinate current, next, and following maneuvers with explicit visual priority.
- [x] Suppress following previews when decisions are too closely spaced.
- [x] Compress the next maneuver preparation window when another decision follows soon after.
- [x] Keep choreography renderer-neutral and reuse the existing route-ahead physical lane surface.
- [x] Add deterministic validation for dense urban maneuver sequences.

## Alpha 142 — Predictive Junction Approach — COMPLETED
- [x] Use driver speed and route progress to tune when junction cues become prominent.
- [x] Make preparation cues feel spatially stable rather than index-dependent.
- [x] Validate slow traffic, stop-and-go, and high-speed approach behavior.

## Next — Alpha 143: Adaptive Scene Confidence
- [ ] Blend lane/junction confidence into cue strength without causing visual jitter.
- [ ] Gracefully reduce physical guidance when map matching or OSM topology is uncertain.
- [ ] Validate degraded-data scenarios while preserving the driver-first road hierarchy.

## Alpha 143 — Adaptive Scene Confidence (complete)
- [x] Fuse lane, topology, GPS, and scene-coverage confidence for immersive guidance.
- [x] Scale lane/branch visual authority without changing navigation decisions.
- [x] Keep uncertain topology visually restrained.
- [x] Add deterministic confidence tests.

## Alpha 144 — Confidence-Aware Route Recovery (complete)
- [x] Use confidence drops to trigger graceful route/scene recovery cues.
- [x] Distinguish stale scene data from uncertain lane matching.
- [x] Preserve continuity while confidence recovers.

## Alpha 145 — Driver Trust & Guidance Fallback (complete)
- [x] Make fallback hierarchy explicit when lane/topology data is unavailable.
- [x] Prevent low-confidence cues from competing with authoritative road geometry.
- [x] Validate fallback transitions and severe GPS-confidence scenarios.


## Alpha 146 — Guidance Consistency & Transition Smoothing (complete)
- [x] Cross-fade lane, junction, route, and maneuver visual authority.
- [x] Preserve continuity during confidence/fallback changes.
- [x] Reset smoothing between unrelated maneuver corridors.

## Alpha 147 — Uncertainty-Aware Scene Composition — COMPLETED
- [x] Make uncertain world objects and guidance visually subordinate without removing useful context.
- [x] Coordinate recovery, trust, and scene streaming into one deterministic composition policy.
- [x] Reduce world detail, traffic/infrastructure emphasis, and billboard competition when confidence degrades.
- [x] Add deterministic composition tests for high-confidence, degraded-GPS, and stale-scene states.

### Next — Alpha 148 — Scene Freshness & Recovery Continuity
- [ ] Make cached/provided scene freshness explicit instead of treating missing timestamps as implicitly fresh.
- [ ] Preserve composition continuity across scene swaps and recovery transitions.
- [ ] Add deterministic freshness/recovery lifecycle tests.


### Alpha 148 — Scene Freshness & Recovery Continuity
- [x] Explicit scene freshness tracking
- [x] Aging/stale world-detail degradation
- [x] Stale cached scene invalidation and refetch
- [x] Deterministic freshness tests

**Next focus:** adaptive scene reacquisition and seamless multi-bubble handoff under movement.

### Alpha 149 — Adaptive Scene Reacquisition & Bubble Handoff
Completed: movement-aware scene bubble planning, bounded warm/handoff overlap, stale bubble replacement, quality-budgeted bubble sets, and delayed retirement of old chunks to avoid hard scene swaps.

### Alpha 150 — Predictive Scene Prefetch & Seamless Transition
- [x] Predict scene demand from route geometry, speed and heading.
- [x] Quality-budget predictive target generation.
- [x] Bias bubble reacquisition toward the forward route corridor.
- [x] Feed predictive targets into network scene prefetch with legacy fallback coverage.
- [x] Add deterministic predictive-prefetch tests.

**Next focus:** predictive scene lifecycle optimization, renderer object pooling, and long-drive memory/GC validation.


### Alpha 151 — Adaptive Scene Residency & Long-Drive Stability — COMPLETED
- [x] Quality-tier scene residency budgets and deterministic eviction.
- [x] Protect current/forward chunks during handoff.
- [x] Bound long-drive scene memory with explicit Cesium cleanup.
- [x] Introduce stable scene-object identity primitives.

### Alpha 152 — Cross-Bubble Physical Object Identity — COMPLETED
- [x] Stable OSM/node/geometry identities for scene objects.
- [x] De-duplicate overlapping OSM extracts before spatial chunk ownership.
- [x] Preserve deterministic physical identity across absolute chunk keys.
- [x] Add deterministic cross-bubble duplicate tests.

**Next focus:** predictive scene lifecycle optimization, renderer object pooling, and long-drive memory/GC validation.

### Alpha 153 — Renderer Object Pooling — COMPLETED
- [x] Bound and reuse Cesium scene container allocations.
- [x] Clear pooled containers before reuse.
- [x] Return evicted/stale/handoff containers to the pool.
- [x] Add deterministic pooling tests.

**Next focus:** long-drive memory/GC stress validation and asynchronous scene lifecycle hardening.
