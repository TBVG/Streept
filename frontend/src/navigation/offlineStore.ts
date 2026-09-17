import { Location, Route3DHighlight, SceneContext } from '../types';

const DB_NAME = 'streept_navigation_v2';
const DB_VERSION = 3;
const ROUTE_STORE = 'routes';
const SCENE_STORE = 'scenes';
const TRIP_STORE = 'trips';
const MAX_OFFLINE_TRIPS = 8;
const MAX_SCENES_PER_TRIP = 8;

interface StoredRoute { key: string; savedAt: number; from: Location; to: Location; routes: Route3DHighlight[]; }
interface StoredScene { key: string; savedAt: number; scene: SceneContext; }
export interface StoredOfflineTrip { key: string; savedAt: number; version: number; from: Location; to: Location; routes: Route3DHighlight[]; scenes: Record<string, SceneContext>; }

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROUTE_STORE)) db.createObjectStore(ROUTE_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(SCENE_STORE)) db.createObjectStore(SCENE_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TRIP_STORE)) db.createObjectStore(TRIP_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function request<T>(db: IDBDatabase, storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return new Promise((resolve) => {
    const tx = db.transaction(storeName, mode);
    const result = action(tx.objectStore(storeName));
    result.onsuccess = () => resolve((result.result as T) ?? null);
    result.onerror = () => resolve(null);
  });
}

export async function readStoredRoute(key: string, maxAgeMs: number): Promise<Route3DHighlight[] | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await request<StoredRoute>(db, ROUTE_STORE, 'readonly', (store) => store.get(key));
  db.close();
  if (!value || Date.now() - value.savedAt > maxAgeMs || !value.routes?.length) return null;
  return value.routes;
}

export async function writeStoredRoute(key: string, from: Location, to: Location, routes: Route3DHighlight[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await request(db, ROUTE_STORE, 'readwrite', (store) => store.put({ key, savedAt: Date.now(), from, to, routes } satisfies StoredRoute));
  db.close();
}

export async function readStoredScene(key: string, maxAgeMs: number): Promise<SceneContext | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await request<StoredScene>(db, SCENE_STORE, 'readonly', (store) => store.get(key));
  db.close();
  if (!value || Date.now() - value.savedAt > maxAgeMs || !value.scene) return null;
  return value.scene;
}

export async function writeStoredScene(key: string, scene: SceneContext): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await request(db, SCENE_STORE, 'readwrite', (store) => store.put({ key, savedAt: Date.now(), scene } satisfies StoredScene));
  db.close();
}


const tripKey = (from: Location, to: Location) => `${from.lat.toFixed(4)},${from.lng.toFixed(4)}:${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;

export async function writeOfflineTrip(from: Location, to: Location, routes: Route3DHighlight[], scenes: Record<string, SceneContext>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const boundedScenes = Object.fromEntries(Object.entries(scenes).slice(0, MAX_SCENES_PER_TRIP));
  const trip: StoredOfflineTrip = { key: tripKey(from, to), savedAt: Date.now(), version: 3, from, to, routes, scenes: boundedScenes };
  await request(db, TRIP_STORE, 'readwrite', (store) => store.put(trip));
  const all = await request<StoredOfflineTrip[]>(db, TRIP_STORE, 'readonly', (store) => store.getAll());
  if (all && all.length > MAX_OFFLINE_TRIPS) {
    for (const stale of all.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_OFFLINE_TRIPS)) {
      await request(db, TRIP_STORE, 'readwrite', (store) => store.delete(stale.key));
    }
  }
  db.close();
}

export async function readOfflineTrip(from: Location, to: Location, maxAgeMs: number): Promise<StoredOfflineTrip | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await request<StoredOfflineTrip>(db, TRIP_STORE, 'readonly', (store) => store.get(tripKey(from, to)));
  db.close();
  if (!value || Date.now() - value.savedAt > maxAgeMs || !value.routes?.length) return null;
  return value;
}

export async function deleteOfflineTrip(from: Location, to: Location): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await request(db, TRIP_STORE, 'readwrite', (store) => store.delete(tripKey(from, to)));
  db.close();
}

export async function purgeExpiredOfflineTrips(maxAgeMs: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const all = await request<StoredOfflineTrip[]>(db, TRIP_STORE, 'readonly', (store) => store.getAll());
  if (all) {
    const expired = all.filter((trip) => Date.now() - trip.savedAt > maxAgeMs);
    for (const trip of expired) {
      await request(db, TRIP_STORE, 'readwrite', (store) => store.delete(trip.key));
    }
  }
  db.close();
}

export async function listOfflineTrips(): Promise<StoredOfflineTrip[]> {
  const db = await openDb();
  if (!db) return [];
  const trips = await request<StoredOfflineTrip[]>(db, TRIP_STORE, 'readonly', (store) => store.getAll());
  db.close();
  return (trips ?? []).sort((a, b) => b.savedAt - a.savedAt);
}
