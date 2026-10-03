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
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: "Event not received within timeout" });
    } finally {
      indexer.stop();
    }
  });
});
