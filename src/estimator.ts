// Estimates how fast someone is talking from a series of loudness readings.
//
// Each vowel is a burst of loudness, so syllables show up as peaks in the
// energy envelope. Counting peaks and dividing by the time spent actually
// speaking (pauses excluded) gives the articulation rate in syllables/second.
// This needs no captions and no speech recognition.

export interface Estimate {
  /** Syllables per second of speech, in the video's own time (1x). */
  rate: number;
  syllables: number;
  /** Seconds of speech in the window, in the video's own time. */
  speechSeconds: number;
  /** 0..1, how much the reading can be trusted. */
  confidence: number;
}

export interface EstimateOptions {
  /** Level readings per wall-clock second. */
  frameRate: number;
  /** Playback speed the audio was captured at. Defaults to 1. */
  playbackRate?: number;
}

/** A peak must stand this many dB above the dips on both sides. */
const PROMINENCE_DB = 2;
/** Peaks closer than this merge into one, which caps the count at 10/s. */
const MIN_PEAK_GAP_S = 0.1;
/** Silences shorter than this are part of speech, not pauses. */
const PAUSE_S = 0.3;
/** Frames within this many dB of the loud end count as speech. */
const SPEECH_RANGE_DB = 25;
/** Seconds of speech needed for full confidence. */
const FULL_CONFIDENCE_SPEECH_S = 12;

export const EMPTY_ESTIMATE: Estimate = { rate: 0, syllables: 0, speechSeconds: 0, confidence: 0 };

export function estimateRate(levels: ArrayLike<number>, opts: EstimateOptions): Estimate {
  const n = levels.length;
  if (n < 10) return EMPTY_ESTIMATE;

  const speed = opts.playbackRate ?? 1;
  // Durations below are in video time; one frame covers speed/frameRate of it.
  const framesFor = (videoSeconds: number) => Math.max(1, Math.round((videoSeconds * opts.frameRate) / speed));
  const toVideoSeconds = (frames: number) => (frames * speed) / opts.frameRate;

  const s = smooth(levels);
  const ceiling = percentile(s, 0.95);
  const floor = percentile(s, 0.1);
  const range = ceiling - floor;
  const threshold = Math.max(ceiling - SPEECH_RANGE_DB, floor + 6);

  const speech = speechMask(s, threshold, framesFor(PAUSE_S));
  const peaks = findPeaks(s, speech, threshold, framesFor(MIN_PEAK_GAP_S));

  let speechFrames = 0;
  for (const v of speech) if (v) speechFrames++;
  const speechSeconds = toVideoSeconds(speechFrames);
  if (speechSeconds === 0) return EMPTY_ESTIMATE;

  const rate = peaks.length / speechSeconds;

  // Confidence: each factor is 0..1 and they multiply, so any one red flag
  // is enough to stop us from acting.
  const amount = clamp01(speechSeconds / FULL_CONFIDENCE_SPEECH_S);
  // Speech swings widely between syllables and pauses; music and steady
  // noise sit at a flatter level.
  const dynamics = clamp01((range - 10) / 10);
  // Real talk has pauses. A window that is almost all "speech" is usually music.
  const pauses = speechFrames / n > 0.97 ? 0.3 : 1;
  // Syllables come at irregular intervals; a steady beat does not.
  const rhythm = rhythmScore(peaks, speech);
  const plausible = rate >= 1.5 && rate <= 9 ? 1 : 0;

  return {
    rate,
    syllables: peaks.length,
    speechSeconds,
    confidence: amount * dynamics * pauses * rhythm * plausible,
  };
}

function smooth(levels: ArrayLike<number>): number[] {
  const out = new Array<number>(levels.length);
  for (let i = 0; i < levels.length; i++) {
    const a = levels[Math.max(0, i - 1)]!;
    const b = levels[i]!;
    const c = levels[Math.min(levels.length - 1, i + 1)]!;
    out[i] = (a + b + c) / 3;
  }
  return out;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Marks frames above the threshold, then fills gaps too short to be pauses. */
function speechMask(s: number[], threshold: number, pauseFrames: number): boolean[] {
  const mask = s.map((v) => v > threshold);
  let lastLoud = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const gap = i - lastLoud - 1;
    if (lastLoud >= 0 && gap > 0 && gap < pauseFrames) {
      for (let j = lastLoud + 1; j < i; j++) mask[j] = true;
    }
    lastLoud = i;
  }
  return mask;
}

function findPeaks(s: number[], speech: boolean[], threshold: number, minGap: number): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < s.length - 1; i++) {
    const v = s[i]!;
    if (!speech[i] || v <= threshold) continue;
    if (!(v > s[i - 1]! && v >= s[i + 1]!)) continue;

    const last = peaks[peaks.length - 1];
    if (last === undefined) {
      peaks.push(i);
      continue;
    }
    let dip = Infinity;
    for (let j = last + 1; j < i; j++) dip = Math.min(dip, s[j]!);
    const separate =
      i - last >= minGap && s[last]! - dip >= PROMINENCE_DB && v - dip >= PROMINENCE_DB;
    if (separate) peaks.push(i);
    else if (v > s[last]!) peaks[peaks.length - 1] = i; // same syllable, keep the louder point
  }
  return peaks;
}

/** Scores how speech-like the spacing between syllables is (irregular = speech). */
function rhythmScore(peaks: number[], speech: boolean[]): number {
  const intervals: number[] = [];
  for (let k = 1; k < peaks.length; k++) {
    const a = peaks[k - 1]!;
    const b = peaks[k]!;
    let continuous = true;
    for (let j = a; j <= b; j++) {
      if (!speech[j]) {
        continuous = false;
        break;
      }
    }
    if (continuous) intervals.push(b - a);
  }
  if (intervals.length < 8) return 0.5;
  const mean = intervals.reduce((x, y) => x + y, 0) / intervals.length;
  const variance = intervals.reduce((x, y) => x + (y - mean) ** 2, 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;
  return clamp01((cv - 0.08) / 0.12);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
