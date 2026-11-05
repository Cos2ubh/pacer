// Turns a measured speaking rate into a playback speed.
// Only ever speeds up: a speaker at or above the target pace stays at 1x.

export interface PaceSettings {
  /** Speaking rate (syllables/second) the viewer finds comfortable. */
  target: number;
  /** Never go faster than this. */
  maxSpeed: number;
}

/** Below this boost the difference isn't worth changing speed for. */
export const MIN_BOOST = 1.1;
/** Readings below this confidence are ignored. */
export const MIN_CONFIDENCE = 0.6;

export function decideSpeed(rate: number, settings: PaceSettings): number {
  if (!(rate > 0)) return 1;
  const raw = settings.target / rate;
  if (raw < MIN_BOOST) return 1;
  const capped = Math.min(raw, Math.max(1, settings.maxSpeed));
  return Math.round(capped * 20) / 20; // steps of 0.05x
}

/** Running average of a channel's speaking rate, weighted toward recent videos. */
export function blendRate(previous: number | undefined, samples: number, next: number): number {
  if (previous === undefined || samples <= 0) return next;
  return previous + (next - previous) / Math.min(samples + 1, 5);
}
