# Streept Continuous Traffic Prediction — Pass 46

## What changed
Lane-change traffic safety now predicts target-lane occupants across the full physical lane-change trajectory rather than evaluating only a single merge point.

## Safety behavior
- Samples ego and occupant longitudinal positions across the maneuver duration.
- Uses heading-compatible longitudinal speed to project occupant motion.
- Detects conflicts that occur early, mid-maneuver, or late in the trajectory.
- Retains the direct closing-speed calculation for vehicles approaching before the sampled path.
- Opposing-direction observations remain an immediate conservative conflict.
- Static observations still use the existing longitudinal-gap gate when speed/heading are unavailable.

## Result
The traffic gate is now trajectory-aware: a lane change is rejected when a fresh, confident target-lane vehicle is predicted to enter the ego trajectory with insufficient longitudinal separation at any sampled point during the maneuver.
