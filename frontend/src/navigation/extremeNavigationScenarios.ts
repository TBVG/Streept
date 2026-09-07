import { Location } from '../types';
import { haversineDistanceMeters } from '../utils/geo';

export type ExtremeNavigationScenario = 'normal' | 'gps-jump' | 'stopped' | 'u-turn' | 'intersection-ambiguity' | 'route-reversal';

export interface ExtremeNavigationInput {
  previousLocation: Location | null;
  currentLocation: Location;
  previousHeadingDegrees: number | null;
  currentHeadingDegrees: number | null;
  speedMps: number | null;
  accuracyMeters: number | null;
  previousProgressMeters: number | null;
  currentProgressMeters: number | null;
  routeBearingDegrees: number | null;
  destinationDistanceMeters?: number | null;
}

export interface ExtremeNavigationDecision {
  scenario: ExtremeNavigationScenario;
  allowReverseProgress: boolean;
  matchingWindowSegments: number;
  confidenceCap: number | null;
  shouldReacquireRoute: boolean;
}

const angleDelta = (a: number, b: number): number => Math.abs((((a - b) + 540) % 360) - 180);

export function classifyExtremeNavigation(input: ExtremeNavigationInput): ExtremeNavigationDecision {
  const jumpMeters = input.previousLocation ? haversineDistanceMeters(input.previousLocation, input.currentLocation) : 0;
  const headingFlip = input.currentHeadingDegrees != null && input.previousHeadingDegrees != null
    ? angleDelta(input.currentHeadingDegrees, input.previousHeadingDegrees) >= 135
    : false;
  const routeOpposed = input.currentHeadingDegrees != null && input.routeBearingDegrees != null
    ? angleDelta(input.currentHeadingDegrees, input.routeBearingDegrees) >= 135
    : false;
  const progressBackwards = input.previousProgressMeters != null && input.currentProgressMeters != null
    ? input.currentProgressMeters < input.previousProgressMeters - 18
    : false;

  if (jumpMeters > Math.max(180, (input.accuracyMeters ?? 25) * 5)) {
    return { scenario: 'gps-jump', allowReverseProgress: false, matchingWindowSegments: 48, confidenceCap: 0.45, shouldReacquireRoute: true };
  }
  if ((headingFlip && routeOpposed) || (progressBackwards && routeOpposed)) {
    return { scenario: 'u-turn', allowReverseProgress: true, matchingWindowSegments: 48, confidenceCap: 0.72, shouldReacquireRoute: false };
  }
  if (input.speedMps != null && input.speedMps < 0.8) {
    return { scenario: 'stopped', allowReverseProgress: false, matchingWindowSegments: 20, confidenceCap: null, shouldReacquireRoute: false };
  }
  if (routeOpposed) {
    return { scenario: 'route-reversal', allowReverseProgress: true, matchingWindowSegments: 56, confidenceCap: 0.62, shouldReacquireRoute: true };
  }
  if (input.destinationDistanceMeters != null && input.destinationDistanceMeters < 55 && input.currentProgressMeters != null && input.previousProgressMeters != null) {
    return { scenario: 'intersection-ambiguity', allowReverseProgress: false, matchingWindowSegments: 36, confidenceCap: null, shouldReacquireRoute: false };
  }
  return { scenario: 'normal', allowReverseProgress: false, matchingWindowSegments: 24, confidenceCap: null, shouldReacquireRoute: false };
}
