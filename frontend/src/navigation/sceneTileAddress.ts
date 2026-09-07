import { Location } from '../types';

export const DEFAULT_SCENE_TILE_ZOOM = 17;

/** Stable Web-Mercator scene tile address shared by CDN and API delivery. */
export const sceneTileAddress = (location: Location, zoom = DEFAULT_SCENE_TILE_ZOOM): string | null => {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 90 || Math.abs(location.lng) > 180) return null;
  const z = Math.max(0, Math.min(22, Math.trunc(zoom)));
  const n = 2 ** z;
  const x = Math.max(0, Math.min(n - 1, Math.floor(((location.lng + 180) / 360) * n)));
  const latRad = location.lat * Math.PI / 180;
  const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  const y = Math.max(0, Math.min(n - 1, Math.floor(yFloat)));
  return `${z}/${x}/${y}`;
};
