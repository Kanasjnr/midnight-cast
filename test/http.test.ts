import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "../src/lib/http.js";
import { jsonRpc } from "../src/clients/rpc.js";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("", { status: code });

function stubFetch(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fast = { timeoutMs: 1000, retryDelayMs: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postJson", () => {
  it("returns the first successful response", async () => {
    const fetchMock = stubFetch(ok({ a: 1 }));
    const response = await postJson("http://x", { q: 1 }, fast);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 502, 503 and 504 until one succeeds", async () => {
    const fetchMock = stubFetch(status(503), status(502), ok({}));
    const response = await postJson("http://x", {}, fast);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries timeouts and network errors", async () => {
    const fetchMock = stubFetch(new Error("timeout"), ok({}));
    expect((await postJson("http://x", {}, fast)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry client errors", async () => {
    const fetchMock = stubFetch(status(403), ok({}));
    expect((await postJson("http://x", {}, fast)).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last attempt", async () => {
    const fetchMock = stubFetch(status(503), status(503), status(503));
    expect((await postJson("http://x", {}, fast)).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    stubFetch(new Error("down"), new Error("down"), new Error("down"));
    await expect(postJson("http://x", {}, fast)).rejects.toThrow("down");
  });

  it("stops at the time budget when an endpoint never answers", async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("timeout")));
        }),
    );
    vi.stubGlobal("fetch", hang);
    const started = Date.now();
    await expect(
      postJson("http://x", {}, { timeoutMs: 100, budgetMs: 250, retryDelayMs: 10, attempts: 5 }),
    ).rejects.toThrow("timeout");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(hang.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(hang.mock.calls.length).toBeLessThan(5);
  });

  it("cancels the body of a response it retries", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    stubFetch(new Response(body, { status: 503 }), ok({}));
    await postJson("http://x", {}, fast);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("sends the JSON body and extra headers", async () => {
    const fetchMock = stubFetch(ok({}));
    await postJson("http://x", { query: "q" }, { ...fast, headers: { project_id: "p" } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe('{"query":"q"}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", project_id: "p" });
  });
});

describe("jsonRpc retries", () => {
  it("retries a read through a slow backend", async () => {
    const fetchMock = stubFetch(new Error("timeout"), ok({ jsonrpc: "2.0", id: 1, result: "1.0.400" }));
    await expect(jsonRpc("http://x", "system_version", [], { timeoutMs: 1000 })).resolves.toBe("1.0.400");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("makes a single attempt when asked to", async () => {
    const fetchMock = stubFetch(new Error("timeout"), ok({ jsonrpc: "2.0", id: 1, result: "x" }));
    await expect(jsonRpc("http://x", "author_submitExtrinsic", [], { attempts: 1 })).rejects.toThrow(
      "RPC unreachable",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
