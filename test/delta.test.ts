import { describe, expect, it } from "vitest";
import { computeDelta, tipExitCode } from "../src/lib/delta.js";

describe("delta", () => {
  it("computes rpc minus indexer", () => {
    expect(computeDelta(1000, 950)).toBe(50);
    expect(computeDelta(950, 1000)).toBe(-50);
  });

  it("exit 0 when within threshold", () => {
    expect(tipExitCode(50, 100)).toBe(0);
    expect(tipExitCode(-99, 100)).toBe(0);
  });

  it("exit 1 when at or over threshold", () => {
    expect(tipExitCode(100, 100)).toBe(1);
    expect(tipExitCode(-100, 100)).toBe(1);
    expect(tipExitCode(500, 100)).toBe(1);
  });
});
