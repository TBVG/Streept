$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '== STREEPT RUST STRUCTURE CHECK ==' -ForegroundColor Cyan

$navigationFile = Join-Path $root 'backend/src/navigation.rs'
$navigationDir = Join-Path $root 'backend/src/navigation'

if ((Test-Path $navigationFile) -and (Test-Path $navigationDir)) {
  throw 'Invalid Rust module layout: backend/src/navigation.rs and backend/src/navigation/ both exist.'
}
if (-not (Test-Path (Join-Path $navigationDir 'mod.rs'))) { throw 'Missing backend/src/navigation/mod.rs' }
if (-not (Test-Path (Join-Path $navigationDir 'geometry.rs'))) { throw 'Missing backend/src/navigation/geometry.rs' }
if (-not (Test-Path (Join-Path $navigationDir 'route_decision.rs'))) { throw 'Missing backend/src/navigation/route_decision.rs' }
if (-not (Test-Path (Join-Path $navigationDir 'runtime.rs'))) { throw 'Missing backend/src/navigation/runtime.rs' }

$lib = Get-Content (Join-Path $root 'backend/src/lib.rs') -Raw
if ($lib -notmatch '(?m)^pub mod navigation;\s*$') { throw 'backend/src/lib.rs does not expose the navigation module.' }

$routes = Get-Content (Join-Path $root 'backend/src/routes.rs') -Raw
if ($routes -notmatch '"/navigation/analyze"') { throw 'Navigation analysis endpoint is not registered.' }
if ($routes -notmatch '"/navigation/decision"') { throw 'Navigation decision endpoint is not registered.' }
if ($routes -notmatch '"/navigation/session"') { throw 'Navigation session endpoint is not registered.' }
if ($routes -notmatch '"/navigation/session/:session_id/step"') { throw 'Navigation session step endpoint is not registered.' }
if ($routes -notmatch '"/navigation/session/:session_id/context"') { throw 'Navigation session context endpoint is not registered.' }

$bridge = Join-Path $root 'frontend/src/navigation/rust/navigationEngineApi.ts'
if (-not (Test-Path $bridge)) { throw 'Missing Rust navigation browser bridge.' }

Write-Host 'Rust navigation module layout: PASS' -ForegroundColor Green
Write-Host 'Rust HTTP endpoints: PASS' -ForegroundColor Green
Write-Host 'Browser bridge: PASS' -ForegroundColor Green
