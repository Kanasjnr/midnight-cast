// Whether Midnight's own examples pass on a node version. For each node release, the
// midnightntwrk/midnight-examples maintainers run every example's test suite against public
// preprod and commit the result as reports/node-<version>-regression.json. If they pass on
// the version a network runs, a failing app is more likely the app's code or setup.

import { join } from "node:path";
import { cacheDir, cachedFetch, formatAge, isOffline } from "./cache.js";
import { loadDataJson } from "./data-path.js";

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

/** Whether a value has the shape of a summary, for anything read back from disk. */
function isReport(value: unknown): value is ExamplesReport {
  const r = value as ExamplesReport;
  return (
    !!r &&
    typeof r.nodeVersion === "string" &&
    typeof r.network === "string" &&
    typeof r.date === "string" &&
    typeof r.url === "string" &&
    Array.isArray(r.knownIssues) &&
    [r.suites?.total, r.suites?.passed, r.suites?.failed, r.tests?.passed, r.tests?.failed, r.tests?.skipped].every(
      (n) => typeof n === "number",
    )
  );
}

function judge(
  checked: { network: string; nodeVersion: string; runtimeSpecVersion?: number },
  report: ExamplesReport | null | undefined,
  source: ExamplesVerdict["source"],
): ExamplesVerdict {
  const { network, nodeVersion, runtimeSpecVersion } = checked;
  const unverified = (reason: string, withReport = true): ExamplesVerdict => ({
    nodeVersion,
    status: "unverified",
    reason,
    ...(report && withReport ? { report } : {}),
    source,
  });
  if (!report) return unverified(`no examples report for node ${nodeVersion} yet`);
  if (report.nodeVersion !== nodeVersion) {
    return unverified(`the report found for node ${nodeVersion} is about node ${report.nodeVersion}`, false);
  }
  if (report.runtimeSpecVersion !== undefined && runtimeSpecVersion !== undefined && report.runtimeSpecVersion !== runtimeSpecVersion) {
    return unverified(`the examples ran on runtime ${report.runtimeSpecVersion}, but this network runs runtime ${runtimeSpecVersion}`);
  }
  // The runs cover one network; another network running the same node isn't covered by them.
  if (report.network !== network) return unverified(`the examples ran on ${report.network}, not ${network}`);
  if (report.tests.passed === 0) return unverified("the report has no passing tests");
  const failed = report.suites.failed > 0 || report.tests.failed > 0;
  return { nodeVersion, status: failed ? "failures" : "passed", report, source };
}

export interface ExamplesOptions {
  offline?: boolean;
  refresh?: boolean;
  now?: number;
  fetchImpl?: typeof fetch;
  cacheDir?: string;
  bundled?: BundledReports;
}

/**
 * Whether Midnight's examples pass on the node a network runs: a fresh cache of the report
 * for that version, then a fetch, then the summaries bundled with this release. A version
 * with no report is unverified, never matched to an older one. It never throws: the verdict
 * is extra information, and mustn't fail the command that asked for it.
 */
export async function examplesVerdict(
  network: string,
  live: { nodeVersion?: string; runtimeSpecVersion?: number },
  options: ExamplesOptions = {},
): Promise<ExamplesVerdict> {
  const version = coreVersion(live.nodeVersion);
  let bundled: BundledReports = { updated: "", reports: {} };
  try {
    bundled = options.bundled ?? loadDataJson<BundledReports>("examples-reports.json");
    const fromBundled = (reason?: string) =>
      judge({ network, nodeVersion: version ?? "unknown", runtimeSpecVersion: live.runtimeSpecVersion }, version ? bundled.reports[version] : undefined, {
        kind: "bundled",
        updated: bundled.updated,
        ...(reason ? { reason } : {}),
      });
    if (!version) return { ...fromBundled(), reason: "the network's node version is unknown" };
    if (isOffline(options.offline)) return fromBundled("offline");

    const fetched = await cachedFetch<ExamplesReport | null>({
      path: join(options.cacheDir ?? cacheDir(), `examples-report-${version}.json`),
      url: rawUrl(version),
      label: "examples report",
      read: async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const report = summarizeReport(await response.json());
        if (report.nodeVersion !== version) throw new Error(`${reportPath(version)} is about node ${report.nodeVersion}`);
        return report;
      },
      valid: (body): body is ExamplesReport | null => body === null || isReport(body),
      // A copy cached before this release's summaries were made is older than them.
      bundledAt: Date.parse(bundled.updated) || undefined,
      refresh: options.refresh,
      now: options.now,
      fetchImpl: options.fetchImpl,
    });
    if ("unavailable" in fetched) return fromBundled(fetched.unavailable);
    return judge({ network, nodeVersion: version, runtimeSpecVersion: live.runtimeSpecVersion }, fetched.body, {
      kind: fetched.kind,
      updated: fetched.fetchedAt,
      ageMinutes: fetched.ageMinutes,
      ...(fetched.reason ? { reason: fetched.reason } : {}),
    });
  } catch (err) {
    return {
      nodeVersion: version ?? "unknown",
      status: "unverified",
      reason: `couldn't read the examples report: ${err instanceof Error ? err.message : String(err)}`,
      source: { kind: "bundled", updated: bundled.updated },
    };
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "30 Sep 2026" from "2026-09-30", whatever the locale; anything else as it is. */
function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return year && month && day && month >= 1 && month <= 12 ? `${day} ${MONTHS[month - 1]} ${year}` : date;
}

function describeSource(source: ExamplesVerdict["source"]): string {
  if (source.kind === "upstream") return "";
  if (source.kind === "cache") return ` (cached ${formatAge(source.ageMinutes ?? 0)} ago${source.reason ? `; ${source.reason}` : ""})`;
  return ` (bundled ${source.updated}${source.reason ? `; ${source.reason}` : ""})`;
}

/** A few lines for human output. */
export function describeExamples(verdict: ExamplesVerdict): string[] {
  const source = describeSource(verdict.source);
  const report = verdict.report;
  const run = report
    ? `node ${report.nodeVersion} (${report.network}, ${formatDate(report.date)}): ${report.tests.passed} tests passed, ${report.tests.failed} failed`
    : "";
  if (verdict.status === "unverified") {
    return [
      `Midnight's examples: not verified for this network: ${verdict.reason ?? "no report"}${source}.`,
      ...(report ? [`  Their run: ${run}.`, `  Report: ${report.url}`] : []),
    ];
  }
  const where = `on node ${report!.nodeVersion} (${report!.network}, ${formatDate(report!.date)})`;
  const first =
    verdict.status === "passed"
      ? `Midnight's examples: all ${report!.tests.passed} tests passed ${where}${source}.`
      : `Midnight's examples: ${report!.tests.passed} passed, ${report!.tests.failed} failed, ${report!.suites.failed} of ${report!.suites.total} suites failing ${where}${source}.`;
  return [
    first,
    ...(verdict.status === "failures" && report!.verdict ? [`  Their verdict: ${report!.verdict.split(/(?<=\.)\s/)[0]}`] : []),
    `  Report: ${report!.url}`,
  ];
}
