import { describe, expect, it } from "vitest";
import {
  END,
  START,
  firstSeenOf,
  headRegression,
  lastSeenOf,
  replaceSection,
  serviceDeskSection,
  type Attempt,
  type HeadSample,
  type ReportInput,
} from "../scripts/service-desk.js";

const preprod = { rpc: "https://rpc.preprod.midnight.network", indexerHttp: "https://indexer.preprod.midnight.network/api/v4/graphql", blockfrost: false };
const mainnet = {
  rpc: "https://rpc.midnight-mainnet.blockfrost.io",
  indexerHttp: "https://midnight-mainnet.blockfrost.io/api/v0",
  blockfrost: true,
};
const ok = (service: string) => ({ service, status: "OK", latencyMs: 40 });
const down = (service: string, detail: string, errorKind: string) => ({ service, status: "FAIL", latencyMs: 10_004, detail, errorKind });
const synced = { rpcHeight: 2846396, indexerHeight: 2846395, delta: 1, threshold: 100, inSync: true };

function report(attempts: Attempt[], extra: Partial<ReportInput> = {}): ReportInput {
  return { network: "preprod", attempts, endpoints: preprod, environment: "Linux 6.8.0 (GitHub Actions runner)", ...extra };
}

const heads = (...numbers: Array<number | undefined>): HeadSample[] =>
  numbers.map((head, i) => ({ at: `2026-10-02T11:55:${String(40 + i * 2).padStart(2, "0")}.000Z`, ms: 500, ...(head === undefined ? { error: "RPC unreachable" } : { head }) }));

describe("service-desk drafts", () => {
  it("only counts a head as going backwards past a small tolerance, and keeps the largest step", () => {
    expect(headRegression(heads(100, 99, 101, 102))).toBeUndefined();
    expect(headRegression(heads(2804021, 2804011, 2804027, undefined, 2804020))).toEqual({ from: 2804021, to: 2804011, drop: 10 });
    expect(headRegression([])).toBeUndefined();
    expect(headRegression(heads(2804021, Number.NaN, 2804011))).toEqual({ from: 2804021, to: 2804011, drop: 10 });
  });

  it("has nothing to report for a healthy network", () => {
    expect(serviceDeskSection(report([{ at: "2026-10-05T10:00:00.000Z", services: [ok("rpc"), ok("indexer")], sync: synced }]))).toBe("");
  });

  it("drafts an unreachable RPC in the form's layout, with plain curl and every attempt", () => {
    const attempts = [1, 2, 3].map((n) => ({
      at: `2026-10-05T10:0${n}:00.123Z`,
      services: [down("rpc", "RPC unreachable (503)", "http_5xx"), ok("indexer")],
    }));
    const section = serviceDeskSection(report(attempts, { nodeVersion: "1.0.400" }));
    expect(section.startsWith(START) && section.endsWith(END)).toBe(true);
    for (const heading of ["### Component", "### Network", "### Severity", "### First seen where?", "### Expected Behavior", "### Actual Behavior", "### Steps to Reproduce", "### Logs and Error Messages"]) {
      expect(section).toContain(heading);
    }
    expect(section).toContain("Infra — Node (midnight-node)");
    expect(section).toContain("P2 High");
    expect(section).toContain("`network:preprod`, `component:midnight-node`, `priority:p2-high`");
    expect(section).toContain('"method":"system_health"');
    expect(section).toContain("  https://rpc.preprod.midnight.network");
    expect(section).not.toContain("indexer.preprod");
    expect(section).toContain('2026-10-05T10:03:00Z rpc=FAIL 10004ms http_5xx "RPC unreachable (503)" indexer=OK 40ms');
    expect(section).toContain("in all 3 attempts, between 2026-10-05T10:01:00Z and 2026-10-05T10:03:00Z");
    expect(section).toContain("First seen 2026-10-05T10:01:00Z, last seen 2026-10-05T10:03:00Z");
    expect(section).toContain("midnight-node 1.0.400");
    expect(firstSeenOf(section)).toEqual({ "unreachable:rpc": "2026-10-05T10:01:00.123Z" });
  });

  it("counts only the attempts that had the problem", () => {
    const attempts = [
      { at: "2026-10-05T10:01:00.000Z", services: [ok("rpc"), ok("indexer")], error: "versions failed" },
      { at: "2026-10-05T10:02:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), ok("indexer")] },
      { at: "2026-10-05T10:03:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), ok("indexer")] },
    ];
    const section = serviceDeskSection(report(attempts));
    expect(section).toContain("in 2 of 3 attempts, between 2026-10-05T10:02:00Z and 2026-10-05T10:03:00Z");
    expect(section).toContain("First seen 2026-10-05T10:02:00Z");
    expect(serviceDeskSection(report(attempts.slice(2)))).toContain("in the check's one attempt, at 2026-10-05T10:03:00Z");
  });

  it("suggests P1 only when both services are down, and says a page is needed", () => {
    const section = serviceDeskSection(
      report([{ at: "2026-10-05T10:00:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), down("indexer", "Indexer unreachable", "timeout")] }]),
    );
    expect(section).toContain("`priority:p1-critical`");
    expect(section).toContain("page Midnight");
    expect(section).toContain("no response before the client timeout");
    expect(section).toContain("{ block { height } }");
  });

  it("blames the node, not the indexer, when the RPC's head is behind the indexer", () => {
    const rpcBehind = { rpcHeight: 100, indexerHeight: 500, delta: -400, threshold: 100, inSync: false };
    const section = serviceDeskSection(report([{ at: "2026-10-05T10:00:00.000Z", services: [ok("rpc"), ok("indexer")], sync: rpcBehind }]));
    expect(section).toContain("Preprod public RPC 400 blocks behind the indexer");
    expect(section).toContain("`component:midnight-node`, `priority:p3-medium`");
    expect(section).not.toContain("-400 blocks");
  });

  it("drafts indexer lag as a degraded indexer", () => {
    const lagging = { rpcHeight: 2846396, indexerHeight: 2845976, delta: 420, threshold: 100, inSync: false };
    const section = serviceDeskSection(report([{ at: "2026-10-05T10:00:00.000Z", services: [ok("rpc"), ok("indexer")], sync: lagging }]));
    expect(section).toContain("Preprod indexer 420 blocks behind the node");
    expect(section).toContain("`component:indexer`, `priority:p3-medium`");
    expect(section).toContain("node was at block 2846396 and the indexer at 2845976");
  });

  it("drafts an RPC whose head goes backwards, with a loop that shows it", () => {
    const section = serviceDeskSection(
      report([{ at: "2026-10-02T11:55:30.000Z", services: [ok("rpc"), ok("indexer")], sync: synced }], { heads: heads(2804021, 2804011, 2804027) }),
    );
    expect(section).toContain("public RPC returns chain heads that go backwards");
    expect(section).toContain("`priority:p3-medium`");
    expect(section).toContain("11:55:42 head=2804011 500ms   <- 10 below 2804021");
    expect(section).toContain("for i in $(seq 1 15)");
    expect(section).toContain('"method":"chain_getHeader"');
  });

  it("marks in the logs only the steps back that count", () => {
    const section = serviceDeskSection(
      report([{ at: "2026-10-02T11:55:30.000Z", services: [ok("rpc"), ok("indexer")], sync: synced }], { heads: heads(100, 99, 120, 108) }),
    );
    expect(section).toContain("head=108 500ms   <- 12 below 120");
    expect(section).not.toContain("1 below 100");
  });

  it("keeps the project ID out of mainnet reproductions and says Blockfrost runs the endpoints", () => {
    const withToken = { ...mainnet, rpc: `${mainnet.rpc}?project_id=nightmainnetSECRET123` };
    const section = serviceDeskSection(
      report([{ at: "2026-10-05T10:00:00.000Z", services: [down("rpc", "RPC unreachable (503)", "http_5xx"), ok("indexer")] }], {
        network: "mainnet",
        endpoints: withToken,
      }),
    );
    expect(section).not.toContain("SECRET");
    expect(section).toContain('-H "project_id: $BLOCKFROST_PROJECT_ID"');
    expect(section).toContain("run by Blockfrost");
    expect(section).toContain("`network:mainnet`");
  });

  it("says a rejected Blockfrost project ID isn't Midnight's outage, but still drafts rate limits and other failures", () => {
    const mainnetReport = (services: Attempt["services"]) =>
      serviceDeskSection(report([{ at: "2026-10-05T10:00:00.000Z", services }], { network: "mainnet", endpoints: mainnet }));
    const rejectedId = mainnetReport([down("rpc", "RPC rejected by Blockfrost (403)", "http_4xx"), down("indexer", "Indexer rejected by Blockfrost (403)", "http_4xx")]);
    expect(rejectedId).toContain("BLOCKFROST_MAINNET_PROJECT_ID");
    expect(rejectedId).not.toContain("### Component");
    const rateLimited = mainnetReport([down("rpc", "RPC rate-limited by Blockfrost (429)", "http_4xx"), down("indexer", "Indexer unreachable (503)", "http_5xx")]);
    expect(rateLimited).toContain("Mainnet public indexer unreachable");
    expect(rateLimited).toContain("`priority:p2-high`");
    expect(rateLimited).not.toContain("p1-critical");
    expect(rateLimited).toContain("Blockfrost refused RPC because of our project ID or our plan's limit");
    expect(rateLimited).not.toMatch(/RPC: RPC rate-limited/);
  });

  it("keeps each service's first sighting when the set of failing services changes", () => {
    const both = [{ at: "2026-10-05T06:00:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), down("indexer", "Indexer unreachable", "timeout")] }];
    const section = serviceDeskSection(report(both), { "unreachable:rpc": "2026-10-05T00:00:00.000Z" });
    expect(firstSeenOf(section)).toEqual({ "unreachable:rpc": "2026-10-05T00:00:00.000Z", "unreachable:indexer": "2026-10-05T06:00:00.000Z" });
    expect(section).toContain("First seen 2026-10-05T00:00:00Z");
    const rpcAgain = [{ at: "2026-10-05T12:00:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), ok("indexer")] }];
    expect(firstSeenOf(serviceDeskSection(report(rpcAgain), firstSeenOf(section)))).toEqual({ "unreachable:rpc": "2026-10-05T00:00:00.000Z" });
  });

  it("says how the check was started, since a person has to stand behind it", () => {
    const lagging = { rpcHeight: 2846396, indexerHeight: 2845976, delta: 420, threshold: 100, inSync: false };
    const attempts = [{ at: "2026-10-05T10:00:00.000Z", services: [ok("rpc"), ok("indexer")], sync: lagging }];
    expect(serviceDeskSection(report(attempts, { trigger: "schedule" }))).toContain("A scheduled check running in GitHub Actions saw it behind in the check's one attempt");
    expect(serviceDeskSection(report(attempts, { trigger: "schedule" }))).toContain("by a check that runs every six hours");
    expect(serviceDeskSection(report(attempts, { trigger: "workflow_dispatch" }))).toContain("started by workflow_dispatch");
    expect(serviceDeskSection(report(attempts))).toContain("A check run by hand saw it behind");
  });

  it("dates the draft from an earlier first sighting, and swaps only its own section", () => {
    const attempts = [{ at: "2026-10-05T16:00:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), ok("indexer")] }];
    const section = serviceDeskSection(report(attempts), { "unreachable:rpc": "2026-10-05T04:00:00.000Z" });
    expect(section).toContain("First seen 2026-10-05T04:00:00Z, last seen 2026-10-05T16:00:00Z");
    const before = `table\n\n${serviceDeskSection(report(attempts))}\n\n<!-- live-check fingerprint: abc -->\n`;
    const after = replaceSection(before, section);
    expect(after.startsWith("table\n\n")).toBe(true);
    expect(after).toContain("<!-- live-check fingerprint: abc -->");
    expect(firstSeenOf(after)).toEqual({ "unreachable:rpc": "2026-10-05T04:00:00.000Z" });
    expect(lastSeenOf(after)).toBe("2026-10-05T16:00:00.000Z");
  });

  it("doesn't date a new problem from an earlier, different one", () => {
    const attempts = [{ at: "2026-10-06T10:00:00.000Z", services: [ok("rpc"), ok("indexer")], sync: synced }];
    const section = serviceDeskSection(report(attempts, { heads: heads(2804021, 2804011) }), { "unreachable:rpc": "2026-10-05T04:00:00.000Z" });
    expect(firstSeenOf(section)).toEqual({ heads: "2026-10-02T11:55:42.000Z" });
  });
});
