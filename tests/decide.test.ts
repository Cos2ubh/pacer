import { describe, expect, it } from "vitest";
import { blendRate, decideSpeed } from "../src/decide";

const settings = { target: 4.5, maxSpeed: 2 };

describe("decideSpeed", () => {
  it("speeds up a slow speaker to reach the target", () => {
    expect(decideSpeed(3, settings)).toBe(1.5);
  });

  it("leaves a speaker near the target at 1x", () => {
    expect(decideSpeed(4.3, settings)).toBe(1);
  });

  it("never slows a fast speaker down", () => {
    expect(decideSpeed(7, settings)).toBe(1);
  });

  it("caps at the max speed", () => {
    expect(decideSpeed(1.5, settings)).toBe(2);
  });

  it("ignores a missing reading", () => {
    expect(decideSpeed(0, settings)).toBe(1);
    expect(decideSpeed(NaN, settings)).toBe(1);
  });

  it("rounds to 0.05 steps", () => {
    expect(decideSpeed(3.3, settings)).toBe(1.35);
  });
});

describe("blendRate", () => {
  it("takes the first reading as is", () => {
    expect(blendRate(undefined, 0, 3.2)).toBe(3.2);
  });

  it("moves toward new readings", () => {
    expect(blendRate(3, 1, 4)).toBe(3.5);
  });
});
