import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSchema, parse, validate } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DUST_SUBSCRIPTION } from "../src/clients/indexer.js";
import { blockAtHeightCommand, blockLatestCommand } from "../src/commands/block.js";
import { dustEventCommand, dustEventsCommand } from "../src/commands/dust.js";
import { healthCommand } from "../src/commands/health.js";
import { pingCommand } from "../src/commands/ping.js";
import { tipCommand } from "../src/commands/tip.js";
import { txCommand } from "../src/commands/tx.js";
import { versionsCommand } from "../src/commands/versions.js";
import { BUILTIN_NETWORKS } from "../src/networks.js";
import { toEnvelope, type EmitResult } from "../src/output.js";
import {
  compareShapes,
  exchangeKey,
  indexerQuery,
  replayFetch,
  shapeOf,
  type Exchange,
  type FixtureFile,
} from "../scripts/fixtures.js";
import { FIXTURE_NETWORKS, fixtureDir, readFixture } from "../scripts/record-fixtures.js";
import { schemaErrors } from "./schema.js";

// Replays a recorded subscription the way a Midnight indexer speaks graphql-transport-ws.
async function recordedIndexer(dust: FixtureFile["dust"]) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id?: string };
      if (message.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (message.type === "subscribe") {
        for (const payload of dust.payloads) socket.send(JSON.stringify({ type: "next", id: message.id, payload }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    stop: () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
    },
  };
}

function expectValid(command: string, result: EmitResult) {
  expect(result.ok, `${command}: ${result.error}`).toBe(true);
  expect(schemaErrors(toEnvelope(result, command, []))).toEqual([]);
}

for (const network of FIXTURE_NETWORKS) {
  const fixture = readFixture(network)!;

  describe(`recorded ${network} responses`, () => {
    const realFetch = globalThis.fetch;
    const realConfigHome = process.env.XDG_CONFIG_HOME;
    const json = { json: true };
    const { inputs } = fixture;

    beforeAll(() => {
      process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mc-replay-"));
      globalThis.fetch = replayFetch(fixture, BUILTIN_NETWORKS[network]!.proofServer);
    });
    afterAll(() => {
      globalThis.fetch = realFetch;
      if (realConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = realConfigHome;
    });

    it("parse into output that matches the published schemas", async () => {
      expectValid("ping", await pingCommand(network, {}, json));
      expectValid("tip", await tipCommand(network, {}, json));
      expectValid("health", await healthCommand(network, {}, json));
      expectValid("versions", await versionsCommand(network, { local: false }, json));
      expectValid("block", await blockLatestCommand(network, {}, json));
      expectValid("block", await blockAtHeightCommand(String(inputs.blockHeight), network, {}, json));
    });

    it("decode the recorded transaction and its DUST events", async () => {
      const tx = await txCommand(inputs.txHash, network, {}, json);
      expectValid("tx", tx);
      expect((tx.data as { hash: string }).hash).toBe(inputs.txHash);
      expect(tx.next?.map((s) => s.command)).toContain(`midnight-cast dust-event ${inputs.dustEventId} ${network}`);
    });

    it("read the recorded DUST subscription", async () => {
      const indexer = await recordedIndexer(fixture.dust);
      try {
        const flags = { indexerWs: indexer.url, timeoutMs: 5_000 };
        const one = await dustEventCommand(inputs.dustEventId, network, flags, json);
        expectValid("dust-event", one);
        expect((one.data as { id: number }).id).toBe(inputs.dustEventId);
        const many = await dustEventsCommand(
          network,
          { ...flags, from: inputs.dustEventId, limit: fixture.dust.payloads.length },
          json,
        );
        expectValid("dust-events", many);
      } finally {
        indexer.stop();
      }
    });

    it("send only queries the indexer's schema accepts", () => {
      const schema = buildSchema(readFileSync(join(fixtureDir(network), "indexer-schema.graphql"), "utf8"));
      const queries = fixture.exchanges
        .filter((e) => e.key.startsWith("indexer "))
        .map((e) => indexerQuery(e.key));
      for (const query of [...queries, DUST_SUBSCRIPTION]) {
        expect(validate(schema, parse(query)).map((e) => e.message), query).toEqual([]);
      }
    });
  });
}

describe("fixture shapes", () => {
  const exchange = (key: string, body: unknown, status = 200): Exchange => ({
    key,
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  it("key requests by what they ask for, not where they go", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "chain_getHeader", params: [] });
    expect(exchangeKey("https://rpc.a/", body)).toBe(exchangeKey("https://rpc.b/", body.replace('"id":7', '"id":8')));
    expect(exchangeKey("https://proof.x/version", undefined, "https://proof.x")).toBe("proof-server GET /version");
  });

  it("compare keys and types, not values", () => {
    expect(shapeOf({ b: [{ c: 1 }], a: "x" })).toEqual({ a: "string", b: [{ c: "number" }] });
    const before = [exchange("rpc chain_getBlockHash [\"0x10\"]", { result: "0xaa" })];
    expect(compareShapes(before, [exchange("rpc chain_getBlockHash [\"0x20\"]", { result: "0xbb" })])).toEqual([]);
    expect(compareShapes(before, [exchange("rpc chain_getBlockHash [\"0x20\"]", { result: 5 })])[0]?.change).toBe("shape");
  });

  it("allow a field to be null on one run, but not to disappear", () => {
    const before = [exchange("indexer q {}", { data: { fees: null, id: 1 } })];
    expect(compareShapes(before, [exchange("indexer q {}", { data: { fees: { paid: "1" }, id: 2 } })])).toEqual([]);
    expect(compareShapes(before, [exchange("indexer q {}", { data: { id: 2 } })])[0]?.change).toBe("shape");
  });

  it("report requests that are no longer made, or new ones", () => {
    const drift = compareShapes([exchange("rpc a []", {})], [exchange("rpc b []", {})]);
    expect(drift.map((d) => d.change)).toEqual(["missing", "new"]);
  });
});
