import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkError, isTransportKind, statusKind, transportKind } from "../src/lib/network-error.js";
import { jsonRpc } from "../src/clients/rpc.js";
import { gqlPost } from "../src/clients/indexer.js";
import { emit, fail } from "../src/output.js";
import { runServiceChecks } from "../src/commands/ping.js";

const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });
const named = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transportKind", () => {
  it("reads the failure from Node's error codes, not the message", () => {
    expect(transportKind(named("TimeoutError"))).toBe("timeout");
    expect(transportKind(named("AbortError"))).toBe("timeout");
    expect(transportKind(fetchFailed("ENOTFOUND"))).toBe("dns");
    expect(transportKind(fetchFailed("EAI_AGAIN"))).toBe("dns");
    expect(transportKind(fetchFailed("ECONNREFUSED"))).toBe("refused");
    expect(transportKind(fetchFailed("ETIMEDOUT"))).toBe("timeout");
    expect(transportKind(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe("timeout");
    expect(transportKind(fetchFailed("CERT_HAS_EXPIRED"))).toBe("tls");
    expect(transportKind(fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT"))).toBe("tls");
    expect(transportKind(fetchFailed("ECONNRESET"))).toBe("network");
    expect(transportKind("something")).toBe("network");
    expect(transportKind({ error: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) })).toBe("refused");
  });

  it("separates transport failures from HTTP and protocol ones", () => {
    expect(statusKind(404)).toBe("http_4xx");
    expect(statusKind(503)).toBe("http_5xx");
    expect(isTransportKind("timeout")).toBe(true);
    expect(isTransportKind("http_5xx")).toBe(false);
  });
});

describe("hints", () => {
  it("points a 404 on the indexer at the GraphQL path", () => {
    expect(new NetworkError("Indexer unreachable (404)", "http_4xx", "Indexer", 404).hint).toMatch(/\/api\/v4\/graphql/);
  });

  it("adds nothing to Blockfrost's own explanation", () => {
    expect(new NetworkError("RPC rejected by Blockfrost (403): ...", "http_4xx", "RPC", 403).hint).toBeUndefined();
  });

  it("asks whether a local node is running when nothing listens", () => {
    expect(new NetworkError("RPC unreachable", "refused", "RPC").hint).toMatch(/running/);
  });
});

describe("clients throw classified errors", () => {
  it("classifies transport, HTTP, RPC, GraphQL and malformed responses", async () => {
    const cases: Array<[Response | Error, () => Promise<unknown>, string]> = [
      [fetchFailed("ECONNREFUSED"), () => jsonRpc("http://x", "system_health", [], { attempts: 1 }), "refused"],
      [new Response("", { status: 404 }), () => gqlPost("http://x", "query { block { height } }"), "http_4xx"],
      [new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } })), () => jsonRpc("http://x", "nope"), "rpc_error"],
      [new Response(JSON.stringify({ errors: [{ message: "Unknown field" }] })), () => gqlPost("http://x", "query { nope }"), "graphql_error"],
      [new Response("<html>"), () => jsonRpc("http://x", "system_health"), "invalid_response"],
    ];
    for (const [response, call, kind] of cases) {
      const fetchMock = vi.fn();
      if (response instanceof Error) fetchMock.mockRejectedValue(response);
      else fetchMock.mockResolvedValue(response);
      vi.stubGlobal("fetch", fetchMock);
      await expect(call()).rejects.toMatchObject({ name: "NetworkError", kind });
    }
  });
});

describe("reporting", () => {
  it("adds errorKind and hint next to the unchanged error message", () => {
    expect(fail(new NetworkError("RPC unreachable", "dns", "RPC"))).toMatchObject({
      ok: false,
      error: "RPC unreachable",
      errorKind: "dns",
      hint: expect.stringContaining("doesn't resolve"),
    });
    expect(fail(new Error("Unknown network"))).toEqual({ ok: false, error: "Unknown network", exitCode: 1 });
    expect(fail("plain")).toEqual({ ok: false, error: "plain", exitCode: 1 });
  });

  it("prints the hint under the error in human mode and includes it in --json", () => {
    const err: string[] = [];
    const out: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m) => void err.push(String(m)));
    vi.spyOn(console, "log").mockImplementation((m) => void out.push(String(m)));
    const result = fail(new NetworkError("RPC unreachable", "refused", "RPC"));
    emit(result, {});
    expect(err).toEqual(["RPC unreachable", expect.stringMatching(/^Hint: Nothing is listening/)]);
    emit(result, { json: true });
    expect(JSON.parse(out[0]!)).toMatchObject({ ok: false, error: "RPC unreachable", errorKind: "refused" });
  });

  it("labels each failed ping row with its kind", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fetchFailed("ENOTFOUND")));
    const rows = await runServiceChecks({ rpc: "http://rpc", indexerHttp: "http://idx" });
    expect(rows.find((r) => r.service === "rpc")).toMatchObject({ status: "FAIL", errorKind: "dns" });
    expect(rows.find((r) => r.service === "indexer")).toMatchObject({ status: "FAIL", errorKind: "dns" });
  });
});
