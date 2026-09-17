#!/usr/bin/env python3
"""Split a SceneTile JSON export into deterministic Web-Mercator shard files."""
import json, sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: split-scene-tiles.py INPUT.json OUTPUT_DIR")
src, out = Path(sys.argv[1]), Path(sys.argv[2])
data = json.loads(src.read_text())
if not isinstance(data, list):
    raise SystemExit("input must be a JSON array of SceneTile records")
out.mkdir(parents=True, exist_ok=True)
for tile in data:
    tile_id = str(tile.get("id", ""))
    if tile_id.count("/") != 2:
        continue
    z, x, y = tile_id.split("/")
    target = out / z / x
    target.mkdir(parents=True, exist_ok=True)
    (target / f"{y}.json").write_text(json.dumps(tile, separators=(",", ":")))
print(f"Wrote scene shards to {out}")
