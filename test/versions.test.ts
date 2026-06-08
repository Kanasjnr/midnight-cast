import { describe, expect, it } from "vitest";
import {
  buildVersionChecks,
  detectIndexerApi,
  isMatrixStale,
  parseMatrixUpdated,
  parseNodeVersion,
  versionMatches,
  fetchLiveVersions,
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
    expect(isMatrixStale("2026-06", 45)).toBe(false);
    expect(isMatrixStale("2024-01", 45)).toBe(true);
  });

  it("detects indexer API from URL", () => {
    expect(
      detectIndexerApi(
        "https://indexer.preprod.midnight.network/api/v4/graphql",
      ),
    ).toBe("v4");
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
});

describe("fetchLiveVersions", () => {
  it("reads preprod live versions", async () => {
    const live = await fetchLiveVersions(
      "https://rpc.preprod.midnight.network",
      "https://indexer.preprod.midnight.network/api/v4/graphql",
    );
    expect(live.nodeVersion).toMatch(/^0\.22\./);
    expect(live.runtimeSpecVersion).toBeGreaterThan(0);
    expect(live.indexerProtocolVersion).toBe(live.runtimeSpecVersion);
  });
});
