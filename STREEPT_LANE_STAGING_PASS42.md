# Streept Lane Staging — Pass 42

Pass 42 hardens lane-level execution and restores route-aware intersection topology.

## Built
- Multi-lane destination requests are staged into adjacent lane transitions.
- Physical execution never asks the trajectory layer to jump directly across multiple lanes.
- Lane-change execution now rejects every observed multi-lane matcher jump as unconfirmed, not only jumps that land directly on the final target.
- Intersection intelligence prefers the route's planned next OSM way when determining the outgoing road, reducing false topology from nearby parallel/distractor roads.
- Route replacement resets maneuver-outcome edge detection and computes planned way sequence before spatial intelligence refresh.

## Safety rule
A final destination lane may be two or more lanes away, but the vehicle must progress through adjacent lanes: `0 -> 1 -> 2`, never `0 -> 2` as one physical transition.

## Data policy
No paid service or new external API was added.
