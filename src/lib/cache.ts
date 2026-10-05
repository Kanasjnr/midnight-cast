import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** A fetched document as cached on disk, with the last failure if a refresh failed. */
export interface CacheFile<T = unknown> {
  fetchedAt: string;
  body: T;
  failedAt?: string;
  failure?: string;
}

export function cacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "midnight-cast");
}

export function readCache<T>(path: string): CacheFile<T> | undefined {
  try {
    const cache = JSON.parse(readFileSync(path, "utf8")) as CacheFile<T>;
    return Number.isNaN(Date.parse(cache.fetchedAt)) ? undefined : cache;
  } catch {
    return undefined;
  }
}

export function writeCache(path: string, cache: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
  } catch {
    // A read-only home directory only costs a fetch next time.
  }
}

export function isOffline(flag: boolean | undefined): boolean {
  return flag ?? process.env.MN_OFFLINE === "1";
}

/** "12m" or "3h". */
export function formatAge(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * HOUR_MS;
// After a failed fetch, later runs don't wait on the timeout again for this long.
const RETRY_AFTER_FAILURE_MS = HOUR_MS;
// How old a cached copy may be to stand in when a refresh fails.
const FALLBACK_MAX_AGE_MS = 7 * 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 3_000;

export interface Fetched<T> {
  body: T;
  kind: "upstream" | "cache";
  fetchedAt: string;
  ageMinutes: number;
  /** Why a cached copy stands in for a fetch, when it does. */
  reason?: string;
}

export interface CachedFetchOptions<T> {
  path: string;
  url: string;
  /** What the reasons call the document, e.g. "published matrix". */
  label: string;
  /** Turns a response into the document, or throws if it isn't one. */
  read: (response: Response) => Promise<T>;
  /** Whether a cached body still has the document's shape; anything else on disk is ignored. */
  valid: (body: unknown) => body is T;
  /** When the copy bundled with this release was made: an older cached copy isn't used. */
  bundledAt?: number;
  refresh?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
}

/**
 * A document fetched from GitHub and cached on disk: a fresh cache, then a fetch, then a cached
 * copy up to a week old. `unavailable` says why there is none, so the caller can fall back to
 * what it bundles.
 */
export async function cachedFetch<T>(options: CachedFetchOptions<T>): Promise<Fetched<T> | { unavailable: string }> {
  const now = options.now ?? Date.now();
  const cached = readCache<unknown>(options.path);
  const age = (at: string | undefined) => (at ? now - Date.parse(at) : Number.NaN);
  // A timestamp in the future (clock skew, a copied cache) counts as expired.
  const within = (at: string | undefined, limit: number) => age(at) >= 0 && age(at) < limit;
  const usable =
    cached &&
    options.valid(cached.body) &&
    within(cached.fetchedAt, FALLBACK_MAX_AGE_MS) &&
    !(options.bundledAt !== undefined && Date.parse(cached.fetchedAt) < options.bundledAt)
      ? (cached as CacheFile<T>)
      : undefined;
  const result = (cache: CacheFile<T>, kind: Fetched<T>["kind"], reason?: string): Fetched<T> => ({
    body: cache.body,
    kind,
    fetchedAt: cache.fetchedAt,
    ageMinutes: Math.max(0, Math.round(age(cache.fetchedAt) / 60_000)),
    ...(reason ? { reason } : {}),
  });
  const fallback = (reason: string) => (usable ? result(usable, "cache", reason) : { unavailable: reason });

  if (!options.refresh) {
    if (usable && within(usable.fetchedAt, CACHE_TTL_MS)) return result(usable, "cache");
    if (cached?.failedAt && within(cached.failedAt, RETRY_AFTER_FAILURE_MS)) {
      return fallback(`${options.label} unavailable (${cached.failure ?? "fetch failed"}; retrying after an hour)`);
    }
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(options.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const fresh: CacheFile<T> = { fetchedAt: new Date(now).toISOString(), body: await options.read(response) };
    writeCache(options.path, fresh);
    return result(fresh, "upstream");
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    writeCache(options.path, {
      fetchedAt: cached?.fetchedAt ?? new Date(0).toISOString(),
      body: cached?.body ?? null,
      failedAt: new Date(now).toISOString(),
      failure,
    });
    return fallback(`${options.label} unavailable (${failure})`);
  }
}
