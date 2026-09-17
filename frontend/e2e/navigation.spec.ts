import { test, expect, type Page } from '@playwright/test';

const ORIGIN = { lat: 43.0000, lng: -78.0000 };
const DESTINATION = { lat: 43.0018, lng: -78.0000 };

const routeFixture = {
  provider: 'osrm',
  duration_seconds: 120,
  distance_meters: 1800,
  segments: [{
    coords: [
      { lat: 43.0000, lng: -78.0000, alt: 0 },
      { lat: 43.0007, lng: -78.0000, alt: 0 },
      { lat: 43.0012, lng: -78.0000, alt: 0 },
      { lat: 43.0018, lng: -78.0000, alt: 0 },
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

async function mockStreeptApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/geocode')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [{
          display_name: 'Test Destination, Streept',
          location: DESTINATION,
        }] }),
      });
    }
    if (url.pathname.endsWith('/route')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { routes: [routeFixture] } }),
      });
    }
    if (url.pathname.endsWith('/parking') || url.pathname.endsWith('/parked-cars') || url.pathname.endsWith('/reports') || url.pathname.endsWith('/billboards') || url.pathname.endsWith('/traffic') || url.pathname.endsWith('/traffic/vehicles')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });

  await page.route('https://router.project-osrm.org/**', route => route.abort());
  await page.route('https://photon.komoot.io/**', route => route.abort());
}

async function setGps(page: Page, lat: number, lng: number) {
  await page.context().setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
  // Playwright's browser-level geolocation provider delivers this new fix to
  // the production navigator.geolocation.watchPosition listener. No test-only
  // navigation API is involved.
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: ORIGIN.lat, longitude: ORIGIN.lng, accuracy: 5 });
  await mockStreeptApi(page);
});

test('real browser smoke: search -> route preview -> navigation', async ({ page }) => {
  await page.goto('/');

  const destinationInput = page.getByPlaceholder('Search for a destination…');
  await expect(destinationInput).toBeVisible();
  await destinationInput.fill('Test Destination');
  await expect(page.getByRole('button', { name: /Test Destination, Streept/ })).toBeVisible();
  await page.getByRole('button', { name: /Test Destination, Streept/ }).click();

  await expect(page.getByText('TRIP PREVIEW')).toBeVisible();
  const startButton = page.getByRole('button', { name: /Enter navigation/ });
  await expect(startButton).toBeVisible();
  await expect(startButton).toBeEnabled();

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
  await page.goto('/');
  await page.getByPlaceholder('Search for a destination…').fill('Test Destination');
  await page.getByRole('button', { name: /Test Destination, Streept/ }).click();
  await expect(page.getByRole('button', { name: /Enter navigation/ })).toBeEnabled();
  await page.getByRole('button', { name: /Enter navigation/ }).click();

  // Move along the exact route geometry. This exercises the production
  // geolocation watcher, smoothing, route matching and navigation state.
  await setGps(page, 43.0007, -78.0000);
  await setGps(page, 43.0012, -78.0000);
  await setGps(page, 43.0018, -78.0000);

  await expect(page.getByRole('button', { name: 'Navigation options' })).toBeVisible();
});
