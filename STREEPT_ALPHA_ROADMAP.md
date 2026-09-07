# Streept Alpha — Product Engineering Roadmap

This milestone shifts Streept from a collection of UI features toward a navigation product core.

## Completed in this branch

- Explicit navigation session state guarded by a ref so asynchronous route requests cannot reset an active trip to preview mode.
- Stale route responses are ignored using monotonically increasing request IDs.
- New destination/start selections terminate the previous navigation session cleanly.
- Reroutes preserve the active session.
- Live navigation does not re-run the planning effect from a stale custom start.
- Open terrain is used by the immersive renderer when available, with a safe ellipsoid fallback.
- Physical-width OSM road ribbons, lane separators, curbs, road hierarchy, terrain lighting and high-DPI rendering improve the driving scene.
- Navigation guidance is painted last so the route remains visually dominant.

## Next engineering milestones

1. Replace boolean navigation flags with a typed state machine. **Completed in Alpha 66.**
2. Build a proper map-matching layer for noisy GPS and tunnel/dead-reckoning continuity. **Alpha 67: short-horizon GPS continuity/dead-reckoning added; advanced sensor fusion remains.**
3. Generate maneuver scene tiles server-side from OSM extracts instead of querying public Overpass at runtime. **Alpha 70: server-side tile store + tile endpoint + local-first scene-context path added; production extract generation/import remains.**
4. Add lane-level topology and intersection graph intelligence. **Alpha 68: local legal lane graph + shortest-path lane transitions added; richer intersection connectivity remains.**
5. Build a streaming scene cache/CDN with local high-detail bubbles around the next maneuver.
6. Add deterministic visual regression tests for every navigation state.
7. Package the navigation core independently of the React renderer so native clients can share the same behavior.

## Infrastructure principle

OSM data is free, but OSM's public tile servers are community-funded and best-effort. Production Streept should ingest/open-data into infrastructure we control rather than depending on public OSM endpoints for scale. See the OSM tile policy for the current requirements.


## Alpha 48 completed
Driver-grade location handling, GPS quality status, and navigation map-follow behavior are now integrated.

## Alpha 49 completed
Offline-first application shell and install metadata are integrated.

## Alpha 54 completed
- Shared immersive scene cache and maneuver prefetch.
- Batched OSM road corridors for lower Cesium entity overhead.

## Alpha 55 — Spatial Rendering Pass

Immersive road-context primitives are batched to reduce Cesium entity overhead and improve first-person scene scalability.


## Alpha 70 completed
- Server-side pre-generated scene tile store and deterministic tile addressing.
- Local-first immersive scene serving with Overpass retained only as development fallback.

## Alpha 63 completed
- Driver-aware lane estimation and lane-change guidance.
- Lane topology contract carries OSM turn/change/destination lane metadata.
- Immersive lane markings batched as primitives.
- Maneuver-local building LOD and turn-lane arrows.
- Regression scenario matrix for difficult navigation sessions.


## Alpha 71 — Scene streaming
- Completed bounded LRU/TTL immersive scene cache and spatial high-detail bubble prefetch.
- Remaining: CDN/object-store delivery and full device performance validation.

## Alpha 72 — Visual regression contract
- Added a renderer-independent deterministic visual navigation state contract.
- Lifecycle, maneuver urgency, GPS warning, lane-confidence and immersive-preview presentation are snapshot tested.
- This is the deterministic foundation for browser screenshot regression; browser screenshot tooling remains optional for CI.


### Alpha 73 — Framework-neutral navigation core
- **Completed.** Added `NavigationEngine` and moved lifecycle, GPS acceptance/matching, continuity, progress/ETA, and health orchestration behind a renderer-independent API. `NavigationView` now acts as a React adapter.

## Alpha 74
- 3D lane intelligence bridge completed; physical lane connector topology remains.

## Alpha 75
- Immersive scene performance budgets and deterministic route sampling completed.
- Dense OSM objects are prioritized by distance to the upcoming maneuver before rendering.
- Remaining: device/GPU profiling and CDN/object-store delivery.

## Alpha 76
- Physical-lane connector abstraction completed at the navigation/renderer boundary.
- Added explicit connector topology with confidence/source metadata and deterministic geometry.
- Current connector geometry is inferred from route/lane metadata; true OSM physical connector ingestion remains a production-data enhancement.

### Alpha 77
- Production scene delivery path completed at the client boundary.
- Added deterministic Web-Mercator tile addressing and optional CDN/object-store URL template.
- Scene loading order is local cache -> CDN tile -> backend pre-generated tile -> development Overpass-backed fallback.
- Provider-specific storage remains deployment configuration rather than application logic.

### Alpha 78 — Final integration and hardening
- Added a cross-layer navigation integration contract covering lifecycle -> GPS matching -> lane/3D scene guidance -> visual presentation.
- Added reroute/arrival integration coverage to ensure active sessions survive reroutes and terminate deterministically.
- Verified the frontend source set with the installed global TypeScript compiler; dependency-resolution diagnostics remain expected because `node_modules` is intentionally absent from the archive.
- Verified the final archive with ZIP integrity checks.

## Final Alpha status
The major application-layer navigation foundation is complete through Alpha 78. The remaining work is primarily production validation and data/infrastructure hardening: real OSM extract ingestion, true physical lane connector topology from OSM node/way relationships, advanced sensor fusion, browser/GPU profiling, and deployment-specific CDN/object-store operations.

## Alpha 80 — Deep lane topology + route-wide lane planning
- Added OSM way/node identity to scene roads so junctions can be anchored to real shared nodes.
- Added physical lane topology extraction/rendering from shared OSM junction nodes.
- Added route-wide lane planning that carries lane intent across maneuvers and explicitly lowers confidence when continuity cannot be established.
- Integrated physical junction connectors into the Cesium scene with inferred geometry as a fallback-safe renderer layer.
- Added regression coverage for route-wide lane planning.

## Alpha 82 — Production lane routing + 3D lane geometry
- Added curvature-following lane centerline generation from OSM road geometry.
- Physical junction connectors now use multi-point lane corridors instead of three-point straight approximations.
- Route-wide lane planning exposes actionable lane-change windows tied to maneuver distance.
- Lane-change windows now distinguish preparation, change-now, too-late, and unknown states.
- 3D guidance can consume topology-grounded lane corridors while retaining inferred fallback geometry.
- Remaining deep work: richer legal turn/merge restrictions, bidirectional carriageway semantics, lane-split/merge modeling, and real-world lane-data validation.

## Alpha 83 — Legal Intersection & Merge Intelligence
- Added `laneIntersectionIntelligence.ts` for conservative legal lane transition matrices, intersection classification, and shortest legal adjacent lane-change sequences.
- Lane routing now consults explicit lane-change/turn-lane legality before scheduling a lane-change window.
- Added regression coverage for forbidden and legal adjacent lane transitions.
- Complex junction physical topology remains authoritative where OSM node connectivity is available; lane metadata is treated as a legality constraint rather than a substitute for physical geometry.


## Alpha 84 — Junction Geometry & Complex Maneuvers
- Smooth tangent-based physical lane connectors through junctions.
- Explicit geometry classification for turns, roundabouts, merges, splits, ramps, and U-turns.
- Outgoing-road selection is scored against maneuver bearing before connector generation.
- Connector length/confidence is exposed to the 3D guidance layer.
- Regression coverage added for curved and roundabout connector geometry.

## Alpha 85 — Advanced Junction Behavior
- Added conservative junction behavior classification for roundabouts, merges, splits, ramps, U-turns, and ordinary turns.
- Lane-change windows now reserve larger approach buffers for merges, splits, ramps, roundabouts, and U-turns.
- 3D scene guidance exposes junction behavior so renderers can distinguish entry/exit and merge/split behavior.
- Lane changes are explicitly disallowed inside junction behavior corridors; missing OSM restrictions lower confidence instead of inventing prohibitions.


## Alpha 86 — Real OSM Turn Restrictions & Connectivity
- Added OSM restriction relation extraction to the maneuver-local scene payload.
- Scene roads retain way/node identity and scene restrictions now carry from/to/via members.
- Added a frontend restriction evaluator for simple via-node `no_*` and `only_*` turn restrictions, including explicit vehicle exceptions.
- Physical lane connectors now exclude transitions prohibited by authoritative OSM restrictions instead of drawing physically connected but legally forbidden movements.
- Multi-way restrictions are preserved and surfaced as unresolved until route-sequence state can evaluate them safely; the engine does not guess.
- Added regression coverage for prohibited, allowed, `only_*`, via-node mismatch, and multi-way unresolved cases.

- **Alpha 87 — Multi-way OSM restrictions + carriageway semantics:** ordered from/via/to restriction sequences, oneway=-1 handling, directionally valid shared-node connectivity, and conservative U-turn support.

## Alpha 88 — Route-wide OSM restriction graph
- Added deterministic route-sample to OSM scene-way sequence derivation.
- Route-wide lane planning now consumes ordered OSM way restriction state instead of treating restrictions as only local junction metadata.
- Definite OSM prohibitions can make affected maneuver/lane-plan steps unreachable; ambiguous coverage remains confidence-weighted.
- Scene guidance and the 3D layer consume the same restriction-aware lane route plan.
- Added regression coverage for route-to-scene way sequence derivation.
- Segment-level OSM way matching and persistent `NavigationEngine` way-sequence state completed.
- Navigation snapshots now expose current OSM way identity and restriction evaluation status.
- Remaining: stronger reroute-boundary restriction validation and production OSM coverage/latency validation.

## Alpha 89 — Segment-level OSM way matching & persistent way state
- Added point-to-road-segment matching instead of vertex-only route-to-way mapping.
- Added continuity-aware OSM way matching to reduce parallel-carriageway flips.
- `NavigationEngine` now owns persistent current-way and recent-way sequence state.
- GPS and dead-reckoned updates advance OSM way state independently of UI/renderers.
- Navigation snapshots expose way identity and restriction evaluation state for downstream lane/3D consumers.
- Added regression coverage for segment matching and persistent way transitions.


### Alpha 90 — Reroute Restriction Boundary Validation
- Hard route-generation boundary for OSM way/restriction history.
- Separate planned way sequence/restriction validation from traveled GPS topology.
- Scene refresh preserves active way history while recomputing planned topology.


## Alpha 91 — Direction-aware OSM segment matching
- Segment-level way matching now records travel direction.
- `oneway` and `oneway=-1` semantics are enforced during scene matching.
- Bidirectional ways use route/GPS heading to resolve traversal direction.
- NavigationEngine passes heading into persistent way matching.

## Alpha 92 — Directional physical lane graph
- Added a route-wide physical lane graph keyed by directed OSM way transitions and lane indices.
- Lane edges are anchored to shared OSM junction nodes and respect one-way/reverse-way traversal semantics.
- OSM `no_*` / `only_*` restrictions are evaluated before lane transitions are marked legal.
- Lane-route planning now consumes physical lane transition legality instead of treating route-way restrictions as a separate check.
- Added regression coverage for directional connectivity and restricted lane transitions.

## Alpha 93 — Lane split/merge continuity
- Added explicit lane continuity candidates for equal-count, split, merge, and lane-drop transitions.
- Increased lane counts no longer imply arbitrary one-to-one correspondence for newly created lanes.
- Decreased lane counts model convergence into surviving lanes with explicit merge costs.
- Added regression coverage for 2→3 and 3→2 physical lane transitions.

## Alpha 95 — Immersive 3D Driver Foundation
- Driver-perspective Cesium camera follow
- Live generated vehicle marker + heading
- Adaptive look-ahead for turn previews

## Alpha 96 — 3D Lane Rendering Integration
- Bind physical lane graph edges to rendered lane connectors
- Direction-aware lane ribbon selection

## Alpha 97 — Deep 3D Junction Navigation
- Driver-perspective junction transitions
- Lane-level turn path animation


## Alpha 99 — Destination-Aware Lane Intelligence
Implemented destination:lanes matching, destination-aware physical connector selection, and meter-based lane-change timing.

## Alpha 100 — Driver Lane Intelligence
- Live GPS-to-physical-lane matching with heading-aware OSM way selection.
- Current lane propagated into NavigationEngine, Cesium lane highlighting, and voice guidance.

## Alpha 101 — Lane-Change Execution Intelligence
- Stateful prepare/changing/completed/missed lane-change execution.
- Stable-lane hysteresis and low-confidence holding.
- Missed required lane changes feed the existing guarded reroute pipeline.

## Alpha 102 — Physical Lane Matching & 3D Lane-Change Trajectory
- True point-to-segment GPS projection for physical lane matching.
- Segment progress retained for better curved-road continuity.
- Geographic source-to-target lane-change trajectory in the Cesium driver view.
- Immersive HUD reflects lane-change execution state.

## Alpha 103 — Network Lane Continuity
- Persist physical lane identity across OSM way boundaries.
- Model lane-count changes as merge/split continuity with confidence.
- Keep carriageway orientation changes conservative.


## Alpha 105 — Physical Junction Lane Geometry
- Junction continuity now carries explicit physical connector geometry through shared OSM nodes.
- 3D lane corridors reuse junction-aware geometry for turns, merges, splits, ramps, roundabouts, and U-turns.
- Geometry confidence is propagated into lane identity confidence.

## Alpha 107 — Complex Junction & Roundabout Continuity
- Added physical circular-arc geometry for roundabout/rotary lane connectors.
- Roundabout arcs use tangent-consistent direction and adaptive geographic sampling.
- Preserved restriction, lane-semantic, and directional legality from the junction lane graph.
- Added regression coverage for sampled roundabout geometry.

## Alpha 108 — Physical Lane-Change Trajectory
- Geographic source/target lane centerline trajectory
- Physical runway validation
- Smooth lane-change motion in Cesium
- Lane-change trajectory confidence/reachability

## Alpha 109 — GPS + Lane-Level Tracking Hardening
- Temporal lane observation hysteresis instead of trusting individual GPS lane estimates.
- GPS accuracy, physical match distance, heading error, and low-speed uncertainty feed lane confidence.
- Weak fixes hold the last stable lane; repeated strong fixes are required for lane changes and way transitions.
- Current lane matching now exposes physical distance and heading error separately from the composite match score.

## Alpha 110 — Physical Lane-Change Execution
- [x] Physical lane-change reachability gate.
- [x] Feed scene trajectory into live execution state.
- [x] Propagate reachability confidence and execution start distance.
- [x] Vehicle-dynamics and traffic-aware lane-change safety model.

## Alpha 111 — Vehicle Dynamics + Lane-Change Safety
- [x] Speed-aware lane-change dynamics heuristic.
- [x] Reaction and braking runway calculation.
- [x] Lateral acceleration/rate safety limits.
- [x] Feed dynamics confidence and recommended speed into live execution.

## Alpha 112 — Adjacent Traffic + Cooperative Lane-Change Safety
- [x] Optional lane-positioned vehicle observation model with freshness/confidence gating.
- [x] Target-lane occupancy blocks unsafe lane changes.
- [x] Closed-lane community reports block affected lane-change trajectories.
- [x] Accident/construction reports add conservative traffic caution.
- [x] Feed traffic safety into live physical lane-change execution.
- [ ] Unified maneuver decision layer across lane, dynamics, traffic, and rerouting.



## Alpha 113 — Unified Maneuver Decision Engine
- [x] Combine lane timing, physical reachability, vehicle dynamics, GPS confidence, and traffic safety.
- [x] Produce deterministic prepare/change/uncertain/reroute decisions.
- [x] Feed unified decision into live lane-change execution.
- [ ] End-to-end maneuver simulation and vehicle/traffic data integration.


## Alpha 114 — GPS + Sensor-Fusion Hardening
- [x] Lightweight GPS + motion speed/heading fusion.
- [x] Reject stale and implausible motion samples.
- [x] Confidence from GPS quality and sensor agreement.
- [x] Integrate fused motion into NavigationEngine.
- [ ] Platform-specific calibrated IMU integration.

## Alpha 115 — Route-Wide Lane Planning Refinement
- [x] Bounded lookahead lane strategy across multiple maneuvers.
- [x] Penalize unnecessary lane changes and lane oscillation.
- [x] Preserve lane choices that remain useful for upcoming maneuvers.
- [x] Expose planned/next lane and strategy stability to shared route guidance.
- [ ] Replace index-only long-range continuity with richer physical-lane identity and live traffic costs.

## Alpha 116 — Complex Intersection Lane Resolution
- [x] Detect lane-count changes, merges, splits and ramp/slip-lane transitions.
- [x] Resolve lane identity through physical junction mappings instead of blindly carrying lane indexes.
- [x] Reduce confidence when semantic lane targets disagree with physical continuity.
- [x] Handle closely spaced maneuvers conservatively.
- [x] Refuse continuity when directionality/restrictions make the physical transition illegal.
- [ ] Full production-grade lane-link extraction from OSM relations and turn:lanes:lanes:backward/forward variants.

## Alpha 117 — End-to-End Navigation Simulation [x]
- [x] deterministic ground-truth route simulator
- [x] GPS noise/accuracy simulation
- [x] sensor-fusion inputs
- [x] configurable GPS dropout windows
- [x] route matching + continuity exercised end-to-end
- [x] monotonic progress and completion assertions
- [ ] multi-scenario lane/traffic simulation

## Alpha 118 — Multi-Scenario Navigation Simulation
- [x] clean and degraded-GPS drive scenarios
- [x] extended GPS dropout/continuity scenario
- [x] explicit target-lane occupancy safety scenario
- [x] closed-lane community-report safety scenario
- [x] complex lane-count merge scenario
- [x] deterministic pass/fail regression contract across navigation subsystems
- [ ] time-stepped lane-change execution + reroute replay

## Alpha 119 — Time-Stepped Maneuver Replay
- Deterministic frame-by-frame lane-change execution replay
- Prepare/changing/completed state progression
- Dynamic target-lane blocking and recovery
- Too-late maneuver -> guarded reroute replay
- GPS dropout/continuity during maneuver execution
- Production NavigationEngine execution API exercised per timestep

## Alpha 120 — Route-Wide Navigation Replay
- [x] Replay successive lane-change maneuvers on one navigation session.
- [x] Carry lane execution across synthetic junction boundaries.
- [x] Change multi-vehicle occupancy during the replay and recover after blockers clear.
- [x] Trigger guarded rerouting onto a replacement route after a missed maneuver.
- [x] Keep GPS dropout/continuity inside the same route-wide replay timeline.
- [ ] Replace synthetic maneuver positions with live route maneuver geometry and richer per-lane vehicle tracks.


## Alpha 125 — Provider-Neutral Vehicle Telemetry
- [x] Define a backend lane-positioned vehicle observation contract.
- [x] Add TTL-bounded server storage for real telemetry observations without synthetic vehicles.
- [x] Add geo-filtered `/traffic/vehicles` resync endpoint.
- [x] Add lane-aware vehicle WebSocket update/remove events.
- [x] Normalize fresh vehicle observations into lane-change safety occupants.
- [x] Keep missing lane identity conservative rather than guessing a target lane.
- [ ] Connect an actual external vehicle telemetry provider/adapter.

- Alpha 130 — route-ahead 3D scene prefetch (completed)

## Alpha 131 — Live traffic visual realism + performance — COMPLETED
- Smooth telemetry interpolation and bounded extrapolation.
- Out-of-order/teleport rejection and confidence decay.
- Driver-facing/maneuver-aware traffic prioritization with a bounded immersive render budget.
