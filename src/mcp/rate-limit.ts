/** A token bucket: up to `burst` calls at once, refilled at `perMinute` calls a minute. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  readonly burst: number;

  constructor(
    readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.burst = Math.max(1, Math.ceil(perMinute / 3));
    this.tokens = this.burst;
    this.last = now();
  }

  /** Takes a call if one is available; otherwise says how long until the next one is. */
  take(): { ok: true } | { ok: false; retryAfterMs: number } {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) * this.perMinute) / 60_000);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true };
    }
    return { ok: false, retryAfterMs: Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute) };
  }
}

export const DEFAULT_CALLS_PER_MINUTE = 30;

export function callsPerMinute(env = process.env.MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE): number {
  if (env === undefined || env.trim() === "") return DEFAULT_CALLS_PER_MINUTE;
  const value = Number(env);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE must be a whole number of at least 1, not "${env}"`);
  }
  return value;
}
