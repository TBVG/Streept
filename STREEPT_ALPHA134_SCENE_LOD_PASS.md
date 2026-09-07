# STREEPT Alpha 134 — Immersive Scene LOD + Visibility

Implemented camera-local level-of-detail for the Cesium immersive scene.

## What changed
- Added a framework-neutral `sceneLod` policy with near/mid/far/hidden tiers.
- Uses distance from the live driver location rather than the maneuver center for render LOD.
- Uses the current camera/route heading to cull far-field objects behind the driver.
- Large scene forms such as roads and buildings remain visible farther away.
- Lane markings, street lamps, signals, crossings, stops, and other small details disappear earlier.
- Far buildings use a lower extrusion cap and reduced opacity to avoid spending geometry/detail budget where it has little visual value.
- Road labels and lane arrows remain deliberately local to preserve navigation readability.
- Existing chunk reuse remains intact; LOD is applied inside each reusable chunk.
- Driver, guidance, and live traffic remain independent from static-scene LOD.

## Validation
- Framework-neutral LOD tests cover distance tiers, heading culling, and detail-specific falloff.
- Existing TypeScript transpilation validation should include the new module and updated immersive renderer.

## Remaining refinement
The next renderer pass can add camera-frustum-aware chunk activation and dynamic quality scaling from measured frame time. The current pass is deterministic and intentionally avoids frame-time feedback loops.
