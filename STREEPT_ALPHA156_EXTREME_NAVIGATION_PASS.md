# Streept Alpha 156 — Extreme GPS / Route / Intersection Scenarios

Implemented a framework-neutral recovery layer for difficult navigation states.

- GPS jumps widen matching and cap visual confidence while requesting reacquisition.
- U-turns and route reversals can move route progress backward instead of fighting the driver.
- Low-speed/stopped fixes use a narrower stable matching window.
- Difficult reversals widen the local route matcher window.
- Added deterministic tests for GPS jumps, U-turns, stopped states, and reversal matching.
- Integrated scenario policy into NavigationEngine without coupling it to React/Cesium.
