import { Location, Route3DHighlight } from '../types';

/**
 * Navigation must only consume geometry that came from a real routing provider.
 * This intentionally rejects legacy/synthetic route objects even when their
 * coordinates look superficially plausible.
 */
export function isTrustedRoute(route: Route3DHighlight | null | undefined): boolean {
  if (!route || route.provider !== 'osrm') return false;
  const points = route.segments?.flatMap((segment) => segment?.coords ?? []) ?? [];
  if (points.length < 2) return false;
  return points.every((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    && point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180);
}

export function routePolyline(route: Route3DHighlight | null | undefined): Location[] {
  if (!isTrustedRoute(route)) return [];
  return route!.segments.flatMap((segment) => segment.coords.map((point) => ({ lat: point.lat, lng: point.lng })));
}
