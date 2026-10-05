import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blockAtHeightCommand } from "../src/commands/block.js";
import { decodeCommand } from "../src/commands/decode.js";
import { txCommand } from "../src/commands/tx.js";

const json = { json: true };

describe("inputs that don't exist or don't parse", () => {
  const realFetch = globalThis.fetch;
  const realConfig = process.env.XDG_CONFIG_HOME;
  beforeEach(() => {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mc-input-"));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = realConfig;
  });

  it("refuses a block height the chain hasn't reached instead of returning the latest block", async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const { method, params } = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      const result =
        method === "chain_getBlockHash" ? null : { number: "0x10", parentHash: "0x01", stateRoot: "0x02", extrinsicsRoot: "0x03" };
      expect(method === "chain_getHeader" ? params : []).toEqual([]);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as typeof fetch;
    const result = await blockAtHeightCommand("999999999", "preprod", {}, json);
    expect(result).toMatchObject({ ok: false, error: "Block 999999999 doesn't exist yet; the latest is 16" });
  });

  it("checks a transaction hash before asking the indexer", async () => {
    globalThis.fetch = (async () => {
      throw new Error("the indexer should not be asked");
    }) as typeof fetch;
    const result = await txCommand("abc", "preprod", {}, json);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^Invalid transaction hash: abc/);
    expect(result.errorKind).toBeUndefined();
  });

  it("says nothing was recognised in a sentence instead of blaming a ledger code", () => {
    const result = decodeCommand([], { json: true, raw: "something went wrong" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^No Midnight error recognised in this message/);
  });
});
