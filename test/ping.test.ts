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

  it("falls back to chain_getHeader when a gateway blocks system_health", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { method, query } = JSON.parse(String(init.body)) as { method?: string; query?: string };
      if (method === "system_health") return new Response("", { status: 405 });
      if (method === "chain_getHeader") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { number: "0x1" } }));
      }
      if (query) return new Response(JSON.stringify({ data: { block: { height: 1 } } }));
      throw new Error("unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await runServiceChecks({ rpc: "http://rpc", indexerHttp: "http://idx" });
    expect(results.find((r) => r.service === "rpc")?.status).toBe("OK");
  });

  it("doesn't fall back after gateway errors that outlasted the retries", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { method } = JSON.parse(String(init.body)) as { method?: string };
        if (method) methods.push(method);
        return new Response("", { status: 504 });
      }),
    );

    const results = await runServiceChecks({ rpc: "http://rpc", indexerHttp: "http://idx" });
    expect(results.find((r) => r.service === "rpc")).toMatchObject({ status: "FAIL", detail: "RPC unreachable (504)" });
    expect(methods.every((m) => m === "system_health")).toBe(true);
  });

  it("doesn't retry an unreachable RPC through the fallback", async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { method } = JSON.parse(String(init.body)) as { method?: string };
        if (method) methods.push(method);
        throw new Error("ECONNREFUSED");
      }),
    );

    const results = await runServiceChecks({ rpc: "http://rpc", indexerHttp: "http://idx" });
    expect(results.find((r) => r.service === "rpc")).toMatchObject({ status: "FAIL", detail: "RPC unreachable" });
    expect(methods.every((m) => m === "system_health")).toBe(true);
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
