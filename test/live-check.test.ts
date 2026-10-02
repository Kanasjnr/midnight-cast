import { describe, expect, it } from "vitest";
import {
  bundledVersions,
  classify,
  exitCodeFor,
  fingerprint,
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

  it("flags bundled drift when the network upgrades past the bundled matrix", () => {
    const base = input();
    const result = classify({
      ...base,
      bundled: { ...base.bundled, node: "1.0.2" },
    });
    expect(result.status).toBe("drift");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "bundled-drift", component: "node", live: "1.0.400", bundled: "1.0.2" }),
    );
    expect(result.findings).toContainEqual(
      expect.objectContaining({ kind: "upstream-ahead", component: "node", upstream: "1.0.400" }),
    );
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
  const drifted = () => {
    const base = input();
    return classify({ ...base, bundled: { ...base.bundled, node: "1.0.2" } });
  };

  it("is stable for identical findings regardless of order", () => {
    const a = drifted();
    const b = drifted();
    b.findings.reverse();
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("changes when findings change", () => {
    expect(fingerprint(drifted())).not.toBe(fingerprint(classify(input())));
  });

});

describe("live-check exit code", () => {
  it("maps clean, drift and outage to 0, 10 and 20", () => {
    const base = input();
    expect(exitCodeFor(classify(base))).toBe(0);
    expect(exitCodeFor(classify({ ...base, bundled: { ...base.bundled, node: "1.0.2" } }))).toBe(10);
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
    const base = input();
    const md = renderMarkdown(classify({ ...base, bundled: { ...base.bundled, node: "1.0.2" } }), {
      checkedAt: "2026-10-02T00:00:00Z",
    });
    expect(md).toContain("### ⚠️ preprod: drift");
    expect(md).toContain("| node | `1.0.400` | `1.0.2` | `1.0.400` |");
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
