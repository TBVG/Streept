# Streept Alpha 92 — Directional Physical Lane Graph

Alpha 92 connects the OSM way/restriction graph to lane-level route planning. A route's ordered directed way sequence is converted into physical lane-to-lane edges at shared junction nodes. One-way and reverse-way semantics are enforced before an edge can be used, and the existing OSM restriction evaluator is authoritative for `no_*` and `only_*` transitions. Lane routing consumes this graph alongside OSRM lane metadata, so legal road connectivity and lane guidance now share the same directional topology.
