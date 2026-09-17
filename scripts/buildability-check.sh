#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/4] Checking Docker Compose configuration"
if command -v docker >/dev/null 2>&1; then
  docker compose config >/dev/null
else
  echo "SKIP: docker is not installed"
fi

echo "[2/4] Checking frontend dependency manifest"
node -e "const p=require('./frontend/package.json'); if(!p.engines?.node) process.exit(1); console.log('Node engine:', p.engines.node)"

echo "[3/4] Checking shell syntax"
for f in scripts/*.sh; do bash -n "$f"; done

echo "[4/4] Runtime build commands"
if command -v npm >/dev/null 2>&1; then
  (cd frontend && npm run build)
else
  echo "SKIP: npm is not installed"
fi
