import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { subscribeDustEvents } from "../src/clients/indexer.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function silentIndexer() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let connections = 0;
  wss.on("connection", () => {
    connections += 1;
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
    const indexer = await silentIndexer();
    const subscription = subscribeDustEvents({ indexerWs: indexer.url }, { fromId: 1, limit: 1, timeoutMs: 500 });
    indexer.stop();
    await expect(subscription).rejects.toThrow();
    await sleep(2500);
  });
});
