import { describe, expect, it } from "vitest";
import {
  bundledVersions,
  classify,
  exitCodeFor,
  failingService,
  fingerprint,
  releaseBlockers,
  parseArgs,
  parseUpstreamMatrix,
  redact,
  renderMarkdown,
  versionFromTag,
  type ClassifyInput,
} from "../scripts/live-check.js";
import type { SupportMatrixFile } from "../src/lib/versions.js";

const upstreamFile = {
  networks: ["preview", "preprod", "mainnet"],
  components: [
    {
      component: "Node (Midnight)",
      versions: {
        preprod: { tag: "node-1.0.400", containerTag: "node-1.0.400" },
        mainnet: { tag: "node-1.0.400", containerTag: "node-1.0.300" },
      },
    },
    {
      component: "Midnight Indexer",
      versions: { preprod: { tag: "midnight-indexer-4.3.302" } },
    },
    {
      component: "Proof server",
      versions: { preprod: { tag: "proof-server-8.1.0" } },
    },
    {
      component: "Compact toolchain",
      versions: { preprod: { tag: "toolchain-0.31.1" } },
    },
  ],
};

const matrix: SupportMatrixFile = {
  docUrl: "https://docs.midnight.network/relnotes/support-matrix",
  updated: "2026-10",
  networks: {
    preprod: {
      node: "1.0.400",
      ledger: "8.1.2",
      indexer: "4.3.302",
      indexerApi: "v4",
      proofServer: "8.1.0",
      onChainRuntime: "3.0.0",
      packages: { "@midnight-ntwrk/compact-runtime": "0.16.0" },
    },
  },
};

function input(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    network: "preprod",
    bundled: bundledVersions(matrix, "preprod")!,
    upstream: parseUpstreamMatrix(upstreamFile, "preprod"),
    health: {
      ok: true,
      data: {
        network: "preprod",
        healthy: true,
        services: [
          { service: "rpc", status: "OK", latencyMs: 10 },
          { service: "indexer", status: "OK", latencyMs: 10 },
          { service: "proof-server", status: "FAIL", latencyMs: 10, optional: true },
        ],
        sync: { rpcHeight: 100, indexerHeight: 99, delta: 1, threshold: 100, inSync: true },
        versions: { matrixUpdated: "2026-10", matrixStale: false, allOk: true, checks: [] },
      },
    },
    versions: {
      ok: true,
      data: {
        network: "preprod",
        matrixUpdated: "2026-10",
        matrixStale: false,
        docUrl: matrix.docUrl,
        expected: matrix.networks.preprod!,
        live: {
          nodeVersion: "1.0.400",
          runtimeSpecVersion: 1000300,
          runtimeImplVersion: 0,
          indexerProtocolVersion: 1000300,
          indexerApi: "v4",
        },
        checks: [
          { label: "node", expected: "1.0.400", live: "1.0.400", ok: true },
          { label: "indexer-api", expected: "v4", live: "v4", ok: true },
          { label: "proof-server", expected: "8.1.0", live: "8.1.0", ok: true },
        ],
        allOk: true,
      },
    },
    ...overrides,
  };
}

/**
 * A network whose node no longer satisfies the bundled matrix, reported the
 * way `midnight-cast versions` reports it: a failing node check.
 */
function nodeBehind(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  const base = input(overrides);
  base.bundled = { ...base.bundled, node: "1.0.500" };
  base.versions!.data!.checks[0] = { label: "node", expected: ">=1.0.500", live: "1.0.400", ok: false };
  return base;
}

describe("live-check tag and matrix parsing", () => {
  it("extracts versions from upstream tags", () => {
    expect(versionFromTag("node-1.0.400")).toBe("1.0.400");
    expect(versionFromTag("midnight-indexer-4.3.302")).toBe("4.3.302");
    expect(versionFromTag("compact-runtime-0.16.0")).toBe("0.16.0");
    expect(versionFromTag("latest")).toBeUndefined();
    expect(versionFromTag(undefined)).toBeUndefined();
  });

  it("parses one network from the upstream matrix and ignores unmapped components", () => {
    const { versions, notes } = parseUpstreamMatrix(upstreamFile, "preprod");
    expect(versions).toEqual({ node: "1.0.400", indexer: "4.3.302", proofServer: "8.1.0" });
    expect(notes).toEqual([]);
  });

  it("notes tag/containerTag disagreement inside the upstream file", () => {
    const { notes } = parseUpstreamMatrix(upstreamFile, "mainnet");
    expect(notes).toEqual(["node: upstream tag 1.0.400 but containerTag 1.0.300"]);
  });

  it("tolerates a malformed upstream file", () => {
    expect(parseUpstreamMatrix(null, "preprod")).toEqual({ versions: {}, notes: [] });
    expect(parseUpstreamMatrix({ components: "nope" }, "preprod").versions).toEqual({});
  });

  it("reads bundled versions, taking compact-runtime from either npm scope", () => {
    expect(bundledVersions(matrix, "preprod")).toMatchObject({ node: "1.0.400", compactRuntime: "0.16.0" });
    const newScope: SupportMatrixFile = {
      ...matrix,
      networks: {
        preprod: { ...matrix.networks.preprod!, packages: { "@midnightntwrk/compact-runtime": "0.20.0" } },
      },
    };
    expect(bundledVersions(newScope, "preprod")?.compactRuntime).toBe("0.20.0");
    expect(bundledVersions(matrix, "nowhere")).toBeUndefined();
  });
});

describe("live-check classify", () => {
  it("is clean when live, bundled and upstream agree", () => {
    const result = classify(input());
    expect(result.status).toBe("clean");
    expect(result.findings).toEqual([]);
  });

  it("ignores optional services that are down", () => {
    expect(classify(input()).findings.some((f) => f.component === "proof-server")).toBe(false);
  });

  it("flags bundled drift when the CLI's node check fails", () => {
    const result = classify(nodeBehind());
    expect(result.status).toBe("drift");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "bundled-drift", component: "node", live: "1.0.400", bundled: ">=1.0.500" }),
    );
  });

  it("is clean when the live node satisfies the matrix minimum, whatever the recommended release", () => {
    // Oct 2026: recommended 1.0.300 (newest public release), live 1.0.400,
    // and Midnight's matrix lists 1.0.400. The CLI's node check passes.
    const base = input();
    const result = classify({ ...base, bundled: { ...base.bundled, node: "1.0.300" } });
    expect(result.status).toBe("clean");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "upstream-differs", severity: "info", component: "node" }),
    );
  });

  it("flags a runtime spec change as release-blocking drift", () => {
    const base = input();
    base.versions!.data!.checks.push({ label: "runtimeSpec", expected: "1000300", live: "1000400", ok: false });
    const result = classify(base);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "bundled-drift", component: "runtimeSpec", bundled: "1000300", live: "1000400" }),
    );
    expect(releaseBlockers(result).map((f) => f.component)).toContain("runtimeSpec");
  });

  it("accepts a live version with a build suffix", () => {
    const base = input();
    base.versions!.data!.live.nodeVersion = "1.0.400-abc123";
    expect(classify(base).status).toBe("clean");
  });

  it("reports upstream lag as info only", () => {
    const base = input();
    const result = classify({
      ...base,
      upstream: { versions: { ...base.upstream!.versions, node: "1.0.300" }, notes: [] },
      bundled: { ...base.bundled, node: "1.0.300" },
    });
    // bundled 1.0.300 vs live 1.0.400 is drift; upstream behind live is info
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "upstream-lag", severity: "info", component: "node" }),
    );
  });

  it("flags a protocol split between node and indexer", () => {
    const base = input();
    base.versions!.data!.live.indexerProtocolVersion = 1000000;
    const result = classify(base);
    expect(result.status).toBe("drift");
    expect(result.findings[0]).toMatchObject({ kind: "protocol-split" });
  });

  it("reports an undetectable indexer API path as info, not drift", () => {
    const base = input();
    base.versions!.data!.checks[1] = { label: "indexer-api", expected: "v4", live: "unknown", ok: false };
    const result = classify(base);
    expect(result.status).toBe("clean");
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "indexer-api-undetected", severity: "info" }),
    ]);
  });

  it("flags an unexpected indexer API", () => {
    const base = input();
    base.versions!.data!.checks[1] = { label: "indexer-api", expected: "v4", live: "v3", ok: false };
    expect(classify(base).findings).toContainEqual(
      expect.objectContaining({ kind: "bundled-drift", component: "indexer-api" }),
    );
  });

  it("reports an outage with the CLI's own error message", () => {
    const result = classify(
      input({ health: { ok: false, error: "RPC unreachable" }, versions: { ok: false, error: "RPC unreachable" } }),
    );
    expect(result.status).toBe("outage");
    expect(result.findings[0]).toMatchObject({ kind: "outage", component: "health", message: "RPC unreachable" });
  });

  it("reports an outage when a required service is down or the indexer lags", () => {
    const base = input();
    base.health!.data!.services[1] = { service: "indexer", status: "FAIL", latencyMs: 0 };
    base.health!.data!.sync = { rpcHeight: 500, indexerHeight: 100, delta: 400, threshold: 100, inSync: false };
    const result = classify(base);
    expect(result.status).toBe("outage");
    expect(result.findings.map((f) => f.component)).toEqual(expect.arrayContaining(["indexer", "sync"]));
  });

  it("treats an unreachable upstream matrix as info, not drift", () => {
    const result = classify(input({ upstream: undefined, upstreamError: "HTTP 503" }));
    expect(result.status).toBe("clean");
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "upstream-unavailable", severity: "info", message: expect.stringContaining("HTTP 503") }),
    ]);
  });
});

describe("live-check fingerprint", () => {
  const drifted = () => classify(nodeBehind());

  it("is stable for identical findings regardless of order", () => {
    const a = drifted();
    const b = drifted();
    b.findings.reverse();
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("ignores the upstream fetch flapping during an outage, even alongside drift", () => {
    const outage = (upstreamUp: boolean) =>
      classify(
        nodeBehind({
          // bundled-drift carries an upstream field, and upstream-differs
          // exists, only while the upstream fetch works
          health: { ok: false, error: "Indexer unreachable (503)" },
          ...(upstreamUp ? {} : { upstream: undefined, upstreamError: "HTTP 503" }),
        }),
      );
    const up = outage(true);
    expect(up.findings.map((f) => f.kind)).toEqual(
      expect.arrayContaining(["outage", "bundled-drift", "upstream-differs"]),
    );
    expect(fingerprint(outage(false))).toBe(fingerprint(up));
  });

  it("still updates an outage issue when drift unrelated to upstream changes", () => {
    const outage = { health: { ok: false, error: "Indexer unreachable (503)" } } as const;
    expect(fingerprint(classify(input(outage)))).not.toBe(fingerprint(classify(nodeBehind(outage))));
  });

  it("keeps one outage's fingerprint stable as the failure mode varies", () => {
    const outage = (error: string) => classify(input({ health: { ok: false, error } }));
    const fp = fingerprint(outage("Indexer unreachable"));
    expect(fingerprint(outage("Indexer unreachable (502)"))).toBe(fp);
    expect(fingerprint(outage("Indexer unreachable (503)"))).toBe(fp);
  });

  it("names the failing service in outage messages", () => {
    expect(failingService("RPC unreachable (403)")).toBe("rpc");
    expect(failingService("RPC error: method not found")).toBe("rpc");
    expect(failingService("Indexer unreachable")).toBe("indexer");
    expect(failingService("proof-server is FAIL")).toBe("proof-server");
    expect(failingService("indexer is 400 blocks behind the node")).toBe("indexer");
    expect(failingService("health check produced no usable output")).toBe("");
  });

  it("changes the outage fingerprint when the outage itself changes", () => {
    const outage = (error: string) => classify(input({ health: { ok: false, error } }));
    expect(fingerprint(outage("RPC unreachable"))).not.toBe(fingerprint(outage("Indexer unreachable (503)")));
  });

  it("keeps the outage fingerprint stable as indexer lag fluctuates", () => {
    const lagging = (delta: number) => {
      const base = input();
      base.health!.data!.sync = { rpcHeight: 1000, indexerHeight: 1000 - delta, delta, threshold: 100, inSync: false };
      return classify(base);
    };
    expect(fingerprint(lagging(400))).toBe(fingerprint(lagging(450)));
  });

  it("changes when findings change", () => {
    expect(fingerprint(drifted())).not.toBe(fingerprint(classify(input())));
  });

});

describe("live-check release blockers", () => {
  it("blocks on disagreement with the live network", () => {
    expect(releaseBlockers(classify(nodeBehind())).map((f) => f.kind)).toContain("bundled-drift");
  });

  it("blocks when upstream is ahead for a component the endpoints don't reveal", () => {
    const base = input();
    const result = classify({
      ...base,
      upstream: { versions: { ...base.upstream!.versions, indexer: "4.4.0" }, notes: [] },
    });
    expect(releaseBlockers(result)).toEqual([
      expect.objectContaining({ kind: "upstream-ahead", component: "indexer", upstream: "4.4.0" }),
    ]);
  });

  it("doesn't block when only the upstream matrix is ahead of a network that hasn't upgraded", () => {
    const base = input();
    // bundled == live == 1.0.400; upstream already lists 1.0.500
    const result = classify({
      ...base,
      upstream: { versions: { ...base.upstream!.versions, node: "1.0.500" }, notes: [] },
    });
    expect(result.status).toBe("clean");
    expect(result.findings.map((f) => f.kind)).toContain("upstream-differs");
    expect(releaseBlockers(result)).toEqual([]);
  });

  it("doesn't block on upstream-ahead for the proof server even when this run couldn't reach it", () => {
    const base = input();
    base.versions!.data!.checks[2] = { label: "proof-server", expected: "8.1.0", live: "fetch failed", ok: false };
    const result = classify({
      ...base,
      upstream: { versions: { ...base.upstream!.versions, proofServer: "8.2.0" }, notes: [] },
    });
    expect(result.live.proofServer).toBeUndefined();
    expect(result.findings.map((f) => f.kind)).toContain("upstream-differs");
    expect(releaseBlockers(result)).toEqual([]);
  });

  it("blocks on an outage and on a protocol split", () => {
    expect(releaseBlockers(classify(input({ health: { ok: false, error: "RPC unreachable" } })))[0]?.kind).toBe("outage");
    const split = input();
    split.versions!.data!.live.indexerProtocolVersion = 1000000;
    expect(releaseBlockers(classify(split)).map((f) => f.kind)).toEqual(["protocol-split"]);
  });
});

describe("live-check exit code", () => {
  it("maps clean, drift and outage to 0, 10 and 20", () => {
    const base = input();
    expect(exitCodeFor(classify(base))).toBe(0);
    expect(exitCodeFor(classify(nodeBehind()))).toBe(10);
    expect(exitCodeFor(classify(input({ health: { ok: false, error: "RPC unreachable" } })))).toBe(20);
  });

  it("refuses a verdict without upstream data, so the issue is left alone", () => {
    // Bundled matches live, but upstream may be ahead: we can't call it clean.
    expect(exitCodeFor(classify(input({ upstream: undefined, upstreamError: "HTTP 503" })))).toBe(2);
  });

  it("still reports an outage when upstream is also unavailable", () => {
    const result = classify(
      input({ upstream: undefined, upstreamError: "HTTP 503", health: { ok: false, error: "Indexer unreachable (503)" } }),
    );
    expect(exitCodeFor(result)).toBe(20);
  });
});

describe("live-check redact and render", () => {
  it("removes explicit secrets and any project_id value", () => {
    const text =
      "fetch https://rpc.midnight-mainnet.blockfrost.io?project_id=nightmainnetABC123&x=1 " +
      '{"project_id":"nightmainnetXYZ"} token nightmainnetSECRET';
    const out = redact(text, ["nightmainnetSECRET", undefined]);
    expect(out).not.toMatch(/nightmainnet/);
    expect(out).toContain("project_id=***&x=1");
  });

  it("renders a table with every component and the findings", () => {
    const md = renderMarkdown(classify(nodeBehind()), {
      checkedAt: "2026-10-02T00:00:00Z",
    });
    expect(md).toContain("### ⚠️ preprod: drift");
    expect(md).toContain("| node | `1.0.400` | `1.0.500` | `1.0.400` |");
    expect(md).toContain("| drift | bundled-drift | node |");
    expect(md).toContain("Checked at 2026-10-02T00:00:00Z.");
  });

  it("parses CLI options with defaults", () => {
    expect(parseArgs(["preview"])).toEqual({ network: "preview", out: "live-check", attempts: 3, delayMs: 20000 });
    expect(parseArgs(["mainnet", "--out", "x", "--attempts", "1", "--delay-ms", "0"])).toEqual({
      network: "mainnet",
      out: "x",
      attempts: 1,
      delayMs: 0,
    });
  });
});
