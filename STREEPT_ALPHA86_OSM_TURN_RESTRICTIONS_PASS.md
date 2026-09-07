# Streept Alpha 86 — Real OSM Turn Restrictions & Connectivity

Alpha 86 makes the physical junction layer aware of authoritative OSM restriction relations. The backend now extracts simple restriction relations alongside scene roads, including from/to way members, via nodes/ways, restriction type, and `except` modes.

The frontend evaluates those relations before generating physical lane connectors. `no_*` transitions are blocked, `only_*` relations exclude all other outgoing ways, and explicit motor-vehicle exceptions are respected. Multi-way restrictions are retained but remain unresolved until route-sequence context is available, preventing false legal claims.

This is an additive, backwards-compatible scene schema change: older tiles without `restrictions` deserialize as empty.
