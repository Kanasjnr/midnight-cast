import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkError, isTransportKind, statusKind, transportKind } from "../src/lib/network-error.js";
import { jsonRpc } from "../src/clients/rpc.js";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { gqlPost, subscribeDustEvents, subscriptionTimeout, wsFailure } from "../src/clients/indexer.js";
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

describe("WebSocket failures", () => {
  it("reports a close code and its reason, mapping 4xxx to the HTTP status it mirrors", () => {
    const forbidden = wsFailure({ code: 4403, reason: "Forbidden" });
    expect(forbidden).toMatchObject({ message: "Indexer WS closed (4403: Forbidden)", kind: "http_4xx", status: 403 });
    expect(forbidden.hint).toMatch(/token/);
    expect(wsFailure({ code: 1006, reason: "" })).toMatchObject({ message: "Indexer WS closed (1006)", kind: "network" });
  });

  it("maps only HTTP-like close codes to statuses", () => {
    expect(wsFailure({ code: 1008, reason: "" })).toMatchObject({ kind: "http_4xx", status: 403 });
    expect(wsFailure({ code: 1008, reason: "" }).hint).not.toMatch(/undefined/);
    expect(wsFailure({ code: 4500, reason: "boom" })).toMatchObject({ kind: "http_5xx", status: 500 });
    expect(wsFailure({ code: 4408, reason: "" })).toMatchObject({ kind: "timeout" });
    for (const code of [4409, 4429, 4499]) {
      expect(wsFailure({ code, reason: "" })).toMatchObject({ kind: "network", status: undefined });
    }
  });

  it("gives the subscription timeout a hint that matches what happened", () => {
    expect(subscriptionTimeout(false, true).hint).toMatch(/never connected/);
    expect(subscriptionTimeout(true, true).hint).toMatch(/id may not exist/);
    expect(subscriptionTimeout(true, false).hint).toMatch(/no events arrived/);
  });

  it("classifies a refused handshake by its HTTP status, with Blockfrost's explanation on Blockfrost", () => {
    const rejected = { message: "Unexpected server response: 403" };
    expect(wsFailure(rejected, "wss://midnight-mainnet.blockfrost.io/api/v0/ws")).toMatchObject({
      kind: "http_4xx",
      status: 403,
      message: expect.stringContaining("rejected by Blockfrost (403)"),
    });
    expect(wsFailure(rejected, "ws://127.0.0.1:8088/api/v4/graphql/ws")).toMatchObject({
      message: "Indexer WS unreachable (403)",
      kind: "http_4xx",
    });
  });

  it("points WebSocket timeouts at --indexer-ws", () => {
    expect(wsFailure({ code: 4408, reason: "" }).hint).toMatch(/--indexer-ws/);
    expect(wsFailure({ message: "", error: Object.assign(new Error("t"), { code: "ETIMEDOUT" }) }).hint).toMatch(/--indexer-ws/);
  });

  it("points a WebSocket 404 at the subscription path", () => {
    expect(wsFailure({ message: "Unexpected server response: 404" }).hint).toMatch(/\/api\/v4\/graphql\/ws/);
  });

  it("treats a redirected handshake as a URL problem, not a rejection", () => {
    const redirected = wsFailure({ message: "Unexpected server response: 301" }, "ws://indexer.example/api/v4/graphql/ws");
    expect(redirected).toMatchObject({ message: "Indexer WS redirected (301)", kind: "network", status: 301 });
    expect(redirected.hint).toMatch(/wss:\/\//);
  });

  it("falls back to the error code when the event's message is empty", () => {
    const failure = wsFailure({ message: "", error: Object.assign(new Error(""), { code: "ECONNREFUSED" }) });
    expect(failure).toMatchObject({ message: "Indexer WS unreachable: ECONNREFUSED", kind: "refused" });
  });
});

describe("WebSocket rejection that graphql-ws retries", () => {
  it("reports the server's close reason when the subscription times out", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => socket.on("message", () => socket.close(4403, "Forbidden")));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(
        subscribeDustEvents({ indexerWs: `ws://127.0.0.1:${port}` }, { fromId: 1, limit: 1, timeoutMs: 1500 }),
      ).rejects.toMatchObject({ message: "Indexer WS closed (4403: Forbidden)", kind: "http_4xx", status: 403 });
    } finally {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
    }
  });
});

describe("WebSocket that connects and then drops", () => {
  it("reports the drop instead of blaming missing events", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) =>
      socket.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as { type: string };
        if (message.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
        if (message.type === "subscribe") socket.close(4403, "Forbidden");
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(
        subscribeDustEvents({ indexerWs: `ws://127.0.0.1:${port}` }, { fromId: 1, limit: 1, timeoutMs: 1500 }),
      ).rejects.toMatchObject({ message: "Indexer WS closed (4403: Forbidden)", kind: "http_4xx" });
    } finally {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
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
