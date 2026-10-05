import { describe, expect, it } from "vitest";
import {
  findIssue,
  fingerprintOf,
  issueBody,
  issueTitle,
  planIssueAction,
  withIssueHistory,
  type IssueSummary,
} from "../scripts/live-issue.js";
import type { CheckResult } from "../scripts/live-check.js";
import { firstSeenOf, serviceDeskSection } from "../scripts/service-desk.js";

const open = (body: string | null, number = 42, network = "preprod"): IssueSummary => ({
  number,
  title: issueTitle(network),
  body,
});

describe("live-issue", () => {
  it("reads the fingerprint marker from an issue body", () => {
    expect(fingerprintOf("text\n<!-- live-check fingerprint: 032b79002800f84e -->\n")).toBe(
      "032b79002800f84e",
    );
    expect(fingerprintOf("no marker")).toBeUndefined();
    expect(fingerprintOf(null)).toBeUndefined();
  });

  it("finds the issue for a network by exact title", () => {
    const issues = [open("", 1, "preview"), open("", 2, "preprod"), { number: 3, title: "Live check: preprod (old)", body: "" }];
    expect(findIssue(issues, "preprod")?.number).toBe(2);
    expect(findIssue(issues, "mainnet")).toBeUndefined();
  });

  it("opens an issue on drift or outage when none exists", () => {
    expect(planIssueAction("preprod", "drift", "abc", undefined)).toEqual({ type: "create", title: "Live check: preprod" });
    expect(planIssueAction("preprod", "outage", "abc", undefined)).toMatchObject({ type: "create" });
  });

  it("leaves the issue alone when findings are unchanged", () => {
    const existing = open("<!-- live-check fingerprint: abc -->");
    expect(planIssueAction("preprod", "drift", "abc", existing)).toMatchObject({ type: "none" });
  });

  it("updates the issue when findings change", () => {
    const existing = open("<!-- live-check fingerprint: abc -->");
    expect(planIssueAction("preprod", "outage", "def", existing)).toEqual({ type: "update", number: 42 });
  });

  it("closes the issue once the network is clean, and does nothing when there is none", () => {
    expect(planIssueAction("preprod", "clean", "abc", open(""))).toEqual({ type: "close", number: 42 });
    expect(planIssueAction("preprod", "clean", "abc", undefined)).toMatchObject({ type: "none" });
  });

  it("keeps the fingerprint marker in the generated body, and marks its status", () => {
    const body = issueBody("preprod", "### report\n\n<!-- live-check fingerprint: abc -->\n", "degraded");
    expect(body).toContain("**preprod**");
    expect(fingerprintOf(body)).toBe("abc");
    expect(body).toContain("<!-- live-check status: degraded -->");
  });

  it("refreshes the issue quietly while it carries a service-desk draft, even when findings are unchanged", () => {
    const existing = open("<!-- live-check fingerprint: abc -->");
    expect(planIssueAction("preprod", "outage", "abc", existing, { hasServiceDesk: true })).toEqual({ type: "refresh", number: 42 });
    expect(planIssueAction("preprod", "degraded", "abc", undefined, { hasServiceDesk: true })).toMatchObject({ type: "create" });
  });

  it("keeps a degraded issue open until a day passes without it, so an intermittent problem doesn't flap", () => {
    const degraded = open("<!-- live-check status: degraded -->\n<!-- service-desk last seen: 2026-10-05T06:00:00.000Z -->");
    const sameDay = { now: new Date("2026-10-05T18:00:00Z") };
    const nextDay = { now: new Date("2026-10-06T07:00:00Z") };
    expect(planIssueAction("preprod", "clean", "x", degraded, sameDay)).toMatchObject({ type: "none" });
    expect(planIssueAction("preprod", "clean", "x", degraded, nextDay)).toEqual({ type: "close", number: 42 });
    const outage = open("<!-- live-check status: outage -->\n<!-- service-desk last seen: 2026-10-05T06:00:00.000Z -->");
    expect(planIssueAction("preprod", "clean", "x", outage, sameDay)).toEqual({ type: "close", number: 42 });
  });

  it("dates the draft from when the issue first saw the problem", () => {
    const result = {
      network: "preprod",
      status: "outage",
      findings: [],
      live: {},
      bundled: {},
      evidence: { attempts: [{ at: "2026-10-05T16:00:00.000Z", services: [{ service: "rpc", status: "FAIL", latencyMs: 10_000, errorKind: "timeout" }] }] },
    } as CheckResult;
    const attempts = result.evidence!.attempts;
    const report = `table\n\n${serviceDeskSection({ network: "preprod", attempts })}\n`;
    const earlier = issueBody("preprod", serviceDeskSection({ network: "preprod", attempts }, { "unreachable:rpc": "2026-10-05T04:00:00.000Z" }), "outage");
    expect(firstSeenOf(withIssueHistory(report, result, earlier))).toEqual({ "unreachable:rpc": "2026-10-05T04:00:00.000Z" });
    expect(firstSeenOf(withIssueHistory(report, result, null))).toEqual({ "unreachable:rpc": "2026-10-05T16:00:00.000Z" });
    expect(withIssueHistory("no draft", result, earlier)).toBe("no draft");
  });
});
