#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "[1/5] Checking required project directories..."
test -d frontend && test -d backend && test -d scripts
echo "[2/5] Checking navigation intelligence modules..."
for f in frontend/src/navigation/spatialMemory.ts frontend/src/navigation/routeDecisionIntelligence.ts frontend/src/navigation/intersectionIntelligence.ts frontend/src/navigation/routeIntelligenceGraph.ts frontend/src/navigation/intelligencePresentation.ts; do test -f "$f"; done
echo "[3/5] Checking database migrations..."
test -f backend/migrations/003_spatial_observation_ledger.sql
test -f backend/migrations/004_spatial_observation_retention.sql
echo "[4/5] Checking frontend manifest..."
test -f frontend/package.json
echo "[5/5] Checking release docs..."
test -f STREEPT_FINAL_RELEASE_STATUS.md
echo "STREEPT FINAL STRUCTURAL CHECK: PASS"
