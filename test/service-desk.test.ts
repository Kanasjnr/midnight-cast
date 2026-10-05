import { describe, expect, it } from "vitest";
import {
  END,
  START,
  firstSeenOf,
  headRegression,
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
    expect(section).toContain("First seen 2026-10-05T10:01:00Z, last seen 2026-10-05T10:03:00Z");
    expect(section).toContain("midnight-node 1.0.400");
    expect(firstSeenOf(section)).toBe("2026-10-05T10:01:00.123Z");
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

  it("says a rejected Blockfrost project ID isn't Midnight's outage", () => {
    const section = serviceDeskSection(
      report([{ at: "2026-10-05T10:00:00.000Z", services: [down("rpc", "RPC rejected by Blockfrost (403)", "http_4xx"), ok("indexer")] }], {
        network: "mainnet",
        endpoints: mainnet,
      }),
    );
    expect(section).toContain("BLOCKFROST_MAINNET_PROJECT_ID");
    expect(section).not.toContain("### Component");
  });

  it("dates the draft from an earlier first sighting, and swaps only its own section", () => {
    const attempts = [{ at: "2026-10-05T16:00:00.000Z", services: [down("rpc", "RPC unreachable", "timeout"), ok("indexer")] }];
    const section = serviceDeskSection(report(attempts), "2026-10-05T04:00:00.000Z");
    expect(section).toContain("First seen 2026-10-05T04:00:00Z, last seen 2026-10-05T16:00:00Z");
    const before = `table\n\n${serviceDeskSection(report(attempts))}\n\n<!-- live-check fingerprint: abc -->\n`;
    const after = replaceSection(before, section);
    expect(after.startsWith("table\n\n")).toBe(true);
    expect(after).toContain("<!-- live-check fingerprint: abc -->");
    expect(firstSeenOf(after)).toBe("2026-10-05T04:00:00.000Z");
  });
});
