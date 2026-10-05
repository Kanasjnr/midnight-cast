// Whether Midnight's own examples pass on a node version. For each node release, the
// midnightntwrk/midnight-examples maintainers run every example's test suite against public
// preprod and commit the result as reports/node-<version>-regression.json. If they pass on
// the version a network runs, a failing app is more likely the app's code or setup.

import { join } from "node:path";
import { cacheDir, readCache, writeCache, type CacheFile } from "./cache.js";
import { loadDataJson } from "./data-path.js";
import { isOffline } from "./upstream-matrix.js";

export const EXAMPLES_REPO = "midnightntwrk/midnight-examples";

export const reportPath = (version: string) => `reports/node-${version}-regression.json`;
export const reportUrl = (version: string) => `https://github.com/${EXAMPLES_REPO}/blob/main/${reportPath(version)}`;
const rawUrl = (version: string) => `https://raw.githubusercontent.com/${EXAMPLES_REPO}/main/${reportPath(version)}`;

/** The parts of a regression report midnight-cast quotes. */
export interface ExamplesReport {
  nodeVersion: string;
  runtimeSpecVersion?: number;
  network: string;
  date: string;
  suites: { total: number; passed: number; failed: number };
  tests: { passed: number; failed: number; skipped: number };
  /** The report's own conclusion, when it gives one. */
  verdict?: string;
  knownIssues: Array<{ severity: string; title: string }>;
  url: string;
}

export interface ExamplesVerdict {
  /** The node version the network runs, as checked. */
  nodeVersion: string;
  /** passed: every test passed. failures: some failed; read the verdict and known issues. unverified: no usable report. */
  status: "passed" | "failures" | "unverified";
  reason?: string;
  report?: ExamplesReport;
  source: { kind: "upstream" | "cache" | "bundled"; updated: string; ageMinutes?: number; reason?: string };
}

export interface BundledReports {
  updated: string;
  reports: Record<string, ExamplesReport>;
}

const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** Reads a regression report, or throws if it no longer has the fields midnight-cast quotes. */
export function summarizeReport(json: unknown): ExamplesReport {
  const report = json as {
    subjectUnderTest?: { version?: unknown; runtimeSpecVersion?: unknown };
    run?: { date?: unknown; network?: unknown };
    result?: Record<string, unknown>;
    issues?: Array<{ severity?: unknown; title?: unknown }>;
  };
  const nodeVersion = str(report?.subjectUnderTest?.version);
  const date = str(report?.run?.date);
  const network = str(report?.run?.network);
  const result = report?.result ?? {};
  const counts = ["suites", "suitesPassed", "suitesFailed", "testsPassed", "testsFailed"].map((k) => num(result[k]));
  if (!nodeVersion || !date || !network || counts.some((c) => c === undefined)) {
    throw new Error("examples report format not recognised");
  }
  const [total, suitesPassed, suitesFailed, testsPassed, testsFailed] = counts as number[];
  const runtimeSpecVersion = num(report.subjectUnderTest?.runtimeSpecVersion);
  const verdict = str(result.verdict);
  return {
    nodeVersion,
    ...(runtimeSpecVersion !== undefined ? { runtimeSpecVersion } : {}),
    network,
    date,
    suites: { total: total!, passed: suitesPassed!, failed: suitesFailed! },
    tests: { passed: testsPassed!, failed: testsFailed!, skipped: num(result.testsSkipped) ?? 0 },
    ...(verdict ? { verdict } : {}),
    knownIssues: (Array.isArray(report.issues) ? report.issues : [])
      .map((i) => ({ severity: str(i?.severity) ?? "unknown", title: str(i?.title) ?? "" }))
      .filter((i) => i.title),
    url: reportUrl(nodeVersion),
  };
}

/** "1.0.400" from "1.0.400", "1.0.400-c338b9ac" or "v1.0.400". */
export function coreVersion(version: string | undefined): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(version ?? "")?.[1];
}

function judge(
  nodeVersion: string,
  runtimeSpecVersion: number | undefined,
  report: ExamplesReport | null | undefined,
  source: ExamplesVerdict["source"],
): ExamplesVerdict {
  if (!report) {
    return { nodeVersion, status: "unverified", reason: `no examples report for node ${nodeVersion} yet`, source };
  }
  if (report.runtimeSpecVersion !== undefined && runtimeSpecVersion !== undefined && report.runtimeSpecVersion !== runtimeSpecVersion) {
    return {
      nodeVersion,
      status: "unverified",
      reason: `the examples ran node ${report.nodeVersion} on runtime ${report.runtimeSpecVersion}, but this network runs runtime ${runtimeSpecVersion}`,
      report,
      source,
    };
  }
  return { nodeVersion, status: report.tests.failed === 0 ? "passed" : "failures", report, source };
}

export interface ExamplesOptions {
  offline?: boolean;
  refresh?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  bundled?: BundledReports;
}

const HOUR_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * HOUR_MS;
const RETRY_AFTER_FAILURE_MS = HOUR_MS;
const FALLBACK_MAX_AGE_MS = 7 * 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 3_000;

/**
 * Whether Midnight's examples pass on the node a network runs: a fresh cache of the report
 * for that version, then a fetch, then the summaries bundled with this release. A version
 * with no report is unverified, never matched to an older one.
 */
export async function examplesVerdict(
  live: { nodeVersion?: string; runtimeSpecVersion?: number },
  options: ExamplesOptions = {},
): Promise<ExamplesVerdict> {
  const bundled = options.bundled ?? loadDataJson<BundledReports>("examples-reports.json");
  const version = coreVersion(live.nodeVersion);
  const fromBundled = (reason?: string) =>
    judge(version ?? "unknown", live.runtimeSpecVersion, version ? bundled.reports[version] : undefined, {
      kind: "bundled",
      updated: bundled.updated,
      ...(reason ? { reason } : {}),
    });
  if (!version) return { ...fromBundled(), status: "unverified", reason: "the network's node version is unknown" };
  if (isOffline(options.offline)) return fromBundled("offline");

  const now = options.now ?? Date.now();
  const cachePath = join(options.cacheDir ?? cacheDir(), `examples-report-${version}.json`);
  const cached = readCache<ExamplesReport | null>(cachePath);
  const age = (at: string | undefined) => (at ? now - Date.parse(at) : Number.NaN);
  const within = (at: string | undefined, limit: number) => age(at) >= 0 && age(at) < limit;
  const fromCache = (cache: CacheFile<ExamplesReport | null>, kind: "upstream" | "cache", reason?: string) =>
    // A newer release can bundle a report the cache didn't have yet.
    !cache.body && bundled.reports[version]
      ? fromBundled(reason)
      : judge(version, live.runtimeSpecVersion, cache.body, {
          kind,
          updated: cache.fetchedAt,
          ageMinutes: Math.max(0, Math.round(age(cache.fetchedAt) / 60_000)),
          ...(reason ? { reason } : {}),
        });
  const usable = cached && within(cached.fetchedAt, FALLBACK_MAX_AGE_MS) ? cached : undefined;
  const fallback = (reason: string) => (usable ? fromCache(usable, "cache", reason) : fromBundled(reason));

  if (!options.refresh) {
    if (usable && within(usable.fetchedAt, CACHE_TTL_MS)) return fromCache(usable, "cache");
    if (cached?.failedAt && within(cached.failedAt, RETRY_AFTER_FAILURE_MS)) {
      return fallback(`examples report unavailable (${cached.failure ?? "fetch failed"}; retrying after an hour)`);
    }
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(rawUrl(version), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
    const body = response.status === 404 ? null : summarizeReport(await response.json());
    const fresh: CacheFile<ExamplesReport | null> = { fetchedAt: new Date(now).toISOString(), body };
    writeCache(cachePath, fresh);
    return fromCache(fresh, "upstream");
  } catch (err) {
    const failure = err instanceof Error ? err.message : String(err);
    writeCache(cachePath, {
      fetchedAt: cached?.fetchedAt ?? new Date(0).toISOString(),
      body: cached?.body ?? null,
      failedAt: new Date(now).toISOString(),
      failure,
    });
    return fallback(`examples report unavailable (${failure})`);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "30 Sep 2026" from "2026-09-30", whatever the locale. */
function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return month && day ? `${day} ${MONTHS[month - 1]} ${year}` : date;
}

function describeSource(source: ExamplesVerdict["source"]): string {
  if (source.kind === "upstream") return "";
  if (source.kind === "cache") {
    const age = source.ageMinutes ?? 0;
    return ` (cached ${age < 60 ? `${age}m` : `${Math.round(age / 60)}h`} ago${source.reason ? `; ${source.reason}` : ""})`;
  }
  return ` (bundled ${source.updated}${source.reason ? `; ${source.reason}` : ""})`;
}

/** A few lines for human output. */
export function describeExamples(verdict: ExamplesVerdict): string[] {
  const source = describeSource(verdict.source);
  const report = verdict.report;
  if (verdict.status === "unverified" || !report) {
    return [`Midnight's examples: not verified on node ${verdict.nodeVersion}: ${verdict.reason ?? "no report"}${source}.`];
  }
  const where = `on node ${report.nodeVersion} (${report.network}, ${formatDate(report.date)})`;
  const tests = report.tests;
  const first =
    verdict.status === "passed"
      ? `Midnight's examples: all ${tests.passed} tests passed ${where}${source}.`
      : `Midnight's examples: ${tests.passed} passed, ${tests.failed} failed ${where}${source}.`;
  return [
    first,
    ...(verdict.status === "failures" && report.verdict ? [`  Their verdict: ${report.verdict.split(/(?<=\.)\s/)[0]}`] : []),
    `  Report: ${report.url}`,
  ];
}
