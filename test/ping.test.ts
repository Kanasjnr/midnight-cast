import { describe, expect, it, vi, afterEach } from "vitest";
import { runServiceChecks } from "../src/commands/ping.js";

describe("runServiceChecks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports RPC failure when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const results = await runServiceChecks({
      rpc: "http://127.0.0.1:1",
      indexerHttp: "http://127.0.0.1:2",
    });

    const rpc = results.find((r) => r.service === "rpc");
    expect(rpc?.status).toBe("FAIL");
  });

  it("skips proof-server when URL omitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { isSyncing: false, peers: 1 },
        }),
      }),
    );

    const results = await runServiceChecks({
      rpc: "http://example.com",
      indexerHttp: "http://example.com",
    });

    expect(results.some((r) => r.service === "proof-server")).toBe(false);
  });
});
