$ErrorActionPreference = 'Stop'

Write-Host '== STREEPT LOCAL VERIFICATION ==' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm is required.' }

Write-Host "Node: $(node --version)"
Write-Host "npm:  $(npm --version)"

if (Get-Command tsc -ErrorAction SilentlyContinue) {
  Write-Host '`n[0/4] Verifying dependency-independent navigation core...' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'verify-navigation-core.ps1')
}

Push-Location frontend
try {
  Write-Host '`n[1/4] Installing frontend dependencies...' -ForegroundColor Yellow
  npm install --no-audit --no-fund

  Write-Host '`n[2/4] Running frontend unit tests...' -ForegroundColor Yellow
  npm test

  Write-Host '`n[3/4] Building frontend...' -ForegroundColor Yellow
  npm run build
} finally {
  Pop-Location
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Warning 'Docker is not installed/in PATH. Frontend/backend checks passed; skipping Docker smoke test.'
  exit 0
}

try { docker info | Out-Null } catch { Write-Warning 'Docker is installed but the Docker daemon is not running. Skipping Docker smoke test.'; exit 0 }
Write-Host '`n[4/4] Building and starting the full Docker stack...' -ForegroundColor Yellow
docker compose config | Out-Null
try {
  docker compose up --build -d
} catch {
  Write-Host '`n--- DOCKER STARTUP DIAGNOSTICS ---' -ForegroundColor Red
  docker compose ps -a
  throw
}

try {
  $backendOk = $false
  $frontendOk = $false
  for ($i = 0; $i -lt 30; $i++) {
    try { if ((Invoke-WebRequest -UseBasicParsing http://localhost:3001/health -TimeoutSec 3).StatusCode -eq 200) { $backendOk = $true } } catch {}
    try { if ((Invoke-WebRequest -UseBasicParsing http://localhost:3000/health -TimeoutSec 3).StatusCode -eq 200) { $frontendOk = $true } } catch {}
    if ($backendOk -and $frontendOk) { break }
    Start-Sleep -Seconds 2
  }

  if (-not $backendOk) {
    Write-Host '`n--- BACKEND CONTAINER DIAGNOSTICS ---' -ForegroundColor Red
    docker compose ps -a
    docker compose logs --no-color --tail=200 backend
    throw 'Backend health check failed: http://localhost:3001/health'
  }
  if (-not $frontendOk) {
    Write-Host '`n--- FRONTEND CONTAINER DIAGNOSTICS ---' -ForegroundColor Red
    docker compose ps -a
    docker compose logs --no-color --tail=200 frontend
    throw 'Frontend health check failed: http://localhost:3000/health'
  }

  Write-Host '`nDocker smoke test PASSED.' -ForegroundColor Green
  docker compose ps
} finally {
  Write-Host '`nStack is left running so you can open http://localhost:3000 and test the app.' -ForegroundColor Cyan
}
