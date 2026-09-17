# Streept Pass 28 — Route-Ordered Spatial Intelligence

## What changed

Streept's spatial intelligence now selects the **next maneuver in route order** instead of choosing whichever maneuver is geographically closest to the vehicle.

This matters at hairpins, roundabouts, parallel roads, and dense junctions where a maneuver that has already been passed can remain physically close to the vehicle.

## Driver impact

The map, 3D scene, and voice guidance can now stay focused on the maneuver the route actually reaches next.

## Safety behavior

- Uses the existing trusted route geometry.
- Uses route projection to determine progress.
- Does not invent missing road data.
- Falls back conservatively to spatial proximity only when route projection is unavailable.
- Treats a maneuver up to 18 m behind the projected position as passed, preventing immediate flip-back caused by small GPS noise.

## Cost

No paid API or service was added.
