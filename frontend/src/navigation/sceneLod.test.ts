import { describe, expect, it } from 'vitest';
import { isSceneObjectVisible, sceneLodForObject, sceneLodTier } from './sceneLod';

describe('scene LOD', () => {
  it('uses stable near/mid/far distance tiers', () => {
    expect(sceneLodTier(40)).toBe('near');
    expect(sceneLodTier(180)).toBe('mid');
    expect(sceneLodTier(320)).toBe('far');
    expect(sceneLodTier(500)).toBe('hidden');
  });

  it('keeps nearby objects visible even when heading is available', () => {
    expect(isSceneObjectVisible({ lat: 0, lng: 0 }, { lat: 0.0004, lng: 0 }, 180)).toBe(true);
  });

  it('culls objects behind the driver in the far field', () => {
    const center = { lat: 0, lng: 0 };
    const behind = { lat: -0.0025, lng: 0 };
    expect(isSceneObjectVisible(center, behind, 0)).toBe(false);
  });

  it('drops lane markings and street furniture earlier than large forms', () => {
    const center = { lat: 0, lng: 0 };
    const far = { lat: 0.0024, lng: 0 };
    expect(sceneLodForObject('building', center, far, 0)).toBe('far');
    expect(sceneLodForObject('lane-marking', center, far, 0)).toBe('hidden');
    expect(sceneLodForObject('street-lamp', center, far, 0)).toBe('hidden');
  });
});
