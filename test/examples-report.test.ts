import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  coreVersion,
  describeExamples,
  examplesVerdict,
  summarizeReport,
  type BundledReports,
  type ExamplesReport,
} from "../src/lib/examples-report.js";
import { reportChanges } from "../scripts/examples-reports.js";

const fixture = (version: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "examples", `node-${version}-regression.json`), "utf8"));
const bundledFile = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "examples-reports.json"), "utf8")) as BundledReports;

const root = mkdtempSync(join(tmpdir(), "examples-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;

const NOW = Date.parse("2026-10-06T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const respond = (status: number, body?: unknown) => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return Object.assign(fetchImpl, { calls });
};
const options = () => ({ cacheDir: join(root, String(dirs++)), offline: false, bundled: bundledFile, now: NOW });
const preprod400 = { nodeVersion: "1.0.400", runtimeSpecVersion: 1000300 };
const preprod300 = { nodeVersion: "1.0.300", runtimeSpecVersion: 1000300 };
const writeCached = (dir: string, version: string, cache: object) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `examples-report-${version}.json`), JSON.stringify(cache));
};

describe("examples reports", () => {
  it("summarises the real reports, and the bundled copy matches them", () => {
    const report = summarizeReport(fixture("1.0.400"));
    expect(report).toMatchObject({
      nodeVersion: "1.0.400",
      runtimeSpecVersion: 1000300,
      network: "preprod",
      date: "2026-09-30",
      suites: { total: 10, passed: 9, failed: 1 },
      tests: { passed: 202, failed: 1, skipped: 1 },
    });
    expect(bundledFile.reports["1.0.400"]).toEqual(report);
    expect(bundledFile.reports["1.0.300"]).toEqual(summarizeReport(fixture("1.0.300")));
  });

  it("refuses a report whose format it doesn't recognise", () => {
    expect(() => summarizeReport({ subjectUnderTest: { version: "1.0.400" } })).toThrow("format not recognised");
  });

  it("reads the version core from what a node reports", () => {
    expect(coreVersion("1.0.400-c338b9ac")).toBe("1.0.400");
    expect(coreVersion(undefined)).toBeUndefined();
  });

  it("fetches the report for the node a network runs, then serves it from the cache", async () => {
    const opts = options();
    const first = respond(200, fixture("1.0.400"));
    expect(await examplesVerdict("preprod", preprod400, { ...opts, fetchImpl: first })).toMatchObject({
      status: "failures",
      source: { kind: "upstream" },
    });
    expect(first.calls).toEqual(["https://raw.githubusercontent.com/midnightntwrk/midnight-examples/main/reports/node-1.0.400-regression.json"]);
    const second = respond(200, fixture("1.0.400"));
    expect((await examplesVerdict("preprod", preprod400, { ...opts, now: NOW + HOUR, fetchImpl: second })).source).toMatchObject({ kind: "cache", ageMinutes: 60 });
    expect(second.calls).toEqual([]);
    expect((await examplesVerdict("preprod", preprod300, { ...options(), fetchImpl: respond(200, fixture("1.0.300")) })).status).toBe("passed");
  });

  it("uses a stale cached copy when a refresh fails, then waits an hour before trying again", async () => {
    const opts = options();
    await examplesVerdict("preprod", preprod400, { ...opts, fetchImpl: respond(200, fixture("1.0.400")) });
    const later = NOW + 7 * HOUR;
    const failing = respond(502);
    expect((await examplesVerdict("preprod", preprod400, { ...opts, now: later, fetchImpl: failing })).source).toMatchObject({
      kind: "cache",
      reason: "examples report unavailable (HTTP 502)",
    });
    const waiting = respond(200, fixture("1.0.400"));
    expect((await examplesVerdict("preprod", preprod400, { ...opts, now: later + 60_000, fetchImpl: waiting })).source.reason).toContain("retrying after an hour");
    expect(waiting.calls).toEqual([]);
  });

  it("calls a version with no report unverified, never borrowing an older one, and believes a removal", async () => {
    const missing = await examplesVerdict("preprod", { nodeVersion: "1.0.500", runtimeSpecVersion: 1000300 }, { ...options(), fetchImpl: respond(404) });
    expect(missing).toMatchObject({ status: "unverified", reason: "no examples report for node 1.0.500 yet", source: { kind: "upstream" } });
    expect(missing.report).toBeUndefined();
    const removed = await examplesVerdict("preprod", preprod400, { ...options(), fetchImpl: respond(404) });
    expect(removed).toMatchObject({ status: "unverified", source: { kind: "upstream" } });
  });

  it("prefers this release's summaries over a cached copy made before them", async () => {
    const dir = join(root, String(dirs++));
    writeCached(dir, "1.0.400", { fetchedAt: "2026-10-01T00:00:00.000Z", body: null, failedAt: new Date(NOW - 60_000).toISOString(), failure: "HTTP 503" });
    const verdict = await examplesVerdict("preprod", preprod400, { ...options(), cacheDir: dir, fetchImpl: respond(503) });
    expect(verdict).toMatchObject({ status: "failures", source: { kind: "bundled" } });
  });

  it("rejects a fetched report about a different node, and ignores a malformed cache instead of failing", async () => {
    const wrong = await examplesVerdict("preprod", { nodeVersion: "1.0.500", runtimeSpecVersion: 1000300 }, { ...options(), fetchImpl: respond(200, fixture("1.0.300")) });
    expect(wrong).toMatchObject({ status: "unverified", source: { kind: "bundled", reason: expect.stringContaining("is about node 1.0.300") } });
    const dir = join(root, String(dirs++));
    writeCached(dir, "1.0.400", { fetchedAt: new Date(NOW - 60_000).toISOString(), body: { nodeVersion: "1.0.400" } });
    const fromBadCache = await examplesVerdict("preprod", preprod400, { ...options(), cacheDir: dir, fetchImpl: respond(200, fixture("1.0.400")) });
    expect(fromBadCache).toMatchObject({ status: "failures", source: { kind: "upstream" } });
  });

  it("only verifies the network and runtime the examples ran on", async () => {
    const mainnet = await examplesVerdict("mainnet", preprod400, { ...options(), offline: true });
    expect(mainnet).toMatchObject({ status: "unverified", reason: "the examples ran on preprod, not mainnet" });
    expect(mainnet.report?.nodeVersion).toBe("1.0.400");
    const otherRuntime = await examplesVerdict("preprod", { nodeVersion: "1.0.400", runtimeSpecVersion: 1000400 }, { ...options(), offline: true });
    expect(otherRuntime.reason).toContain("runtime 1000300, but this network runs runtime 1000400");
  });

  it("counts a failed suite as a failure even with no failed tests, and no passing tests as unverified", async () => {
    const report = bundledFile.reports["1.0.300"]!;
    const judge = (r: ExamplesReport) =>
      examplesVerdict("preprod", preprod300, { ...options(), offline: true, bundled: { updated: "2026-10-05", reports: { "1.0.300": r } } });
    expect((await judge({ ...report, suites: { ...report.suites, failed: 1 } })).status).toBe("failures");
    expect((await judge({ ...report, tests: { passed: 0, failed: 0, skipped: 0 } })).status).toBe("unverified");
  });

  it("falls back to the bundled summaries offline or when GitHub fails, and says so", async () => {
    expect((await examplesVerdict("preprod", preprod400, { ...options(), offline: true })).source).toEqual({ kind: "bundled", updated: bundledFile.updated, reason: "offline" });
    expect(await examplesVerdict("preprod", preprod400, { ...options(), fetchImpl: respond(503) })).toMatchObject({
      status: "failures",
      source: { kind: "bundled", reason: "examples report unavailable (HTTP 503)" },
    });
    expect(await examplesVerdict("preprod", {}, { ...options(), offline: true })).toMatchObject({ status: "unverified", reason: "the network's node version is unknown" });
  });

  it("describes the verdict in a few lines", () => {
    const report = summarizeReport(fixture("1.0.400"));
    expect(describeExamples({ nodeVersion: "1.0.400", status: "failures", report, source: { kind: "upstream", updated: "2026-10-05T12:00:00Z" } })).toEqual([
      "Midnight's examples: 202 passed, 1 failed, 1 of 10 suites failing on node 1.0.400 (preprod, 30 Sep 2026).",
      "  Their verdict: No Node 1.0.400 regression found.",
      "  Report: https://github.com/midnightntwrk/midnight-examples/blob/main/reports/node-1.0.400-regression.json",
    ]);
    expect(
      describeExamples({ nodeVersion: "1.0.400", status: "unverified", reason: "the examples ran on preprod, not mainnet", report, source: { kind: "cache", updated: "x", ageMinutes: 125 } }),
    ).toEqual([
      "Midnight's examples: not verified for this network: the examples ran on preprod, not mainnet (cached 2h ago).",
      "  Their run: node 1.0.400 (preprod, 30 Sep 2026): 202 tests passed, 1 failed.",
      "  Report: https://github.com/midnightntwrk/midnight-examples/blob/main/reports/node-1.0.400-regression.json",
    ]);
  });

  it("lists new, changed and removed reports for the live check", () => {
    const report = summarizeReport(fixture("1.0.400"));
    expect(reportChanges({ "1.0.400": report }, { "1.0.400": report })).toEqual([]);
    expect(reportChanges({}, { "1.0.400": report })).toEqual(["new report: node 1.0.400"]);
    expect(reportChanges({ "1.0.400": { ...report, date: "2026-09-29" } }, { "1.0.400": report })).toEqual(["changed report: node 1.0.400"]);
    expect(reportChanges({ "1.0.300": report }, {})).toEqual(["removed report: node 1.0.300"]);
  });
});
