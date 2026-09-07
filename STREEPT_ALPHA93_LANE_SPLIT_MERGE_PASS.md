# Streept Alpha 93 — Lane Split / Merge Continuity

Alpha 93 replaces proportional lane-count mapping with explicit physical continuity candidates. Equal-count ways preserve lane identity; lane increases model splits with conservative added-lane alternatives; lane decreases model merges/lane drops with higher-cost convergence edges. This keeps the route-wide physical lane graph usable across 2→3, 3→2, ramp-merge, and lane-drop transitions without inventing one-to-one correspondence where OSM does not provide it.

Validation: frontend navigation TypeScript transpile checks and lane graph regression coverage.
