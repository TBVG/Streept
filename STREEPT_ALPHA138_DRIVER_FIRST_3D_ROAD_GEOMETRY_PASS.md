# Streept Alpha 138 — Driver-First 3D Road Geometry

## Goal
Make the road the hero of the immersive driver view. The 3D environment should not merely reconstruct nearby objects; it should make the intended driving path physically understandable.

## Delivered
- Added a lightweight physical surface over the immediate selected route lane.
- Preferred destination-lane metadata, then recommended/current lane state, when choosing the highlighted lane.
- Added stronger visual emphasis for the upcoming physical junction connector.
- Reused the same lane/connector topology already consumed by navigation guidance.
- Preserved explicit lane-change trajectory visualization.
- Fixed the reactive immersive-scene render path so billboard inventory is passed into every rebuild.
- Kept the implementation inside the existing Cesium primitive/lifecycle pipeline rather than adding per-frame geometry churn.

## Performance
The new geometry is limited to the driver-to-maneuver corridor and a single selected connector. It remains subject to the existing adaptive render-quality and streamed scene budgets.

## Next
Alpha 139 will focus on junction comprehension: earlier branch readability, decision/exit zones, and unified visual cues across lane arrows, road geometry, signs, and maneuver instructions.
