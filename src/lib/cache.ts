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
