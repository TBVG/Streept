# Streept Dynamic Lane-Step Replanning — Pass 44

## Built
- Multi-lane destination intent is now separated from the physical lane-change target.
- A request such as lane 0 → lane 2 is physically executed as 0 → 1 first, then 1 → 2 after the lane estimate confirms the intermediate step.
- Scene/immersive guidance now receives the staged adjacent target, so rendered trajectories cannot visually jump across multiple lanes.
- The final maneuver lane remains available as destination intent for subsequent replanning.
- Immersive runtime uses the same staging policy as the main navigation controller.
- Corrected the traffic-gap regression fixture so its “farther” occupant is actually beyond the longitudinal safety threshold.

## Safety behavior
- Lane-change execution still rejects observed GPS/lane jumps greater than one lane.
- A blocked first adjacent step does not authorize a direct jump to the final lane.
- Once the current lane becomes the intermediate lane, the next navigation cycle naturally stages the next adjacent step.

## Validation
- Source-level integration checks completed.
- The environment does not contain the project `node_modules`, so the full Vitest/TypeScript production build could not be executed here.
