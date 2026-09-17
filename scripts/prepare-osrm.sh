#!/usr/bin/env bash
set -euo pipefail
# Build a self-hosted OSRM MLD dataset from an OSM PBF. The resulting files
# belong in ./routing-data and can be served by the optional compose profile.
PBF="${1:-region.osm.pbf}"
BASE="$(basename "$PBF" .osm.pbf)"
mkdir -p routing-data
cp "$PBF" "routing-data/$BASE.osm.pbf"
docker run --rm -t -v "$PWD/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/car.lua "/data/$BASE.osm.pbf"
docker run --rm -t -v "$PWD/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-partition "/data/$BASE.osrm"
docker run --rm -t -v "$PWD/routing-data:/data" osrm/osrm-backend:v5.27.1 osrm-customize "/data/$BASE.osrm"
cp "routing-data/$BASE.osrm" routing-data/region.osrm
printf 'Prepared routing-data/region.osrm\n'
