import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { subscribeDustEvents } from "../src/clients/indexer.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function silentIndexer({ dropConnections = false } = {}) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let connections = 0;
  wss.on("connection", (socket) => {
    connections += 1;
    if (dropConnections) socket.terminate();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}`,
    connections: () => connections,
    stop: () => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.close();
    },
  };
}

describe("dust subscription cleanup", () => {
  it("stops reconnecting once the subscription times out", async () => {
    const indexer = await silentIndexer();
    try {
      await expect(subscribeDustEvents({ indexerWs: indexer.url }, { fromId: 1, limit: 1, timeoutMs: 500 })).rejects.toThrow(
        "Event not received within timeout",
      );
      const seen = indexer.connections();
      await sleep(2500);
      expect(indexer.connections()).toBe(seen);
    } finally {
      indexer.stop();
    }
  });

  it("leaves no pending connection behind when the indexer goes away", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const indexer = await silentIndexer();
      const subscription = subscribeDustEvents({ indexerWs: indexer.url }, { fromId: 1, limit: 1, timeoutMs: 500 });
      indexer.stop();
      await expect(subscription).rejects.toThrow();
      await sleep(2500);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("reports a refused connection straight away instead of timing out", async () => {
    const indexer = await silentIndexer();
    const url = indexer.url;
    indexer.stop();
    const started = Date.now();
    await expect(subscribeDustEvents({ indexerWs: url }, { fromId: 1, limit: 1, timeoutMs: 8000 })).rejects.toThrow(
      /unreachable/,
    );
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it("exits promptly when the timeout lands during a reconnect wait", async () => {
    const indexer = await silentIndexer({ dropConnections: true });
    try {
      const started = Date.now();
      const stdout = await new Promise<string>((resolve) => {
        execFile(
          "node",
          [join(process.cwd(), "dist", "cli.js"), "dust-events", "--from", "1", "--network", "preprod", "--indexer-ws", indexer.url, "--timeout", "1500", "--json"],
          { timeout: 15000 },
          (_err, out) => resolve(String(out)),
        );
      });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: "Indexer WS closed (1006)", kind: "network" } });
    } finally {
      indexer.stop();
    }
  });
});

// Serves DUST events from the requested id onwards, the way the indexer subscription does.
async function indexerWithEvents(ids: number[]) {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  const maxId = Math.max(...ids);
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id?: string; payload?: { variables?: { id?: number } } };
      if (message.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (message.type !== "subscribe") return;
      const from = message.payload?.variables?.id ?? 0;
      for (const id of ids.filter((i) => i >= from)) {
        const event = { id, __typename: "DustInitialUtxo", protocolVersion: 22000, raw: "0x00", maxId };
        socket.send(JSON.stringify({ type: "next", id: message.id, payload: { data: { dustLedgerEvents: event } } }));
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

describe("DUST defaults", () => {
  it("lists the latest events when no starting id is given, across gaps in the ids", async () => {
    const { dustEventsCommand } = await import("../src/commands/dust.js");
    const indexer = await indexerWithEvents([1, 30, 31, 33, 34, 40]);
    try {
      const result = await dustEventsCommand("preprod", { indexerWs: indexer.url, limit: 3, timeoutMs: 5000 }, { json: true });
      expect((result.data as { table: Array<{ id: number }> }).table.map((e) => e.id)).toEqual([33, 34, 40]);
      const more = await dustEventsCommand("preprod", { indexerWs: indexer.url, limit: 8, timeoutMs: 5000 }, { json: true });
      expect((more.data as { table: Array<{ id: number }> }).table.map((e) => e.id)).toEqual([30, 31, 33, 34, 40]);
    } finally {
      indexer.stop();
    }
  });

  it("fails fast for an event id the network hasn't reached", async () => {
    const { dustEventCommand } = await import("../src/commands/dust.js");
    const indexer = await indexerWithEvents([1, 30, 31]);
    try {
      const started = Date.now();
      const result = await dustEventCommand(500, "preprod", { indexerWs: indexer.url, timeoutMs: 15_000 }, { json: true });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(result).toMatchObject({ ok: false, error: "DUST event 500 doesn't exist yet on preprod; the latest is 31" });
      expect(result.next?.[0]?.command).toBe("midnight-cast dust-events preprod");
      const found = await dustEventCommand(30, "preprod", { indexerWs: indexer.url, timeoutMs: 5000 }, { json: true });
      expect((found.data as { id: number }).id).toBe(30);
    } finally {
      indexer.stop();
    }
  });
});
