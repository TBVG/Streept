import { SpatialObservation } from './observationLedger';

/**
 * Tiny on-device online learner. It intentionally consumes only the coarse
 * observation ledger (never raw GPS) and is resettable by the user.
 * This is a deterministic, privacy-first ML primitive, not a claim of a
 * trained fleet model. A future model can replace this interface without
 * changing navigation callers.
 */
export interface OnDevicePrediction {
  score: number;
  confidence: number;
  samples: number;
}


const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const sigmoid = (v: number) => 1 / (1 + Math.exp(-Math.max(-12, Math.min(12, v))));

function target(item: SpatialObservation): number {
  if (item.type === 'maneuver_missed') return 1;
  if (item.type === 'lane_misalignment') return 0.75;
  if (item.type === 'hazard_observed') return 0.9;
  return 0.05;
}

function features(item: SpatialObservation, now: number): number[] {
  const date = new Date(item.at);
  const hour = date.getUTCHours() / 23;
  const weekday = date.getUTCDay() / 6;
  const ageDays = Math.max(0, now - item.at) / 86_400_000;
  return [1, hour, weekday, Math.min(1, ageDays / 30), clamp01(item.confidence)];
}

export function predictOnDevice(
  observations: SpatialObservation[],
  wayId: number | null,
  now = Date.now(),
): OnDevicePrediction {
  if (wayId == null) return { score: 0, confidence: 0, samples: 0 };
  const items = observations.filter((item) => item.wayId === wayId && now - item.at >= -10 * 60_000 && now - item.at <= 90 * 86_400_000);
  if (!items.length) return { score: 0, confidence: 0, samples: 0 };

  // Online logistic regression with a small fixed learning rate. Training is
  // performed locally at prediction time over the bounded ledger, avoiding a
  // model file, remote inference service, or user-identifying data.
  const weights = [0, 0, 0, 0, 0];
  for (const item of items) {
    const x = features(item, now);
    const y = target(item);
    const p = sigmoid(weights.reduce((sum, w, i) => sum + w * x[i], 0));
    const rate = 0.12 * clamp01(item.confidence) * Math.exp(-Math.max(0, now - item.at) / (30 * 86_400_000));
    for (let i = 0; i < weights.length; i += 1) weights[i] += rate * (y - p) * x[i];
  }
  const current = new Date(now);
  const xNow = [1, current.getUTCHours() / 23, current.getUTCDay() / 6, 0, 1];
  const probability = sigmoid(weights.reduce((sum, w, i) => sum + w * xNow[i], 0));
  const confidence = clamp01((items.length / 10) * Math.min(1, items.reduce((s, i) => s + clamp01(i.confidence), 0) / items.length));
  return { score: Math.round(probability * 100), confidence, samples: items.length };
}
