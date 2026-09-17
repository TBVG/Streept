# Streept Pass 49 — Live Route Lane Decision Loop

Pass 49 connects the route-wide lane strategy to the live navigation loop.

## What changed
- `NavigationEngineSnapshot` now exposes the current route-wide `routeLaneStrategy`.
- The strategy is recomputed whenever navigation spatial intelligence refreshes, using the latest matched lane and confidence.
- `NavigationView` uses the live strategy's planned lane for the active maneuver instead of always selecting the maneuver's first recommended lane.
- Existing lane staging still converts that final intent into one adjacent physical lane step at a time.
- Traffic safety, reachability, junction restrictions, and execution confidence remain authoritative after the live strategic target is selected.
- Added regression coverage for stable lane selection across multiple upcoming maneuvers.

## Result
Streept now has a continuous chain:

GPS/lane match → route-wide lane strategy → active maneuver target → adjacent physical lane staging → reachability/traffic safety → lane execution.

The strategy is advisory; safety and legality can still block or defer execution.
