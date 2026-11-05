import { describe, expect, it } from "vitest";
import { estimateRate } from "../src/estimator";

const FRAME_RATE = 50;

/** Small deterministic PRNG so tests are repeatable. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

interface SpeechSpec {
  rate: number; // true syllables per second while speaking
  seconds: number; // total length
  blur?: number; // syllable length relative to spacing (>1 = overlapping)
  seed?: number;
}

/** Builds a dB level series for speech at a known rate, with pauses. */
function synthSpeech({ rate, seconds, blur = 0.7, seed = 1 }: SpeechSpec) {
  const rand = rng(seed);
  const n = seconds * FRAME_RATE;
  const amp = new Array<number>(n).fill(0);
  let t = 0.2;
  let syllables = 0;
  let speechTime = 0;
  while (t < seconds - 1) {
    // a phrase of 1.5-3.5 s, then a 0.4-0.9 s pause
    const phraseEnd = Math.min(seconds - 1, t + 1.5 + rand() * 2);
    const phraseStart = t;
    while (t < phraseEnd) {
      const gap = (1 / rate) * (1 + (rand() - 0.5)); // +/-50% jitter
      const dur = gap * blur;
      const a = 0.4 + rand() * 0.6;
      const start = Math.round(t * FRAME_RATE);
      const len = Math.max(2, Math.round(dur * FRAME_RATE));
      for (let k = 0; k < len && start + k < n; k++) {
        amp[start + k]! += a * Math.sin((Math.PI * (k + 0.5)) / len) ** 2;
      }
      syllables++;
      t += gap;
    }
    speechTime += t - phraseStart;
    t += 0.4 + rand() * 0.5;
  }
  const levels = amp.map((v) => 20 * Math.log10(v + 0.001));
  return { levels, trueRate: syllables / speechTime };
}

describe("estimateRate", () => {
  for (const rate of [2.5, 3.5, 4.5, 5.5, 6.5]) {
    it(`measures ${rate} syllables/s within 15%`, () => {
      const { levels, trueRate } = synthSpeech({ rate, seconds: 40, seed: rate * 10 });
      const est = estimateRate(levels, { frameRate: FRAME_RATE });
      expect(Math.abs(est.rate - trueRate) / trueRate).toBeLessThan(0.15);
      expect(est.confidence).toBeGreaterThan(0.6);
    });
  }

  it("still separates syllables that run into each other", () => {
    const { levels, trueRate } = synthSpeech({ rate: 4, seconds: 40, blur: 1.2, seed: 7 });
    const est = estimateRate(levels, { frameRate: FRAME_RATE });
    expect(Math.abs(est.rate - trueRate) / trueRate).toBeLessThan(0.2);
  });

  it("reports the video's own rate when captured at a higher speed", () => {
    // 3 syl/s played at 2x sounds like 6 syl/s and lasts half as long.
    const { levels, trueRate } = synthSpeech({ rate: 6, seconds: 40, seed: 3 });
    const est = estimateRate(levels, { frameRate: FRAME_RATE, playbackRate: 2 });
    expect(Math.abs(est.rate - trueRate / 2) / (trueRate / 2)).toBeLessThan(0.15);
  });

  it("has no confidence with too little speech", () => {
    const { levels } = synthSpeech({ rate: 4, seconds: 4 });
    expect(estimateRate(levels, { frameRate: FRAME_RATE }).confidence).toBeLessThan(0.6);
  });

  it("has no confidence in silence", () => {
    const levels = new Array(2000).fill(-60);
    expect(estimateRate(levels, { frameRate: FRAME_RATE }).confidence).toBe(0);
  });

  it("does not trust a steady beat over a loud bed (music)", () => {
    const levels: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const beat = i % 25 < 5 ? 4 : 0; // a perfectly regular beat, 2 per second
      levels.push(-12 + beat + Math.sin(i / 3)); // never drops into a pause
    }
    expect(estimateRate(levels, { frameRate: FRAME_RATE }).confidence).toBeLessThan(0.6);
  });
});
