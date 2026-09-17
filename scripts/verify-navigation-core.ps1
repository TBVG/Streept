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
  "include": ["$root/frontend/src/vite-env.d.ts", "$root/frontend/src/navigation/**/*.ts", "$root/frontend/src/types.ts", "$root/frontend/src/utils/geo.ts"],
  "exclude": ["$root/frontend/src/navigation/**/*.test.ts"]
}
"@ | Set-Content -Encoding UTF8 $config
$axiosShim = Join-Path $env:TEMP 'streept-axios-shim.d.ts'
@'
declare module "axios" {
  export interface AxiosRequestConfig {
    baseURL?: string; timeout?: number; headers?: Record<string, string>; [key: string]: unknown;
  }
  export interface AxiosResponse<T = any> { data: T; status: number; statusText: string; headers?: Record<string, string>; config: AxiosRequestConfig; }
  export interface AxiosInstance {
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    interceptors: { request: { use(onFulfilled: (config: AxiosRequestConfig) => AxiosRequestConfig): unknown } };
  }
  interface AxiosStatic extends AxiosInstance { create(config?: AxiosRequestConfig): AxiosInstance; }
  const axios: AxiosStatic;
  export default axios;
}
'@ | Set-Content -Encoding UTF8 $axiosShim
$configJson = Get-Content $config -Raw | ConvertFrom-Json
$configJson.include += $axiosShim
$configJson | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $config
try { & $tsc.Source -p $config --pretty false; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Write-Host 'Navigation core typecheck PASSED.' -ForegroundColor Green }
finally { Remove-Item $config -Force -ErrorAction SilentlyContinue; Remove-Item $axiosShim -Force -ErrorAction SilentlyContinue }
