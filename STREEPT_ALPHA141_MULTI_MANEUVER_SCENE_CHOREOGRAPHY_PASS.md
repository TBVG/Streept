# STREEPT ALPHA 141 — Multi-Maneuver Scene Choreography

Alpha 141 coordinates the current, next, and following maneuvers as one renderer-neutral priority stack.

- The current maneuver owns the near field.
- The next maneuver receives a bounded preparation window.
- A following maneuver is only previewed when there is enough physical road between decisions.
- Closely spaced decisions compress the next preparation window instead of creating overlapping visual demands.
- The renderer reuses the existing route-ahead physical lane surface and simply constrains its active window/emphasis.
- Deterministic tests cover priority ordering, dense-junction suppression, and preparation-window compression.

This keeps dense urban routes readable without turning the immersive scene into a collection of simultaneous navigation overlays.
