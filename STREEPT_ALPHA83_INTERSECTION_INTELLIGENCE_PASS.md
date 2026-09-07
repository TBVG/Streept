# Streept Alpha 83 — Legal Intersection & Merge Intelligence

Implemented conservative intersection-aware lane legality. Lane routing now respects explicit OSM/OSRM lane-change permissions and turn-lane indications before producing lane-change windows. Added intersection classification and shortest legal adjacent lane sequences, with tests covering forbidden and legal transitions.

Validation: changed TypeScript sources pass syntax/transpilation checks. Full dependency build remains environment-dependent because node_modules is not included in the archive and Cargo is not installed in the execution environment.
