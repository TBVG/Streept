# Streept Spatial Intelligence — Pass 25

## Goal
Turn the spatial decision into a calm, driver-facing explanation without replacing the normal turn instruction.

## Changes
- NavigationView now derives a single spatial cue from the NavigationEngine snapshot.
- The cue can explain: slow down, complex maneuver ahead, prepare for next move, or uncertain road information.
- Cue text uses only known evidence already present in the spatial snapshot; it does not invent speed limits or road facts.
- The same engine snapshot continues to feed the 2D and immersive navigation surfaces.
- Responsive styling keeps the cue clear on desktop and mobile.

## Free-by-default
No new external services, APIs, packages, or paid infrastructure were added.
