import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configPath } from "../config.js";
import { loadDataJson } from "./data-path.js";
import { parseMatrixUpdated, type MatrixNetwork, type SupportMatrixFile } from "./versions.js";

export const UPSTREAM_MATRIX_URL =
  "https://raw.githubusercontent.com/midnightntwrk/midnight-docs/main/docs/relnotes/support-matrix.json";

export type Component = "node" | "indexer" | "proofServer" | "onChainRuntime" | "compactRuntime";

export type ComponentVersions = Partial<Record<Component, string>>;

export interface UpstreamMatrix {
  versions: ComponentVersions;
  /** Inconsistencies inside the upstream file itself (e.g. tag vs containerTag). */
  notes: string[];
}

interface UpstreamFile {
  components?: Array<{
    component: string;
    versions?: Record<string, { tag?: string; containerTag?: string }>;
  }>;
}

// Upstream component display names -> our component keys.
const UPSTREAM_COMPONENTS: Record<string, Component> = {
  "Node (Midnight)": "node",
  "Midnight Indexer": "indexer",
  "Proof server": "proofServer",
  "On-chain runtime": "onChainRuntime",
  "Compact runtime": "compactRuntime",
};

/**
 * Never visible from the public endpoints. For these Midnight's published
 * matrix is the only source of truth; node and proof server are checked
 * against the live network instead.
 */
export const UNOBSERVABLE = new Set<Component>(["indexer", "onChainRuntime", "compactRuntime"]);

/** "node-1.0.400" / "midnight-indexer-4.3.302" -> "1.0.400" */
export function versionFromTag(tag: string | undefined): string | undefined {
  const match = /(\d+\.\d+\.\d+)$/.exec((tag ?? "").trim());
  return match?.[1];
}

export function parseUpstreamMatrix(json: unknown, network: string): UpstreamMatrix {
  const versions: ComponentVersions = {};
  const notes: string[] = [];
  for (const component of (json as UpstreamFile)?.components ?? []) {
    const key = UPSTREAM_COMPONENTS[component.component];
    const entry = component.versions?.[network];
    if (!key || !entry) continue;
    const version = versionFromTag(entry.tag);
    if (version) versions[key] = version;
    const container = versionFromTag(entry.containerTag);
    if (version && container && container !== version) {
      notes.push(`${key}: upstream tag ${version} but containerTag ${container}`);
    }
  }
  return { versions, notes };
}

const COMPACT_RUNTIME = "/compact-runtime";

function withUpstream(row: MatrixNetwork, upstream: ComponentVersions): MatrixNetwork {
  const packages = { ...row.packages };
  const compactPackage = Object.keys(packages).find((name) => name.endsWith(COMPACT_RUNTIME));
  if (upstream.compactRuntime && compactPackage) packages[compactPackage] = upstream.compactRuntime;
  return {
    ...row,
    ...(upstream.indexer ? { indexer: upstream.indexer } : {}),
    ...(upstream.onChainRuntime ? { onChainRuntime: upstream.onChainRuntime } : {}),
    ...(row.packages ? { packages } : {}),
  };
}

/**
 * The bundled matrix with Midnight's published versions for the components
 * the endpoints can't reveal. Node and proof server stay bundled: the
 * upstream file can list versions no network runs yet.
 */
export function overlayUpstream(
  bundled: SupportMatrixFile,
  upstreamJson: unknown,
): { matrix: SupportMatrixFile; notes: Record<string, string[]> } {
  const notes: Record<string, string[]> = {};
  const networks: Record<string, MatrixNetwork> = {};
  for (const [network, row] of Object.entries(bundled.networks)) {
    const { versions, notes: upstreamNotes } = parseUpstreamMatrix(upstreamJson, network);
    const used = Object.fromEntries(
      Object.entries(versions).filter(([key]) => UNOBSERVABLE.has(key as Component)),
    ) as ComponentVersions;
    networks[network] = withUpstream(row, used);
    if (upstreamNotes.length) notes[network] = upstreamNotes;
  }
  return { matrix: { ...bundled, networks }, notes };
}

export type MatrixSourceKind = "override" | "upstream" | "cache" | "bundled";

export interface MatrixSource {
  kind: MatrixSourceKind;
  /** When the matrix was published (bundled) or fetched (upstream, cache). */
  updated: string;
  ageMinutes?: number;
  /** Why the upstream matrix wasn't used, when it wasn't. */
  reason?: string;
}

export interface ResolvedMatrix {
  matrix: SupportMatrixFile;
  source: MatrixSource;
  /** Per network: inconsistencies inside Midnight's published matrix. */
  notes: Record<string, string[]>;
}

export interface ResolveOptions {
  offline?: boolean;
  refresh?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  overridePath?: string;
  bundled?: SupportMatrixFile;
}

const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * HOUR_MS;
// After a failed fetch, later runs don't wait on the timeout again for this long.
const RETRY_AFTER_FAILURE_MS = HOUR_MS;
// How old a cached copy may be to stand in when a refresh fails.
const FALLBACK_MAX_AGE_MS = 7 * 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 3_000;

interface CacheFile {
  fetchedAt: string;
  body: unknown;
  failedAt?: string;
  failure?: string;
}

export function matrixCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "midnight-cast");
}

export function isOffline(flag: boolean | undefined): boolean {
  return flag ?? process.env.MN_OFFLINE === "1";
}

function readCache(path: string): CacheFile | undefined {
  try {
    const cache = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    return Number.isNaN(Date.parse(cache.fetchedAt)) ? undefined : cache;
  } catch {
    return undefined;
  }
}

function writeCache(path: string, cache: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache));
  } catch {
    // A read-only home directory only costs a fetch next time.
  }
}

function fromUpstream(
  bundled: SupportMatrixFile,
  cache: CacheFile,
  kind: "upstream" | "cache",
  now: number,
  reason?: string,
): ResolvedMatrix {
  const { matrix, notes } = overlayUpstream(bundled, cache.body);
  return {
    matrix,
    source: {
      kind,
      updated: cache.fetchedAt,
      ageMinutes: Math.max(0, Math.round((now - Date.parse(cache.fetchedAt)) / 60_000)),
      ...(reason ? { reason } : {}),
    },
    notes,
  };
}

/**
 * The support matrix `versions` and `health` judge against: a user override
 * file, then a fresh cache of Midnight's published matrix, then a fetch, then
 * the copy bundled with this release.
 */
export async function resolveSupportMatrix(options: ResolveOptions = {}): Promise<ResolvedMatrix> {
  const overridePath = options.overridePath ?? join(dirname(configPath()), "support-matrix.json");
  if (existsSync(overridePath)) {
    const matrix = JSON.parse(readFileSync(overridePath, "utf8")) as SupportMatrixFile;
    if (typeof matrix?.networks !== "object" || matrix.networks === null) {
      throw new Error(`${overridePath} is not a support matrix (no "networks"); fix or remove it`);
    }
    return { matrix, source: { kind: "override", updated: matrix.updated }, notes: {} };
  }

  const bundled = options.bundled ?? loadDataJson<SupportMatrixFile>("support-matrix.json");
  const fromBundled = (reason: string): ResolvedMatrix => ({
    matrix: bundled,
    source: { kind: "bundled", updated: bundled.updated, reason },
    notes: {},
  });
  if (isOffline(options.offline)) return fromBundled("offline");

  const now = options.now ?? Date.now();
  const cachePath = join(options.cacheDir ?? matrixCacheDir(), "published-support-matrix.json");
  const cached = readCache(cachePath);
  const age = (at: string | undefined) => (at ? now - Date.parse(at) : Number.NaN);
  // A timestamp in the future (clock skew, a copied cache) counts as expired.
  const within = (at: string | undefined, limit: number) => age(at) >= 0 && age(at) < limit;
  // An old cache shouldn't stand in for the newer matrix a later release bundles.
  const usable =
    cached && within(cached.fetchedAt, FALLBACK_MAX_AGE_MS) && !bundledIsNewer(bundled.updated, cached.fetchedAt)
      ? cached
      : undefined;
  const fallback = (reason: string) =>
    usable ? fromUpstream(bundled, usable, "cache", now, reason) : fromBundled(reason);

  if (!options.refresh) {
    if (usable && within(usable.fetchedAt, CACHE_TTL_MS)) return fromUpstream(bundled, usable, "cache", now);
    if (cached?.failedAt && within(cached.failedAt, RETRY_AFTER_FAILURE_MS)) {
      return fallback(`published matrix unavailable (${cached.failure ?? "fetch failed"}; retrying after an hour)`);
    }
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(UPSTREAM_MATRIX_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const fresh: CacheFile = { fetchedAt: new Date(now).toISOString(), body: await response.json() };
    if (!(fresh.body as UpstreamFile)?.components?.length) throw new Error("no components in the published matrix");
    writeCache(cachePath, fresh);
    return fromUpstream(bundled, fresh, "upstream", now);
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    writeCache(cachePath, {
      fetchedAt: cached?.fetchedAt ?? new Date(0).toISOString(),
      body: cached?.body ?? null,
      failedAt: new Date(now).toISOString(),
      failure,
    });
    return fallback(`published matrix unavailable (${failure})`);
  }
}

function bundledIsNewer(bundledUpdated: string, fetchedAt: string): boolean {
  const published = parseMatrixUpdated(bundledUpdated);
  return published !== null && published.getTime() > Date.parse(fetchedAt);
}

export function describeMatrixSource(source: MatrixSource): string {
  switch (source.kind) {
    case "override":
      return `local override (updated ${source.updated})`;
    case "bundled":
      return `bundled (updated ${source.updated}${source.reason ? `; ${source.reason}` : ""})`;
    case "upstream":
      return "Midnight's published matrix (fetched now)";
    case "cache": {
      const age = source.ageMinutes ?? 0;
      const ago = age < 60 ? `${age}m` : `${Math.round(age / 60)}h`;
      return `Midnight's published matrix (cached ${ago} ago${source.reason ? `; ${source.reason}` : ""})`;
    }
  }
}
