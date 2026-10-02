import { describe, expect, it } from "vitest";
import {
  buildVersionChecks,
  buildLocalPackageChecks,
  buildNetworkMismatchWarning,
  detectIndexerApi,
  isMatrixStale,
  parseMatrixUpdated,
  parseNodeVersion,
  versionMatches,
  fetchLiveVersions,
  compareVersions,
  nodeSatisfies,
} from "../src/lib/versions.js";

describe("versions helpers", () => {
  it("parses node version from system_version", () => {
    expect(parseNodeVersion("0.22.2-71fc6804")).toBe("0.22.2");
  });

  it("matches expected node versions", () => {
    expect(versionMatches("0.22.2", "0.22.2")).toBe(true);
    expect(versionMatches("0.22.2", "0.22.2-71fc6804")).toBe(true);
    expect(versionMatches("0.22.2", "0.22.5")).toBe(false);
  });

  it("parses matrix updated date", () => {
    expect(parseMatrixUpdated("2026-06")?.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    expect(parseMatrixUpdated("2026-06-15")?.toISOString()).toBe(
      "2026-06-15T00:00:00.000Z",
    );
  });

  it("detects stale matrix by age", () => {
    const now = Date.UTC(2026, 8, 1); // 2026-09-01, fixed so the test never ages out
    expect(isMatrixStale("2026-08", 45, now)).toBe(false);
    expect(isMatrixStale("2026-07-01", 45, now)).toBe(true);
    expect(isMatrixStale("2024-01", 45, now)).toBe(true);
  });

  it("builds local package checks against matrix pins", () => {
    const checks = buildLocalPackageChecks(
      {
        node: "0.22.5",
        ledger: "8.0.3",
        indexer: "4.0.1",
        indexerApi: "v4",
        proofServer: "8.0.3",
        onChainRuntime: "3.0.0",
        packages: {
          "@midnight-ntwrk/ledger-v8": "8.0.3",
          "@midnight-ntwrk/compact-runtime": "0.16.0",
        },
      },
      {
        "@midnight-ntwrk/ledger-v8": "^8.0.3",
        "@midnight-ntwrk/compact-runtime": "0.15.0",
        "@midnight-ntwrk/wallet-sdk-facade": "3.0.0",
      },
    );
    const ledger = checks.find((c) => c.label.includes("ledger-v8"));
    const compact = checks.find((c) => c.label.includes("compact-runtime"));
    expect(ledger?.ok).toBe(true);
    expect(compact?.ok).toBe(false);
  });

  it("detects indexer API from URL", () => {
    expect(
      detectIndexerApi(
        "https://indexer.preprod.midnight.network/api/v4/graphql",
      ),
    ).toBe("v4");
  });

  it("warns when live node version mismatches selected network", () => {
    const matrix = {
      docUrl: "https://example.com",
      updated: "2026-06",
      networks: {
        preprod: {
          node: "0.22.5",
          ledger: "8.0.3",
          indexer: "4.0.1",
          indexerApi: "v4",
          proofServer: "8.0.3",
          onChainRuntime: "3.0.0",
        },
        preview: {
          node: "0.22.2",
          ledger: "8.1.0",
          indexer: "4.0.1",
          indexerApi: "v4",
          proofServer: "8.1.0",
          onChainRuntime: "3.0.0",
        },
      },
    };
    expect(
      buildNetworkMismatchWarning("preprod", matrix, "0.22.2"),
    ).toContain("preview");
    expect(
      buildNetworkMismatchWarning("preprod", matrix, "0.22.5"),
    ).toBeUndefined();
  });

  it("builds checks with protocolVersion alignment", () => {
    const checks = buildVersionChecks(
      {
        node: "0.22.2",
        ledger: "8.0.3",
        indexer: "4.0.1",
        indexerApi: "v4",
        proofServer: "8.0.3",
        onChainRuntime: "3.0.0",
      },
      {
        nodeVersion: "0.22.2",
        runtimeSpecVersion: 22000,
        runtimeImplVersion: 0,
        indexerProtocolVersion: 22000,
        indexerApi: "v4",
      },
    );
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("checks proof-server version when live version provided", () => {
    const checks = buildVersionChecks(
      {
        node: "0.22.5",
        ledger: "8.0.3",
        indexer: "4.0.1",
        indexerApi: "v4",
        proofServer: "8.0.3",
        onChainRuntime: "3.0.0",
      },
      {
        nodeVersion: "0.22.5",
        runtimeSpecVersion: 22000,
        runtimeImplVersion: 0,
        indexerProtocolVersion: 22000,
        indexerApi: "v4",
      },
      "8.0.3",
    );
    const proof = checks.find((c) => c.label === "proof-server");
    expect(proof?.ok).toBe(true);
    expect(proof?.live).toBe("8.0.3");
  });
});

describe("minimum node and runtime spec", () => {
  // The Oct 2026 situation: runtime 1.0.300 needs node >= 1.0.300; Midnight's
  // endpoints report 1.0.400 and Blockfrost's mainnet node reports 2.1.0.
  const row = {
    node: "1.0.300",
    minNode: "1.0.300",
    runtimeSpec: 1000300,
    ledger: "8.1.2",
    indexer: "4.3.302",
    indexerApi: "v4",
    proofServer: "8.1.0",
    onChainRuntime: "3.0.0",
  };
  const live = (nodeVersion: string, spec = 1000300) => ({
    nodeVersion,
    runtimeSpecVersion: spec,
    runtimeImplVersion: 0,
    indexerProtocolVersion: spec,
    indexerApi: "v4",
  });

  it("compares dotted versions numerically", () => {
    expect(compareVersions("1.0.400", "1.0.300")).toBe(1);
    expect(compareVersions("1.0.300", "1.0.300")).toBe(0);
    expect(compareVersions("1.0.2", "1.0.300")).toBe(-1);
    expect(compareVersions("2.1.0", "1.0.300")).toBe(1);
    expect(compareVersions("1.0.300-abc", "1.0.300")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  it("accepts any node at or above the minimum", () => {
    expect(nodeSatisfies(row, "1.0.300")).toBe(true);
    expect(nodeSatisfies(row, "1.0.400")).toBe(true);
    expect(nodeSatisfies(row, "2.1.0")).toBe(true);
    expect(nodeSatisfies(row, "1.0.2")).toBe(false);
  });

  it("keeps exact matching when no minimum is set", () => {
    const { minNode: _min, ...exact } = row;
    expect(nodeSatisfies(exact, "1.0.300")).toBe(true);
    expect(nodeSatisfies(exact, "1.0.400")).toBe(false);
  });

  it("passes Midnight's 1.0.400 and Blockfrost's 2.1.0, fails 1.0.2", () => {
    for (const v of ["1.0.400", "2.1.0"]) {
      expect(buildVersionChecks(row, live(v)).every((c) => c.ok)).toBe(true);
    }
    const old = buildVersionChecks(row, live("1.0.2"));
    expect(old.find((c) => c.label === "node")).toMatchObject({ ok: false, expected: ">=1.0.300", live: "1.0.2" });
  });

  it("checks the runtime spec exactly", () => {
    const checks = buildVersionChecks(row, live("1.0.400", 1000400));
    expect(checks.find((c) => c.label === "runtimeSpec")).toMatchObject({
      ok: false,
      expected: "1000300",
      live: "1000400",
    });
  });

  it("warns about the network only when node or runtime spec don't fit", () => {
    const matrix = { docUrl: "x", updated: "2026-10", networks: { mainnet: row } };
    expect(buildNetworkMismatchWarning("mainnet", matrix, "2.1.0", 1000300)).toBeUndefined();
    expect(buildNetworkMismatchWarning("mainnet", matrix, "1.0.2", 1000300)).toContain(">=1.0.300");
    expect(buildNetworkMismatchWarning("mainnet", matrix, "1.0.400", 1000400)).toContain("runtime spec 1000300");
  });
});

const integration = process.env.INTEGRATION === "1";

describe.skipIf(!integration)("fetchLiveVersions", () => {
  // Matrix drift is tracked by .github/workflows/live.yml; assert invariants only.
  it("reads preprod live versions", async () => {
    const live = await fetchLiveVersions(
      "https://rpc.preprod.midnight.network",
      "https://indexer.preprod.midnight.network/api/v4/graphql",
    );
    expect(live.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(live.indexerApi).toBe("v4");
    expect(live.runtimeSpecVersion).toBeGreaterThan(0);
    expect(live.indexerProtocolVersion).toBe(live.runtimeSpecVersion);
  });
});
