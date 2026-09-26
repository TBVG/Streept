import { test, expect, type Page } from '@playwright/test';

const ORIGIN = { lat: 43.0000, lng: -78.0000 };
async function configureBrowserMocks(page: Page) {
  // API calls are served by the deterministic mock server configured in
  // playwright.config.ts. Do not intercept /api in the page itself: doing so
  // creates a second mock layer that can diverge from the production Axios
  // contract and can hide failures in the E2E server.
  await page.addInitScript(() => {
    let current = { lat: 43.0000, lng: -78.0000 };
    const watchers = new Map<number, PositionCallback>();
    let nextId = 1;
    const position = (): GeolocationPosition => ({
      coords: {
        latitude: current.lat,
        longitude: current.lng,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: 0,
        speed: 0,
        toJSON() { return this; },
      },
      timestamp: Date.now(),
      toJSON() { return this; },
    } as GeolocationPosition);
    const geo: Geolocation = {
      getCurrentPosition(success) { setTimeout(() => success(position()), 0); },
      watchPosition(success) {
        const id = nextId++;
        watchers.set(id, success);
        setTimeout(() => success(position()), 0);
        return id;
      },
      clearWatch(id) { watchers.delete(id); },
    } as Geolocation;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
    (window as any).__streeptGpsReady = true;
    (window as any).__streeptSetGps = (lat: number, lng: number) => {
      current = { lat, lng };
      const next = position();
      watchers.forEach((success) => success(next));
    };
  });
}

async function prepareNavigationPage(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__streeptGpsReady));
  await expect(page.getByPlaceholder('Search for a destination…')).toBeVisible();
  // Wait until React has actually consumed the mocked geolocation fix.
  // Calling __streeptSetGps immediately after page load can race the
  // production watchPosition registration, leaving the route preview without
  // an origin even though the browser-level mock itself is ready.
  await expect(page.getByRole('status').filter({ hasText: 'READY' })).toBeVisible({ timeout: 10000 });
  await page.evaluate(({ lat, lng }) => (window as any).__streeptSetGps(lat, lng), ORIGIN);
  await expect(page.getByRole('status').filter({ hasText: 'READY' })).toBeVisible({ timeout: 10000 });
}

async function setGps(page: Page, lat: number, lng: number) {
  await page.evaluate(({ lat: nextLat, lng: nextLng }) => (window as any).__streeptSetGps(nextLat, nextLng), { lat, lng });
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy: 5 });
  await configureBrowserMocks(page);
});

test('committed route remains startable while background route loading settles', async ({ page }) => {
  // The production UI may keep routeLoading true while enrichment/background work settles.
  // A committed route must still expose the real Enter navigation action.
  await prepareNavigationPage(page);
  await page.getByPlaceholder('Search for a destination…').fill('Test Destination');
  const routeResponse = page.waitForResponse((response) => response.url().includes('/api/route') && response.request().method() === 'GET');
  await page.getByRole('button', { name: /Test Destination/ }).click();
  const response = await routeResponse;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body?.data?.routes?.[0]?.provider).toBe('osrm');
  await expect(page.getByText('TRIP PREVIEW')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /Enter navigation/ })).toBeEnabled({ timeout: 10000 });
});

test('real browser smoke: search -> route preview -> navigation', async ({ page }) => {
  await prepareNavigationPage(page);

  const destinationInput = page.getByPlaceholder('Search for a destination…');
  await expect(destinationInput).toBeVisible();
  await destinationInput.fill('Test Destination');
  await expect(page.getByRole('button', { name: /Test Destination/ })).toBeVisible();
  const routeResponse = page.waitForResponse((response) => response.url().includes('/api/route') && response.request().method() === 'GET');
  await page.getByRole('button', { name: /Test Destination/ }).click();
  const response = await routeResponse;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body?.data?.routes?.[0]?.provider).toBe('osrm');
  await expect(page.getByText('TRIP PREVIEW')).toBeVisible({ timeout: 10000 });
  // The local E2E mock server owns the /api contract. Waiting for the actual
  // route response makes this test fail at the network/application boundary
  // instead of masking a routing problem as a missing UI label.
  const startButton = page.getByRole('button', { name: /Enter navigation/ });
  await expect(startButton).toBeVisible({ timeout: 30000 });
  await expect(startButton).toBeEnabled({ timeout: 30000 });

  const card = page.locator('.start-navigation-card');
  const cardBox = await card.boundingBox();
  const buttonBox = await startButton.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(cardBox!.y - 1);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

  await startButton.click();
  await expect(page.getByRole('button', { name: 'Toggle 2D and 3D view' })).toBeVisible();
  await expect(page.getByText(/GPS ready|GPS weak|GPS reacquiring/)).toBeVisible();
});

test('GPS simulation drives the same navigation path used by the browser', async ({ page }) => {
  await prepareNavigationPage(page);
  await page.getByPlaceholder('Search for a destination…').fill('Test Destination');
  const routeResponse = page.waitForResponse((response) => response.url().includes('/api/route') && response.request().method() === 'GET');
  await page.getByRole('button', { name: /Test Destination/ }).click();
  const response = await routeResponse;
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body?.data?.routes?.[0]?.provider).toBe('osrm');
  await expect(page.getByText('TRIP PREVIEW')).toBeVisible({ timeout: 10000 });
  const startButton = page.getByRole('button', { name: /Enter navigation/ });
  await expect(startButton).toBeVisible({ timeout: 30000 });
  await expect(startButton).toBeEnabled({ timeout: 30000 });
  await startButton.click();

  // Move along the exact route geometry. This exercises the production
  // geolocation watcher, smoothing, route matching and navigation state.
  await setGps(page, 43.0007, -78.0000);
  await setGps(page, 43.0012, -78.0000);
  await setGps(page, 43.0018, -78.0000);

  await expect(page.getByRole('button', { name: 'Navigation options' })).toBeVisible();
});
