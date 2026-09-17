param([Parameter(Mandatory=$true)][string]$PbfPath)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force routing-data | Out-Null
$base = [IO.Path]::GetFileNameWithoutExtension([IO.Path]::GetFileNameWithoutExtension($PbfPath))
Copy-Item $PbfPath "routing-data/$base.osm.pbf" -Force
docker run --rm -t -v "${PWD}/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/car.lua "/data/$base.osm.pbf"
docker run --rm -t -v "${PWD}/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-partition "/data/$base.osrm"
docker run --rm -t -v "${PWD}/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-customize "/data/$base.osrm"
Copy-Item "routing-data/$base.osrm" routing-data/region.osrm -Force
Write-Host 'Prepared routing-data/region.osrm'
