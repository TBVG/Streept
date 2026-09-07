# Streept Alpha 87 — Multi-way OSM Restrictions & Carriageway Semantics

Alpha 87 extends Alpha 86's OSM restriction support from simple junction relations to route-sequence-aware multi-way restrictions and directionally correct carriageway connectivity.

## Implemented

- Added ordered `from -> via way(s) -> to` restriction evaluation.
- Added `evaluateNextWayRestriction()` for route-history-aware enforcement.
- Multi-way `no_*` and `only_*` restrictions can now block the next way when the complete OSM way sequence matches.
- Added explicit OSM `oneway=-1` support to scene roads.
- Physical lane topology now checks whether a way can actually be approached or departed at the shared node according to OSM directionality.
- Prevents physically adjacent opposite-direction carriageways from being treated as legal outgoing roads merely because they share a node.
- Supports bidirectional U-turn connector candidates while preserving one-way restrictions.
- Existing simple via-node restriction behavior remains authoritative.
- Unknown/unmatched multi-way restriction state remains conservative rather than inventing a prohibition.

## Validation

- Navigation TypeScript syntax/transpile checks pass.
- Restriction regression tests cover multi-way `no_*` and `only_*` behavior.
- Backend model/query changes are structurally consistent with the existing Docker Rust build; local Cargo compilation is unavailable in this execution environment.
