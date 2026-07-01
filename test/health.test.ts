import { describe, expect, it } from "vitest";
import { healthCommand } from "../src/commands/health.js";

describe("healthCommand", () => {
  it(
    "returns aggregate health report on preprod",
    async () => {
      const result = await healthCommand("preprod", {}, { json: true });
      expect(result.ok).toBe(true);
      const data = result.data as {
        network: string;
        healthy: boolean;
        services: Array<{ service: string; status: string }>;
        sync: { rpcHeight: number; indexerHeight: number };
        versions: { checks: Array<{ label: string }> };
      };
      expect(data.network).toBe("preprod");
      expect(data.services.some((s) => s.service === "rpc")).toBe(true);
      expect(data.services.some((s) => s.service === "indexer")).toBe(true);
      expect(data.sync.rpcHeight).toBeGreaterThan(0);
      expect(data.sync.indexerHeight).toBeGreaterThan(0);
      expect(data.versions.checks.length).toBeGreaterThan(0);
    },
    15000,
  );
});
