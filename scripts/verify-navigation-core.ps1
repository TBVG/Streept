$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tsc = Get-Command tsc -ErrorAction SilentlyContinue
if (-not $tsc) { throw 'TypeScript compiler (tsc) is required for the dependency-independent navigation check.' }
$config = Join-Path $env:TEMP 'streept-navigation-core-tsconfig.json'
@"
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true, "allowImportingTsExtensions": true
  },
  "include": ["$root/frontend/src/navigation/**/*.ts", "$root/frontend/src/types.ts", "$root/frontend/src/utils/geo.ts"],
  "exclude": ["$root/frontend/src/navigation/**/*.test.ts"]
}
"@ | Set-Content -Encoding UTF8 $config
try { & $tsc.Source -p $config --pretty false; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host 'Navigation core typecheck PASSED.' -ForegroundColor Green }
finally { Remove-Item $config -Force -ErrorAction SilentlyContinue }
