import { describe, expect, it } from "vitest";
import { truncateRaw } from "../src/clients/indexer.js";

describe("truncateRaw", () => {
  it("truncates long hex unless verbose", () => {
    const long = "0x" + "ab".repeat(100);
    const short = truncateRaw(long, false);
    expect(short.length).toBeLessThan(long.length);
    expect(short).toContain("…");
  });

  it("returns full hex when verbose", () => {
    const long = "0x" + "ab".repeat(100);
    expect(truncateRaw(long, true)).toBe(long);
  });
});
