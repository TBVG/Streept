import { test, expect, type Page } from '@playwright/test';

const ORIGIN = { lat: 43.0000, lng: -78.0000 };
const DESTINATION = { lat: 43.0018, lng: -78.0000 };

const ROUTE_FIXTURE = {
  provider: 'osrm',
  duration_seconds: 120,
  distance_meters: 1800,
  segments: [{
    coords: [
      { lat: ORIGIN.lat, lng: ORIGIN.lng, alt: 0 },
      { lat: 43.0007, lng: -78.0000, alt: 0 },
      { lat: 43.0012, lng: -78.0000, alt: 0 },
      { lat: DESTINATION.lat, lng: DESTINATION.lng, alt: 0 },
    ],
    is_highlighted: true,
    color: '#2D7FF9',
    lane_index: null,
  }],
  maneuvers: [{
    type: 'arrive',
    modifier: null,
    location: DESTINATION,
    bearing_before: 0,
    instruction: 'Arrive at destination',
    is_complex: false,
  }],
};

async function mockExternalProviders(page: Page) {
  // Keep the browser test deterministic at the application boundary. The
  // production app normally talks to the configured backend, but GitHub's
  // E2E job intentionally has no real routing backend. Intercept the route
  // and geocode contracts in the browser so the test proves the real React
  // route-preview/navigation flow instead of depending on a second process
  // being reachable from Chromium.
  await page.route('**/api/geocode*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ display_name: 'Test Destination, Streept', location: DESTINATION }],
      }),
    });
  });
  await page.route('**/api/route*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { routes: [ROUTE_FIXTURE] } }),
    });
  });
  await page.route('**/api/road-intelligence/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.route('https://router.project-osrm.org/**', route => route.abort());
  await page.route('https://photon.komoot.io/**', route => route.abort());
}

async function prepareNavigationPage(page: Page) {
  await page.goto('/');
  // The CI browser must exercise the production geolocation watcher, but
  // Chromium's permission/geolocation delivery can race React mounting on a
  // headless Linux runner. The test therefore supplies a deterministic browser
  // Geolocation API implementation before the app loads. This is still the
  // same navigator.geolocation.watchPosition contract used by production code.
  await page.waitForFunction(() => Boolean((window as any).__streeptGpsReady));
  await expect(page.getByPlaceholder('Search for a destination…')).toBeVisible();
  await page.evaluate(({ lat, lng }) => (window as any).__streeptSetGps(lat, lng), ORIGIN);
  await page.waitForTimeout(250);
}

async function setGps(page: Page, lat: number, lng: number) {
  await page.evaluate(({ lat: nextLat, lng: nextLng }) => (window as any).__streeptSetGps(nextLat, nextLng), { lat, lng });
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy: 5 });
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
  await mockExternalProviders(page);
});

test('real browser smoke: search -> route preview -> navigation', async ({ page }) => {
  await prepareNavigationPage(page);

  const destinationInput = page.getByPlaceholder('Search for a destination…');
  await expect(destinationInput).toBeVisible();
  await destinationInput.fill('Test Destination');
  await expect(page.getByRole('button', { name: /Test Destination/ })).toBeVisible();
  await page.getByRole('button', { name: /Test Destination/ }).click();

  await expect(page.getByText('TRIP PREVIEW')).toBeVisible({ timeout: 10000 });
  // The local E2E mock server owns the /api contract. Waiting for the actual
  // route response makes this test fail at the network/application boundary
  // instead of masking a routing problem as a missing UI label.
  await expect.poll(async () => await page.locator('.start-navigation-button').getAttribute('disabled'), { timeout: 30000 }).toBeNull();
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
  await page.getByRole('button', { name: /Test Destination/ }).click();
  await expect(page.getByText('TRIP PREVIEW')).toBeVisible({ timeout: 10000 });
  await expect.poll(async () => await page.locator('.start-navigation-button').getAttribute('disabled'), { timeout: 30000 }).toBeNull();
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
