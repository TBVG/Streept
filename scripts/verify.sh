#!/usr/bin/env bash
set -euo pipefail

printf '\n== STREEPT LOCAL VERIFICATION ==\n'
command -v node >/dev/null || { echo 'Node.js is required.'; exit 1; }
command -v npm >/dev/null || { echo 'npm is required.'; exit 1; }
printf 'Node: '; node --version
printf 'npm:  '; npm --version

if command -v tsc >/dev/null; then
  printf '\n[0/4] Verifying dependency-independent navigation core...\n'
  ./scripts/verify-navigation-core.sh
fi

pushd frontend >/dev/null
printf '\n[1/4] Installing frontend dependencies...\n'
npm install --no-audit --no-fund
printf '\n[2/4] Running frontend unit tests...\n'
npm test
printf '\n[3/4] Building frontend...\n'
npm run build
popd >/dev/null

if ! command -v docker >/dev/null; then
  echo 'Docker not found; frontend checks passed, skipping Docker smoke test.'
  exit 0
fi

docker info >/dev/null
printf '\n[4/4] Building and starting the full Docker stack...\n'
docker compose config >/dev/null
docker compose up --build -d

cleanup() { echo; echo 'Stack is left running so you can open http://localhost:3000 and test the app.'; }
trap cleanup EXIT

for i in {1..30}; do
  if curl -fsS http://localhost:3001/health >/dev/null 2>&1 && curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
    echo 'Docker smoke test PASSED.'
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo 'Docker health check failed.'
docker compose ps
exit 1
