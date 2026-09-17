import { Location, Report, Route3DHighlight, SceneContext } from '../types';
import { getRoadIntelligenceTemporal } from './spatialIntelligenceApi';
import { getSceneContext, getRoute, searchPlaces } from '../services/api';
import {
  distanceMeters,
  sampleRoute,
  classifyRoadCharacter,
  scoreRoadQuality,
  summarizeTrip,
  TripIntelligenceSample,
  TripIntelligenceSummary,
  TripTrafficForecast,
} from './tripIntelligence';

interface WeatherRisk {
  score: number;
  label: 'low' | 'moderate' | 'high';
  temperatureC: number | null;
  precipitationProbability: number;
  windKph: number;
}

async function weatherAt(location: Location): Promise<WeatherRisk> {
  try {
    const params = new URLSearchParams({
      latitude: String(location.lat), longitude: String(location.lng),
      current: 'temperature_2m,precipitation,wind_speed_10m,weather_code',
      hourly: 'precipitation_probability,wind_speed_10m', forecast_days: '2', timezone: 'auto',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!r.ok) throw new Error('weather');
    const j = await r.json();
    const probs = Array.isArray(j?.hourly?.precipitation_probability) ? j.hourly.precipitation_probability.slice(0, 24) : [];
    const winds = Array.isArray(j?.hourly?.wind_speed_10m) ? j.hourly.wind_speed_10m.slice(0, 24) : [];
    const rain = Math.max(0, ...probs.map(Number).filter(Number.isFinite));
    const wind = Math.max(0, ...winds.map(Number).filter(Number.isFinite));
    const score = Math.min(100, Math.round(rain * 0.55 + Math.max(0, wind - 25) * 1.7));
    return {
      score, label: score >= 65 ? 'high' : score >= 30 ? 'moderate' : 'low',
      temperatureC: Number.isFinite(j?.current?.temperature_2m) ? j.current.temperature_2m : null,
      precipitationProbability: rain, windKph: wind,
    };
  } catch {
    return { score: 0, label: 'low', temperatureC: null, precipitationProbability: 0, windKph: 0 };
  }
}

function trafficAt(location: Location, reports: Report[]): number {
  let score = 0;
  for (const r of reports) {
    const d = distanceMeters(location, r.location);
    if (d > 3000) continue;
    const weight = 1 - d / 3000;
    if (r.type === 'traffic_jam' || r.type === 'accident') score += 55 * weight;
    else if (r.type === 'construction' || r.type === 'closed_lane') score += 25 * weight;
    else score += 8 * weight;
  }
  return Math.min(100, score);
}

function routeHours(route: Route3DHighlight): number {
  return Math.max(1, Math.ceil((route.duration_seconds ?? 3600) / 3600));
}

async function buildTrafficForecast(
  samples: TripIntelligenceSample[],
  reports: Report[],
  route: Route3DHighlight,
): Promise<TripTrafficForecast[]> {
  const wayIds = Array.from(new Set(samples.map(s => s.road?.osm_id).filter((id): id is number => Number.isFinite(id) && (id as number) > 0))).slice(0, 128);
  const buckets = wayIds.length ? await getRoadIntelligenceTemporal(wayIds, 30).catch(() => []) : [];
  const now = new Date();
  const hours = Math.min(12, Math.max(4, routeHours(route) + 2));
  const forecast: TripTrafficForecast[] = [];
  for (let offset = 0; offset < hours; offset += 1) {
    const target = new Date(now.getTime() + offset * 3600_000);
    const weekday = target.getDay();
    const hour = target.getHours();
    const matching = buckets.filter(b => b.weekday === weekday && b.hour === hour && b.observations > 0);
    const historical = matching.length
      ? matching.reduce((sum, b) => sum + b.score * Math.max(1, b.observations), 0) / matching.reduce((sum, b) => sum + Math.max(1, b.observations), 0)
      : null;
    const historicalConfidence = matching.length
      ? Math.min(100, Math.round(matching.reduce((sum, b) => sum + b.confidence, 0) / matching.length))
      : 0;
    const live = samples.length ? samples.reduce((sum, s) => sum + s.trafficPressure, 0) / samples.length : 0;
    const pressure = historical == null ? Math.round(live) : Math.round(historical * 0.72 + live * 0.28);
    const liveEvidence = reports.length > 0;
    forecast.push({
      hourOffset: offset,
      pressure: Math.max(0, Math.min(100, pressure)),
      confidence: historical == null ? (liveEvidence ? 45 : 15) : Math.min(100, historicalConfidence + (liveEvidence ? 15 : 0)),
      basis: historical == null ? (liveEvidence ? 'live' : 'unknown') : (liveEvidence ? 'mixed' : 'historical'),
    });
  }
  return forecast;
}

export async function analyzeTrip(route: Route3DHighlight, reports: Report[] = []): Promise<TripIntelligenceSummary> {
  const points = sampleRoute(route, Math.max(10_000, Math.min(25_000, (route.distance_meters || 100_000) / 14)));
  const elevations = await Promise.all(points.map(async p => {
    try {
      const q = new URLSearchParams({ latitude: String(p.lat), longitude: String(p.lng), hourly: 'temperature_2m', forecast_days: '1', timezone: 'auto' });
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
      const j = await r.json();
      return Number.isFinite(j.elevation) ? j.elevation : null;
    } catch { return null; }
  }));
  const scenes: (SceneContext | null)[] = await Promise.all(points.map(p => getSceneContext(p, 300).catch(() => null)));
  const weatherLocations = points.length <= 3 ? points : [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  const weather = await Promise.all(weatherLocations.map(weatherAt));

  let travelled = 0;
  const samples: TripIntelligenceSample[] = points.map((location, i) => {
    if (i) travelled += distanceMeters(points[i - 1], location);
    const scene = scenes[i];
    const road = scene?.roads?.[0] ?? null;
    const buildingDensity = Math.min(1, (scene?.buildings?.length ?? 0) / 70);
    const treeDensity = Math.min(1, (scene?.trees?.length ?? 0) / 100);
    const sample: TripIntelligenceSample = {
      location, distanceFromStartMeters: travelled, road,
      trafficPressure: trafficAt(location, reports), roadQuality: scoreRoadQuality(road),
      elevationMeters: elevations[i] ?? null, buildingDensity, treeDensity, characters: [],
    };
    sample.characters = classifyRoadCharacter(sample, elevations[i + 1] ?? null, points[i + 1] ? distanceMeters(location, points[i + 1]) : 1000);
    return sample;
  });

  const summary = summarizeTrip(samples, route, reports);
  summary.trafficForecast = await buildTrafficForecast(samples, reports, route);
  if (summary.trafficForecast.length) {
    const candidates = summary.trafficForecast.slice(0, Math.min(6, summary.trafficForecast.length)).filter(x => x.confidence >= 35);
    if (candidates.length) summary.recommendedDepartureOffsetHours = candidates.reduce((best, item) => item.pressure < best.pressure ? item : best, candidates[0]).hourOffset;
  }
  const worstWeather = weather.reduce((a, b) => a.score >= b.score ? a : b, { score: 0, label: 'low' as const, temperatureC: null, precipitationProbability: 0, windKph: 0 });
  summary.weatherRisk = {
    ...worstWeather,
    coverage: Math.round((weather.length / Math.max(1, weatherLocations.length)) * 100),
  };
  summary.warnings = [
    ...summary.warnings,
    ...(worstWeather.score >= 65 ? ['Weather may materially affect parts of this journey.'] : worstWeather.score >= 30 ? ['Moderate weather risk is present along parts of this journey.'] : []),
    ...(summary.trafficForecast.some(x => x.pressure >= 70) ? ['Expected traffic pressure is elevated during part of the journey window.'] : []),
    ...(summary.trafficForecast.every(x => x.basis === 'unknown') ? ['Historical traffic coverage is unavailable for this route; traffic estimates rely on live observations only.'] : []),
  ];
  summary.confidence = Math.round(Math.min(100, summary.confidence * 0.65 + summary.trafficForecast.reduce((a, x) => a + x.confidence, 0) / Math.max(1, summary.trafficForecast.length) * 0.35));
  return summary;
}

export interface PlannedStop { category: 'fuel' | 'food' | 'rest' | 'charging'; name: string; location: Location; distanceFromStartMeters: number; detourMeters: number | null; reason: string; }

function routePointNear(route: Route3DHighlight, p: Location) {
  let best = route.segments[0]?.coords[0] ? { lat: route.segments[0].coords[0].lat, lng: route.segments[0].coords[0].lng } : p;
  let bestD = Infinity, total = 0, bestAlong = 0;
  for (const s of route.segments) for (let i = 1; i < s.coords.length; i++) {
    const a = s.coords[i - 1], b = s.coords[i];
    const d = distanceMeters({ lat: b.lat, lng: b.lng }, p);
    total += distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    if (d < bestD) { bestD = d; best = { lat: b.lat, lng: b.lng }; bestAlong = total; }
  }
  return { point: best, distance: bestD, along: bestAlong };
}

export async function findTripStops(route: Route3DHighlight, categories: Array<'fuel' | 'food' | 'rest' | 'charging'> = ['fuel', 'food', 'rest', 'charging']): Promise<PlannedStop[]> {
  const points = sampleRoute(route, 50_000).slice(1, -1);
  const out: PlannedStop[] = [];
  for (let i = 0; i < categories.length; i += 1) {
    const category = categories[i];
    const q = category === 'fuel' ? 'fuel station' : category === 'charging' ? 'EV charging station' : category === 'food' ? 'restaurant' : 'rest area';
    const center = points[Math.min(points.length - 1, Math.floor((i + 1) * points.length / (categories.length + 1)))] ?? route.segments[0]?.coords[0] ?? { lat: 0, lng: 0 };
    const results = await searchPlaces(q, center).catch(() => []);
    const candidates = results.slice(0, 5);
    let bestStop: PlannedStop | null = null;
    for (const candidate of candidates) {
      const near = routePointNear(route, candidate.location);
      try {
        const legs = await Promise.all([getRoute(near.point, candidate.location), getRoute(candidate.location, near.point)]);
        const outMeters = legs[0]?.[0]?.distance_meters ?? distanceMeters(near.point, candidate.location);
        const backMeters = legs[1]?.[0]?.distance_meters ?? distanceMeters(candidate.location, near.point);
        const detour = Math.round(Math.max(0, outMeters + backMeters - 2 * near.distance));
        const stop: PlannedStop = { category, name: candidate.display_name, location: candidate.location, distanceFromStartMeters: Math.round(near.along), detourMeters: detour, reason: `On-trip ${q} · about ${Math.round(detour / 100) / 10} km detour` };
        if (!bestStop || (stop.detourMeters ?? 999999) < (bestStop.detourMeters ?? 999999)) bestStop = stop;
      } catch {
        // Keep searching another candidate rather than failing the entire trip analysis.
      }
    }
    if (bestStop) out.push(bestStop);
  }
  return out.sort((a, b) => a.distanceFromStartMeters - b.distanceFromStartMeters);
}
