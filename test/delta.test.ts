import { describe, expect, it } from "vitest";
import { computeDelta, tipExitCode } from "../src/lib/delta.js";

describe("delta", () => {
  it("computes rpc minus indexer", () => {
    expect(computeDelta(1000, 950)).toBe(50);
    expect(computeDelta(950, 1000)).toBe(-50);
  });

  it("exit 0 when within threshold and fail-on-lag", () => {
    expect(tipExitCode(50, 100, true)).toBe(0);
    expect(tipExitCode(-99, 100, true)).toBe(0);
  });

  it("exit 1 when at or over threshold and fail-on-lag", () => {
    expect(tipExitCode(100, 100, true)).toBe(1);
    expect(tipExitCode(-100, 100, true)).toBe(1);
    expect(tipExitCode(500, 100, true)).toBe(1);
  });

  it("exit 0 by default without fail-on-lag even when lagging", () => {
    expect(tipExitCode(500, 100, false)).toBe(0);
    expect(tipExitCode(100, 100)).toBe(0);
  });
});
