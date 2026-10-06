import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { unshieldedHoldings } from "../src/clients/indexer.js";
import type { ServiceResult } from "../src/commands/ping.js";
import {
  NIGHT_TOKEN_TYPE,
  addressKind,
  cardanoWallet,
  formatPreflightHuman,
  formatUnits,
  networkCheck,
  proofServerCheck,
  unshieldedWallet,
} from "../src/commands/preflight.js";
import { parseEnvelope } from "./schema.js";

const execFileAsync = promisify(execFile);
const CLOSED_PORT = "http://127.0.0.1:9";
const ADDRESS = "mn_addr_preprod1rwk3px4llmgruwupgpteghcq6c6956eu3de9xtgs5f8mgcaw6rls0d5mz9";

const utxo = (intentHash: string, value: string, registered = true, tokenType = NIGHT_TOKEN_TYPE) => ({
  tokenType,
  value,
  registeredForDustGeneration: registered,
  intentHash,
  outputIndex: 0,
});

/** An indexer that answers the unshielded subscription with these payloads, the way graphql-transport-ws does. */
async function fakeIndexer(events: unknown[], { complete = false, raw = false } = {}) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as { type: string; id?: string };
      if (message.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (message.type === "subscribe") {
        for (const event of events) {
          socket.send(JSON.stringify({ type: "next", id: message.id, payload: raw ? event : { data: { unshieldedTransactions: event } } }));
        }
        if (complete) socket.send(JSON.stringify({ type: "complete", id: message.id }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    indexerWs: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
    },
  };
}

const progress = (highestTransactionId: number) => ({ __typename: "UnshieldedTransactionsProgress", highestTransactionId });
const tx = (id: number, createdUtxos: unknown[], spentUtxos: unknown[] = []) => ({ __typename: "UnshieldedTransaction", transaction: { id }, createdUtxos, spentUtxos });

describe("preflight", () => {
  it("tells unshielded and Cardano addresses apart, and refuses another network's address", () => {
    const preprod = { name: "preprod", id: "preprod" };
    expect(addressKind(ADDRESS, preprod)).toEqual({ kind: "unshielded" });
    expect(addressKind(ADDRESS, { name: "preview", id: "preview" })).toEqual({ error: `${ADDRESS} is a preprod address, but preview uses mn_addr_preview1… addresses` });
    expect(addressKind("mn_addr_undeployed1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r", { name: "local", id: "local" })).toEqual({ kind: "unshielded" });
    expect(addressKind("mn_addr1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r", preprod)).toHaveProperty("error", expect.stringContaining("is a mainnet address"));
    expect(addressKind("mn_addr1gkasr3z3vwyscy2jpp53nzr37v7n4r3lsfgj6v5g584dakjzt0xqun4d4r", { name: "mainnet", id: "mainnet" })).toEqual({ kind: "unshielded" });
    expect(addressKind("stake_test1uqfu74w3wh4gfzu8m6e7j987h4lq9r3t7ef5gaw497uu85qsqfy27", preprod)).toEqual({ kind: "cardano" });
    expect(addressKind("stake1uyfu74w3wh4gfzu8m6e7j987h4lq9r3t7ef5gaw497uu85qh2rxwr", preprod)).toHaveProperty("error", expect.stringContaining("mainnet reward address"));
    expect(addressKind("0xabc", preprod)).toHaveProperty("error");
  });

  it("shows atomic units in whole tokens", () => {
    expect(formatUnits(12_500_000n, 1_000_000n, 6)).toBe("12.5");
    expect(formatUnits(19_487_473n, 1_000_000n, 6)).toBe("19.487473");
    expect(formatUnits(0n, 1_000_000n, 6)).toBe("0");
  });

  const ok = (service: string, version?: string): ServiceResult => ({ service, status: "OK", latencyMs: 1, ...(version ? { version } : {}) });

  it("checks both services answer and the indexer keeps up", () => {
    expect(networkCheck([ok("rpc"), ok("indexer")], { delta: 1 })).toEqual({ name: "network", ok: true, detail: "the RPC and indexer answer, and the indexer is 1 block from the node" });
    expect(networkCheck([ok("rpc"), ok("indexer")], { delta: 150 })).toMatchObject({ ok: false, detail: expect.stringContaining("150 blocks behind the node") });
    expect(networkCheck([ok("rpc"), ok("indexer")], { delta: -150 })).toMatchObject({ ok: false, detail: "the RPC is 150 blocks behind the indexer" });
    expect(networkCheck([{ service: "rpc", status: "FAIL", latencyMs: 1, detail: "RPC unreachable", errorKind: "refused" }, ok("indexer")], undefined)).toEqual({
      name: "network",
      ok: false,
      detail: "RPC: RPC unreachable",
      errorKind: "refused",
    });
  });

  it("tells a proof server on the wrong version from one that doesn't answer", () => {
    const wrongVersion: ServiceResult = { service: "proof-server", status: "FAIL", latencyMs: 1, detail: "version=7.0.0 (expected 8.1.0)", version: "7.0.0" };
    expect(proofServerCheck([wrongVersion], "http://127.0.0.1:6300", "8.1.0", "preprod")).toEqual({
      name: "proof-server",
      ok: false,
      detail: "answers at http://127.0.0.1:6300 but runs 7.0.0; preprod expects 8.1.0",
    });
    const down: ServiceResult = { service: "proof-server", status: "FAIL", latencyMs: 1, detail: "fetch failed" };
    expect(proofServerCheck([down], "http://127.0.0.1:6300", "8.1.0", "preprod").detail).toBe(
      "not reachable at http://127.0.0.1:6300 (fetch failed). Start one running 8.1.0, the version preprod expects",
    );
    expect(proofServerCheck([ok("proof-server", "8.1.0")], "http://127.0.0.1:6300", "8.1.0", "preprod")).toMatchObject({ ok: true });
    expect(proofServerCheck([ok("proof-server", "8.1.3")], "http://127.0.0.1:6300", "8.1.0", "preprod")).toEqual({
      name: "proof-server",
      ok: true,
      detail: "answers at http://127.0.0.1:6300 and runs 8.1.3, a newer patch than the 8.1.0 preprod lists",
    });
    expect(proofServerCheck([ok("proof-server", "1.2.3")], "http://127.0.0.1:6300", undefined, "local")).toMatchObject({ ok: true });
    expect(proofServerCheck([], undefined, "8.1.0", "mainnet")).toMatchObject({ ok: false, detail: expect.stringContaining("no proof server configured") });
  });

  it("checks the wallet holds NIGHT that is registered for DUST", () => {
    const faucet = "https://faucet.example";
    expect(unshieldedWallet(ADDRESS, { utxos: [], transactions: 0, complete: true }, faucet).check).toEqual({
      name: "wallet",
      ok: false,
      detail: `no NIGHT at this address. Fund it from the faucet (${faucet})`,
    });
    const unregistered = unshieldedWallet(ADDRESS, { utxos: [utxo("a", "5000000", false)], transactions: 1, complete: true }, faucet);
    expect(unregistered.check).toMatchObject({ ok: false, detail: expect.stringContaining("5 NIGHT in 1 UTXO, none registered") });
    const ready = unshieldedWallet(ADDRESS, { utxos: [utxo("a", "5000000"), utxo("b", "2500000", false), utxo("c", "9", true, "86".repeat(32))], transactions: 3, complete: true }, faucet);
    expect(ready.check).toMatchObject({ ok: true, detail: expect.stringMatching(/^7\.5 NIGHT in 2 UTXOs, 1 registered for DUST generation\. DUST builds up/) });
    expect(ready.wallet).toMatchObject({ night: "7.5", nightUtxos: 2, registeredUtxos: 1, complete: true });
    const partial = unshieldedWallet(ADDRESS, { utxos: [utxo("a", "1000000")], transactions: 40, complete: false }, undefined);
    expect(partial.check.detail).toContain("read 40 transactions before the timeout");
  });

  it("doesn't send a wallet to the faucet when it couldn't read the whole history", () => {
    const check = unshieldedWallet(ADDRESS, { utxos: [], transactions: 4000, complete: false }, "https://faucet.example").check;
    expect(check).toMatchObject({ ok: false, detail: expect.stringContaining("couldn't read the whole history in time: 4000 transactions read") });
    expect(check.detail).not.toContain("faucet");
  });

  it("doesn't call a Cardano wallet ready before it has generated any DUST", () => {
    const base = { cardanoRewardAddress: "stake_test1x", nightBalance: "5000000", generationRate: "1", maxCapacity: "10", utxo: undefined };
    expect(cardanoWallet("stake_test1x", { ...base, registered: true, currentCapacity: "0" }).check).toMatchObject({ ok: false, detail: expect.stringContaining("no DUST generated yet") });
    expect(cardanoWallet("stake_test1x", { ...base, registered: true, currentCapacity: "2500000000000000" }).check).toMatchObject({ ok: true, detail: expect.stringContaining("with 2.5 DUST generated") });
    expect(cardanoWallet("stake_test1x", { ...base, registered: false, currentCapacity: "0" }).check.ok).toBe(false);
  });

  it("follows an address's UTXOs until the indexer catches up", async () => {
    const indexer = await fakeIndexer([progress(3), tx(1, [utxo("a", "1000000"), utxo("b", "2000000")]), tx(3, [utxo("c", "3000000")], [{ intentHash: "a", outputIndex: 0 }])]);
    try {
      const holdings = await unshieldedHoldings(indexer, ADDRESS, { timeoutMs: 5000 });
      expect(holdings).toMatchObject({ transactions: 2, complete: true });
      expect(holdings.utxos.map((u) => u.intentHash).sort()).toEqual(["b", "c"]);
    } finally {
      indexer.stop();
    }
  });

  it("finishes when the progress arrives after the transactions, and fails on an indexer error instead of reading an empty wallet", async () => {
    const lateProgress = await fakeIndexer([tx(1, [utxo("a", "1000000")]), tx(2, [utxo("b", "2000000")]), progress(2)]);
    const rejected = await fakeIndexer([{ data: null, errors: [{ message: "invalid address" }] }], { raw: true, complete: true });
    const silent = await fakeIndexer([], { complete: true });
    try {
      const started = Date.now();
      expect(await unshieldedHoldings(lateProgress, ADDRESS, { timeoutMs: 5000 })).toMatchObject({ transactions: 2, complete: true });
      expect(Date.now() - started).toBeLessThan(2000);
      await expect(unshieldedHoldings(rejected, ADDRESS, { timeoutMs: 5000 })).rejects.toThrow("Indexer rejected the query: invalid address");
      await expect(unshieldedHoldings(silent, ADDRESS, { timeoutMs: 5000 })).rejects.toThrow("without sending anything");
    } finally {
      lateProgress.stop();
      rejected.stop();
      silent.stop();
    }
  });

  it("finishes at once for an address with no transactions, and reports a partial read at the timeout", async () => {
    const empty = await fakeIndexer([progress(0)]);
    const partial = await fakeIndexer([progress(5), tx(1, [utxo("a", "1000000")])]);
    try {
      expect(await unshieldedHoldings(empty, ADDRESS, { timeoutMs: 5000 })).toEqual({ utxos: [], transactions: 0, complete: true });
      expect(await unshieldedHoldings(partial, ADDRESS, { timeoutMs: 300 })).toMatchObject({ transactions: 1, complete: false });
    } finally {
      empty.stop();
      partial.stop();
    }
  });

  it("says what to expect, and leaves the not-ready line to the error", () => {
    const text = formatPreflightHuman({
      network: "preprod",
      ready: false,
      checks: [{ name: "proof-server", ok: false, detail: "not reachable" }],
      expectations: { report: "https://example/report", date: "2026-09-30", coldSyncMinutes: 67, restoreSeconds: "105-123" },
    });
    expect(text).toContain("FAIL proof server not reachable");
    expect(text).toContain("Expect, from Midnight's examples run on preprod (30 Sep 2026): a new wallet's first sync took about 67 minutes; restoring one from a pre-seed bundle took 105-123 seconds.");
    expect(text).not.toContain("Ready.");
  });

  it("reports what's down when the network can't be reached, and refuses a bad address before any request", async () => {
    const cli = join(process.cwd(), "dist", "cli.js");
    const run = async (args: string[]) => {
      try {
        const { stdout } = await execFileAsync("node", [cli, ...args], { timeout: 20000 });
        return { stdout, code: 0 };
      } catch (err) {
        const e = err as { stdout?: string; code?: number };
        return { stdout: e.stdout ?? "", code: e.code ?? 1 };
      }
    };
    const down = await run(["preflight", "preprod", "--json", "--offline", "--rpc", CLOSED_PORT, "--indexer-http", CLOSED_PORT, "--proof-server", CLOSED_PORT]);
    expect(down.code).toBe(1);
    const envelope = parseEnvelope(down.stdout) as { error: { message: string }; data: { ready: boolean; checks: Array<{ name: string; ok: boolean }> } };
    expect(envelope.data.ready).toBe(false);
    expect(envelope.data.checks.map((c) => [c.name, c.ok])).toEqual([["network", false], ["proof-server", false]]);
    expect(envelope.error.message).toBe("Not ready: network, proof server");
    const bad = await run(["preflight", "preprod", "--json", "--address", "0xabc", "--rpc", CLOSED_PORT]);
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: { kind: "usage" } });
  }, 30_000);
});
