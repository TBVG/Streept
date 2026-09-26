import { describe, expect, it } from 'vitest';

type Location = { lat: number; lng: number };

type PreviewState = {
  origin: Location;
  destination: Location;
  customStart: boolean;
};

const sameLocation = (a: Location, b: Location) => a.lat === b.lat && a.lng === b.lng;

function shouldStartPreviewRequest(
  previous: PreviewState | null,
  origin: Location | null,
  destination: Location | null,
  customStart: boolean,
  committedRouteCount: number,
) {
  if (!origin || !destination || committedRouteCount > 0) return false;
  if (!previous) return true;
  return !sameLocation(previous.destination, destination) || previous.customStart !== customStart;
}

describe('route preview lifecycle', () => {
  const origin = { lat: 43, lng: -78 };
  const moved = { lat: 43.0007, lng: -78 };
  const destination = { lat: 43.0018, lng: -78 };

  it('does not rebuild a committed preview when GPS moves', () => {
    const previous = { origin, destination, customStart: false };
    expect(shouldStartPreviewRequest(previous, moved, destination, false, 1)).toBe(false);
  });

  it('starts a new request when the destination changes', () => {
    const previous = { origin, destination, customStart: false };
    expect(shouldStartPreviewRequest(previous, origin, { lat: 43.002, lng: -78 }, false, 0)).toBe(true);
  });

  it('starts once the live origin becomes available', () => {
    expect(shouldStartPreviewRequest(null, origin, destination, false, 0)).toBe(true);
  });
});
