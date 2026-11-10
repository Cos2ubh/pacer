import { describe, expect, it } from "vitest";
import { baseFromPlayback, SAMPLE_SYLLABLES, utteranceRate } from "../src/demo";

describe("utteranceRate", () => {
  it("slows a voice down to reach a slow target", () => {
    expect(utteranceRate(3, 4.5)).toBeCloseTo(0.667, 2);
  });

  it("speeds a voice up to reach a fast target", () => {
    expect(utteranceRate(6, 4)).toBe(1.5);
  });

  it("stays within what voices can do", () => {
    expect(utteranceRate(20, 4)).toBe(3);
    expect(utteranceRate(1, 4)).toBe(0.5);
  });
});

describe("baseFromPlayback", () => {
  it("works out the voice's natural pace", () => {
    // 24 syllables in 6 s at rate 1.2 -> 4 syl/s spoken, 3.33 at rate 1
    expect(baseFromPlayback(6, 1.2)).toBeCloseTo(SAMPLE_SYLLABLES / 6 / 1.2, 5);
  });

  it("ignores broken timings", () => {
    expect(baseFromPlayback(0, 1)).toBeUndefined();
    expect(baseFromPlayback(0.5, 1)).toBeUndefined(); // 48 syl/s: the timer misfired
  });
});
