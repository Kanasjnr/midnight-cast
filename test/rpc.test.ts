import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rpcCommand } from "../src/commands/rpc.js";
import { READ_ONLY_RPC_METHODS, isReadOnlyRpcMethod } from "../src/lib/rpc-methods.js";
import { withOwnWarnings } from "../src/output.js";

const answer = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });

const integration = process.env.INTEGRATION === "1";

describe("rpcCommand", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a method that isn't read-only without sending it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await rpcCommand("author_submitExtrinsic", '["0x00"]', "preview", {}, { json: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("author_submitExtrinsic isn't on rpc's list of read-only methods");
    expect(result.hint).toContain("--allow-write");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends it with --allow-write, with a warning and no retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const { value, warnings } = await withOwnWarnings(() =>
      rpcCommand("author_submitExtrinsic", '["0x00"]', "preview", {}, { json: true }, { allowWrite: true }),
    );
    expect(value.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnings).toEqual([expect.stringContaining("may submit or change node state")]);
  });

  it("sends a read-only method without a warning", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer("2.1.101")));
    const { value, warnings } = await withOwnWarnings(() => rpcCommand("system_version", undefined, "preview", {}, { json: true }));
    expect(value.ok).toBe(true);
    expect((value.data as { result: string }).result).toBe("2.1.101");
    expect(warnings).toEqual([]);
  });

  it("rejects invalid params JSON", async () => {
    const result = await rpcCommand(
      "chain_getHeader",
      "not-json",
      "preprod",
      {},
      { json: true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid JSON params");
  });

  it.skipIf(!integration)("calls chain_getHeader on preprod", async () => {
    const result = await rpcCommand(
      "chain_getHeader",
      "[]",
      "preprod",
      {},
      { json: true },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { result: { number: string } };
    expect(data.result.number).toMatch(/^0x/i);
  });
});

describe("rpc's read-only methods", () => {
  it("leave out submitting, keys, peers, logs, offchain storage, subscriptions and unsafe reads", () => {
    const writes = READ_ONLY_RPC_METHODS.filter((m) =>
      /submit|insertKey|rotateKeys|removeExtrinsic|Peer|LogFilter|offchain_|subscribe|unwatch|follow|broadcast|dryRun|traceBlock|getPairs|queryStorage$|stop/i.test(m),
    );
    expect(writes).toEqual([]);
    expect(new Set(READ_ONLY_RPC_METHODS).size).toBe(READ_ONLY_RPC_METHODS.length);
    expect(isReadOnlyRpcMethod("chain_getHeader")).toBe(true);
    expect(isReadOnlyRpcMethod("author_submitExtrinsic")).toBe(false);
  });

  it("are listed under rpc in explain --json, and only there", () => {
    const commands = JSON.parse(execFileSync("node", ["dist/cli.js", "explain", "--json"], { encoding: "utf8" })).data
      .commands as Array<{ name: string; readOnlyMethods?: string[] }>;
    expect(commands.find((c) => c.name === "rpc")?.readOnlyMethods).toEqual([...READ_ONLY_RPC_METHODS]);
    expect(commands.filter((c) => c.readOnlyMethods).map((c) => c.name)).toEqual(["rpc"]);
  });
});
