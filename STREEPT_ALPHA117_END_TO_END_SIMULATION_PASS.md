# Streept Alpha 117 — End-to-End Navigation Simulation

Alpha 117 adds a deterministic drive simulator around the framework-neutral `NavigationEngine`.

## Covered path
- Synthetic ground-truth route progression at configurable speed/timestep.
- GPS accuracy and deterministic position noise.
- Heading + speed sensor input through the existing sensor-fusion layer.
- GPS dropout windows routed through the existing short-horizon continuity path.
- Real route matching and navigation health for every simulated sample.
- Monotonic progress regression detection.
- Final route-completion verification.

## Why this matters
The simulator is deliberately renderer-independent. It tests the navigation runtime as a system rather than testing individual lane/GPS modules in isolation. It is deterministic so future changes can compare the same drive profile without flaky random noise.

## Remaining limitation
This pass does not yet synthesize full OSM lane topology, live traffic, or vehicle-to-vehicle interaction. Those should be layered into later scenario profiles rather than replacing the base GPS simulation.
