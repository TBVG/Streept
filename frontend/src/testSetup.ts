import { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

Object.assign(globalThis, { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll });


if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.has(key) ? store.get(key)! : null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}
