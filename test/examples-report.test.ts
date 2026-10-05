import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coreVersion,
  describeExamples,
  examplesVerdict,
  summarizeReport,
  type BundledReports,
} from "../src/lib/examples-report.js";
import { reportChanges } from "../scripts/examples-reports.js";

const fixture = (version: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "test", "fixtures", "examples", `node-${version}-regression.json`), "utf8"));
const bundledFile = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "examples-reports.json"), "utf8")) as BundledReports;

const respond = (status: number, body?: unknown) => (async () => new Response(body === undefined ? "" : JSON.stringify(body), { status })) as unknown as typeof fetch;
const options = () => ({ cacheDir: mkdtempSync(join(tmpdir(), "examples-")), offline: false, bundled: bundledFile, now: Date.parse("2026-10-05T12:00:00Z") });
const live = { nodeVersion: "1.0.400", runtimeSpecVersion: 1000300 };

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
    expect(report.knownIssues).toContainEqual(expect.objectContaining({ severity: "transient" }));
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

  it("fetches the report for the node a network runs and caches it", async () => {
    const opts = options();
    const fetched = await examplesVerdict(live, { ...opts, fetchImpl: respond(200, fixture("1.0.400")) });
    expect(fetched).toMatchObject({ status: "failures", source: { kind: "upstream" }, report: { tests: { failed: 1 } } });
    const cached = await examplesVerdict(live, { ...opts, fetchImpl: respond(500) });
    expect(cached.source).toMatchObject({ kind: "cache", ageMinutes: 0 });
    const passing = await examplesVerdict({ nodeVersion: "1.0.300", runtimeSpecVersion: 1000300 }, { ...options(), fetchImpl: respond(200, fixture("1.0.300")) });
    expect(passing.status).toBe("passed");
  });

  it("calls a version with no report unverified, never borrowing an older one", async () => {
    const verdict = await examplesVerdict({ nodeVersion: "1.0.500", runtimeSpecVersion: 1000300 }, { ...options(), fetchImpl: respond(404) });
    expect(verdict).toMatchObject({ status: "unverified", reason: "no examples report for node 1.0.500 yet", source: { kind: "upstream" } });
    expect(verdict.report).toBeUndefined();
  });

  it("doesn't count a report from another runtime as verifying this network", async () => {
    const verdict = await examplesVerdict({ nodeVersion: "1.0.400", runtimeSpecVersion: 1000400 }, { ...options(), offline: true });
    expect(verdict.status).toBe("unverified");
    expect(verdict.reason).toContain("runtime 1000300, but this network runs runtime 1000400");
  });

  it("falls back to the bundled summaries offline or when GitHub fails, and says so", async () => {
    expect((await examplesVerdict(live, { ...options(), offline: true })).source).toEqual({ kind: "bundled", updated: bundledFile.updated, reason: "offline" });
    const failed = await examplesVerdict(live, { ...options(), fetchImpl: respond(503) });
    expect(failed).toMatchObject({ status: "failures", source: { kind: "bundled", reason: "examples report unavailable (HTTP 503)" } });
  });

  it("describes the verdict in a few lines", () => {
    const lines = describeExamples({ nodeVersion: "1.0.400", status: "failures", report: summarizeReport(fixture("1.0.400")), source: { kind: "upstream", updated: "2026-10-05T12:00:00Z" } });
    expect(lines).toEqual([
      "Midnight's examples: 202 passed, 1 failed on node 1.0.400 (preprod, 30 Sep 2026).",
      "  Their verdict: No Node 1.0.400 regression found.",
      "  Report: https://github.com/midnightntwrk/midnight-examples/blob/main/reports/node-1.0.400-regression.json",
    ]);
    expect(describeExamples({ nodeVersion: "1.0.500", status: "unverified", reason: "no examples report for node 1.0.500 yet", source: { kind: "bundled", updated: "2026-10-05", reason: "offline" } })).toEqual([
      "Midnight's examples: not verified on node 1.0.500: no examples report for node 1.0.500 yet (bundled 2026-10-05; offline).",
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
