#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSC_BIN="${TSC_BIN:-$(command -v tsc || true)}"
if [[ -z "$TSC_BIN" ]]; then
  echo 'TypeScript compiler (tsc) is required for the dependency-independent navigation check.' >&2
  exit 1
fi

TMP_CONFIG="$(mktemp)"
trap 'rm -f "$TMP_CONFIG"' EXIT
cat > "$TMP_CONFIG" <<JSON
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "allowImportingTsExtensions": true
  },
  "include": [
    "$ROOT_DIR/frontend/src/navigation/**/*.ts",
    "$ROOT_DIR/frontend/src/types.ts",
    "$ROOT_DIR/frontend/src/utils/geo.ts"
  ],
  "exclude": ["$ROOT_DIR/frontend/src/navigation/**/*.test.ts"]
}
JSON

echo '== STREEPT NAVIGATION CORE TYPECHECK =='
"$TSC_BIN" -p "$TMP_CONFIG" --pretty false
echo 'Navigation core typecheck PASSED.'
