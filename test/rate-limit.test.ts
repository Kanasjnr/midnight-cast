import { describe, expect, it } from "vitest";
import { RateLimiter, callsPerMinute } from "../src/mcp/rate-limit.js";

describe("MCP rate limit", () => {
  it("allows a burst, then refills at the per-minute rate", () => {
    let now = 0;
    const limiter = new RateLimiter(30, () => now);
    expect(limiter.burst).toBe(10);
    for (let i = 0; i < 10; i++) expect(limiter.take().ok).toBe(true);
    const refused = limiter.take();
    expect(refused).toEqual({ ok: false, retryAfterMs: 2000 });
    now += 2000;
    expect(limiter.take().ok).toBe(true);
    expect(limiter.take().ok).toBe(false);
  });

  it("reads MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE and rejects nonsense", () => {
    expect(callsPerMinute(undefined)).toBe(30);
    expect(callsPerMinute(" ")).toBe(30);
    expect(callsPerMinute("120")).toBe(120);
    for (const bad of ["0", "-5", "1.5", "lots"]) expect(() => callsPerMinute(bad), bad).toThrow(/whole number/);
  });
});
