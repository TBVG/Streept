import { GeocodeResult, Location, Route3DHighlight } from '../types';
import { haversineDistanceMeters, projectOntoPolyline } from '../utils/geo';
import { searchPlaces } from '../services/api';

export type SearchIntent =
  | 'general'
  | 'coffee'
  | 'food'
  | 'fuel'
  | 'parking'
  | 'ev'
  | 'hotel'
  | 'shopping'
  | 'pharmacy'
  | 'hospital'
  | 'attraction';

export interface SmartSearchResult extends GeocodeResult {
  intent: SearchIntent;
  context: 'nearby' | 'on-route' | 'destination';
  distanceMeters: number | null;
  routeDistanceMeters: number | null;
  distanceLabel: string;
  detourLabel?: string;
}

export interface SmartSearchOptions {
  userLocation?: Location | null;
  route?: Route3DHighlight | null;
  destination?: Location | null;
  maxResults?: number;
}

const INTENT_RULES: Array<{ intent: SearchIntent; terms: string[]; keywords: string[] }> = [
  { intent: 'coffee', terms: ['coffee', 'cafe', 'cafes'], keywords: ['coffee', 'cafe'] },
  { intent: 'food', terms: ['food', 'restaurant', 'restaurants', 'dinner', 'lunch', 'eat'], keywords: ['restaurant', 'food'] },
  { intent: 'fuel', terms: ['gas', 'fuel', 'petrol', 'diesel', 'gas station'], keywords: ['fuel', 'petrol', 'gas station'] },
  { intent: 'parking', terms: ['parking', 'park'], keywords: ['parking'] },
  { intent: 'ev', terms: ['ev', 'ev charger', 'charging', 'charger', 'electric vehicle'], keywords: ['ev charging', 'charging station'] },
  { intent: 'hotel', terms: ['hotel', 'hotels', 'stay'], keywords: ['hotel'] },
  { intent: 'shopping', terms: ['shopping', 'mall', 'store', 'stores', 'shop'], keywords: ['shopping', 'mall'] },
  { intent: 'pharmacy', terms: ['pharmacy', 'chemist', 'medicine', 'medical'], keywords: ['pharmacy'] },
  { intent: 'hospital', terms: ['hospital', 'emergency', 'clinic'], keywords: ['hospital', 'clinic'] },
  { intent: 'attraction', terms: ['attraction', 'attractions', 'museum', 'park', 'tourist', 'sightseeing'], keywords: ['attraction', 'museum'] },
];

const CONTEXT_WORDS = ['near me', 'nearby', 'on my route', 'along my route', 'on route', 'near destination', 'at destination'];
const FILTER_WORDS = ['open now', 'cheap', 'cheapest', 'best', 'highly rated', 'good', 'closest', 'nearest', 'dont detour', "don't detour", 'no detour'];

export function normalizeSearchQuery(query: string): string {
  let value = query.toLowerCase().replace(/[!?]/g, ' ');
  for (const word of [...CONTEXT_WORDS, ...FILTER_WORDS]) value = value.split(word).join(' ');
  return value.replace(/\s+/g, ' ').trim();
}

export function detectSearchIntent(query: string): SearchIntent {
  const value = query.toLowerCase();
  const matched = INTENT_RULES.find((rule) => rule.terms.some((term) => value.includes(term)));
  return matched?.intent ?? 'general';
}

export function wantsDestinationSearch(query: string): boolean {
  const value = query.toLowerCase();
  return value.includes('near destination') || value.includes('at destination');
}

export function wantsRouteSearch(query: string): boolean {
  const value = query.toLowerCase();
  return value.includes('on my route') || value.includes('along my route') || value.includes('on route') || value.includes('dont detour') || value.includes("don't detour") || value.includes('no detour');
}

function intentTerms(intent: SearchIntent): string[] {
  return INTENT_RULES.find((rule) => rule.intent === intent)?.keywords ?? [];
}

function routePolyline(route?: Route3DHighlight | null): Location[] {
  if (!route) return [];
  return route.segments.flatMap((segment) => segment.coords.map((coord) => ({ lat: coord.lat, lng: coord.lng })));
}

function sampleRoute(points: Location[]): Location[] {
  if (points.length < 2) return [];
  const indexes = [0, Math.floor(points.length * 0.25), Math.floor(points.length * 0.5), Math.floor(points.length * 0.75), points.length - 1];
  return [...new Map(indexes.map((index) => [`${points[index].lat.toFixed(4)}:${points[index].lng.toFixed(4)}`, points[index]])).values()];
}

function contextForResult(result: GeocodeResult, options: SmartSearchOptions, route: Location[]): SmartSearchResult['context'] {
  if (options.destination && haversineDistanceMeters(result.location, options.destination) <= 1800) return 'destination';
  if (route.length >= 2 && projectOntoPolyline(result.location, route)?.distanceFromLineMeters != null && (projectOntoPolyline(result.location, route)?.distanceFromLineMeters ?? Infinity) <= 1500) return 'on-route';
  return 'nearby';
}

function formatDistance(meters: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function scoreResult(result: GeocodeResult, query: string, intent: SearchIntent, options: SmartSearchOptions, route: Location[]): number {
  const text = result.display_name.toLowerCase();
  const normalized = normalizeSearchQuery(query);
  let score = 0;
  if (normalized && text.includes(normalized)) score += 40;
  for (const keyword of intentTerms(intent)) if (text.includes(keyword)) score += 12;
  const nearby = options.userLocation ? haversineDistanceMeters(result.location, options.userLocation) : null;
  if (nearby != null) score += Math.max(0, 22 - nearby / 800);
  const projection = route.length >= 2 ? projectOntoPolyline(result.location, route) : null;
  if (projection) {
    score += Math.max(0, 28 - projection.distanceFromLineMeters / 250);
    if (wantsRouteSearch(query)) score += projection.distanceFromLineMeters <= 1200 ? 35 : -30;
  }
  if (options.destination) {
    const destinationDistance = haversineDistanceMeters(result.location, options.destination);
    score += Math.max(0, 18 - destinationDistance / 1000);
  }
  return score;
}

export async function smartSearch(query: string, options: SmartSearchOptions = {}): Promise<SmartSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const intent = detectSearchIntent(trimmed);
  const route = routePolyline(options.route);
  const useRoute = route.length >= 2 && wantsRouteSearch(trimmed);
  const targets = useRoute
    ? sampleRoute(route).slice(0, 4)
    : [wantsDestinationSearch(trimmed) ? options.destination : options.userLocation ?? options.destination].filter(Boolean) as Location[];
  const baseQuery = normalizeSearchQuery(trimmed) || trimmed;
  const queryVariants = intent === 'general' ? [baseQuery] : [...new Set([baseQuery, ...intentTerms(intent)])].slice(0, 2);

  const collected = new Map<string, GeocodeResult>();
  for (const variant of queryVariants) {
    const locations = targets.length ? targets : [undefined];
    for (const near of locations) {
      try {
        const results = await searchPlaces(variant, near);
        for (const result of results) {
          const key = `${result.display_name.toLowerCase()}|${result.location.lat.toFixed(5)}|${result.location.lng.toFixed(5)}`;
          if (!collected.has(key)) collected.set(key, result);
        }
      } catch {
        // Keep partial results; the caller can show them rather than turning
        // a single public-provider failure into a blank search experience.
      }
    }
  }

  const ranked = [...collected.values()]
    .map((result) => {
      const distanceMeters = options.userLocation ? haversineDistanceMeters(result.location, options.userLocation) : null;
      const projection = route.length >= 2 ? projectOntoPolyline(result.location, route) : null;
      const routeDistanceMeters = projection?.distanceFromLineMeters ?? null;
      const context = contextForResult(result, options, route);
      const detourLabel = routeDistanceMeters != null
        ? routeDistanceMeters <= 250 ? 'On route'
          : routeDistanceMeters <= 800 ? 'Small detour'
            : routeDistanceMeters <= 1500 ? 'Short detour' : undefined
        : undefined;
      return {
        ...result,
        intent,
        context,
        distanceMeters,
        routeDistanceMeters,
        distanceLabel: formatDistance(distanceMeters),
        detourLabel,
        _score: scoreResult(result, trimmed, intent, options, route),
      };
    })
    .filter((result) => !wantsRouteSearch(trimmed) || (result.routeDistanceMeters != null && result.routeDistanceMeters <= 1800))
    .sort((a, b) => b._score - a._score);

  const seenNames = new Set<string>();
  return ranked.filter((result) => {
    const name = result.display_name.split(',')[0].trim().toLowerCase();
    if (!name || seenNames.has(name)) return false;
    seenNames.add(name);
    return true;
  }).slice(0, options.maxResults ?? 8).map(({ _score: _ignored, ...result }) => result);
}

export const SEARCH_CATEGORY_PRESETS: Array<{ id: SearchIntent; label: string; query: string; icon: string }> = [
  { id: 'coffee', label: 'Coffee', query: 'coffee', icon: '☕' },
  { id: 'food', label: 'Food', query: 'restaurants', icon: '🍽' },
  { id: 'fuel', label: 'Fuel', query: 'fuel station', icon: '⛽' },
  { id: 'parking', label: 'Parking', query: 'parking', icon: 'P' },
  { id: 'ev', label: 'EV', query: 'EV charging', icon: '⚡' },
  { id: 'hotel', label: 'Hotels', query: 'hotel', icon: '⌂' },
];
