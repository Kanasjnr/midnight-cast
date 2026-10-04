import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { allowedNetworks, createMcpServer } from "../src/mcp/server.js";
import { replayFetch } from "../scripts/fixtures.js";
import { readFixture } from "../scripts/record-fixtures.js";
import { BUILTIN_NETWORKS } from "../src/networks.js";
import { schemaErrors } from "./schema.js";

const SECRET = "nightmainnetMCPSECRET0001";
const fixture = readFixture("preprod")!;
const mainnetFixture = readFixture("mainnet")!;

interface Envelope {
  ok: boolean;
  command: string | null;
  data: unknown;
  error: { message: string } | null;
  next: Array<{ command: string }>;
}

// Recorded DUST events served the way the indexer speaks graphql-transport-ws.
async function recordedIndexer() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id?: string };
      if (message.type === "connection_init") socket.send(JSON.stringify({ type: "connection_ack" }));
      if (message.type === "subscribe") {
        for (const payload of fixture.dust.payloads) socket.send(JSON.stringify({ type: "next", id: message.id, payload }));
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

describe("MCP server", () => {
  const realFetch = globalThis.fetch;
  const saved = { ...process.env };
  let client: Client;
  let indexer: Awaited<ReturnType<typeof recordedIndexer>>;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const envelope = result.structuredContent as unknown as Envelope;
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(envelope);
    expect(result.isError).toBe(!envelope.ok);
    return { envelope, text: JSON.stringify(result) };
  };

  beforeAll(async () => {
    indexer = await recordedIndexer();
    const configHome = mkdtempSync(join(tmpdir(), "mc-mcp-"));
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.BLOCKFROST_PROJECT_ID = SECRET;
    const byNetwork = { preprod: replayFetch(fixture, BUILTIN_NETWORKS.preprod!.proofServer), mainnet: replayFetch(mainnetFixture) };
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      return (url.includes("mainnet") ? byNetwork.mainnet : byNetwork.preprod)(input, init);
    }) as typeof fetch;
    // The DUST tools read the indexer WebSocket from config; point preprod's at the recorded indexer.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(join(configHome, "midnight-cast"), { recursive: true });
    const preprod = BUILTIN_NETWORKS.preprod!;
    writeFileSync(
      join(configHome, "midnight-cast", "config.toml"),
      `[networks.preprod]\nrpc = "${preprod.rpc}"\nindexer_http = "${preprod.indexerHttp}"\nindexer_ws = "${indexer.url}"\n`,
    );

    const server = createMcpServer({
      version: "test",
      catalog: () => ({ cli: "midnight-cast" }) as never,
      networks: ["preprod", "mainnet"],
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  });

  afterAll(async () => {
    await client.close();
    indexer.stop();
    globalThis.fetch = realFetch;
    process.env = saved;
  });

  it("lists ten read-only tools with typed inputs and the envelope as output", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["block", "decode", "dust_event", "dust_events", "explain", "health", "ping", "tip", "tx", "versions"].sort(),
    );
    for (const t of tools) {
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.outputSchema?.required, t.name).toContain("schemaVersion");
    }
    const networkInput = tools.find((t) => t.name === "health")!.inputSchema.properties!.network as { enum: string[] };
    expect(networkInput.enum).toEqual(["preprod", "mainnet"]);
    expect(tools.find((t) => t.name === "decode")!.annotations?.openWorldHint).toBe(false);
  });

  it("returns valid envelopes from every network tool, replayed from recorded responses", async () => {
    const { inputs } = fixture;
    for (const [name, args] of [
      ["health", { network: "preprod" }],
      ["ping", { network: "preprod" }],
      ["tip", { network: "preprod" }],
      ["versions", { network: "preprod", checkLocalPackages: false }],
      ["block", { network: "preprod" }],
      ["block", { network: "preprod", height: inputs.blockHeight }],
      ["tx", { network: "preprod", hash: inputs.txHash }],
      ["dust_event", { network: "preprod", id: inputs.dustEventId }],
      ["dust_events", { network: "preprod", from: inputs.dustEventId, limit: fixture.dust.payloads.length }],
    ] as const) {
      const { envelope } = await call(name, args);
      expect(envelope.ok, `${name}: ${envelope.error?.message}`).toBe(true);
      expect(schemaErrors(envelope), name).toEqual([]);
    }
  });

  it("decodes and explains without a network", async () => {
    const { envelope } = await call("decode", { message: "1010: Invalid Transaction: Custom error: 170" });
    expect(envelope.ok).toBe(true);
    expect(envelope.next.map((s) => s.command)).toContain("midnight-cast explain 1010");
    expect((await call("explain", { topic: "dust" })).envelope.ok).toBe(true);
  });

  it("refuses networks outside the allow-list and bad input before running anything", async () => {
    for (const [name, args] of [
      ["ping", { network: "preview" }],
      ["block", { network: "preprod", height: -1 }],
      ["tx", { network: "preprod" }],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, name).toBe(true);
      expect(result.structuredContent, name).toBeUndefined();
    }
  });

  it("never echoes the Blockfrost project ID", async () => {
    const { text, envelope } = await call("versions", { network: "mainnet", checkLocalPackages: false });
    expect(envelope.ok).toBe(true);
    expect(text).not.toContain(SECRET);
    const failed = await call("tx", { network: "mainnet", hash: "00".repeat(32) });
    expect(failed.envelope.ok).toBe(false);
    expect(failed.text).not.toContain(SECRET);
  });

  it("turns a thrown error into a redacted envelope", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const configDir = join(process.env.XDG_CONFIG_HOME!, "midnight-cast");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "support-matrix.json"), `{ "not": "a matrix", "id": "${SECRET}" }`);
    try {
      const { envelope, text } = await call("versions", { network: "preprod", checkLocalPackages: false });
      expect(envelope.ok).toBe(false);
      expect(envelope.error?.message).toMatch(/not a support matrix/);
      expect(text).not.toContain(SECRET);
    } finally {
      const { rmSync } = await import("node:fs");
      rmSync(join(configDir, "support-matrix.json"));
    }
  });

  it("serves the support matrix and error codes as resources", async () => {
    process.env.MN_OFFLINE = "1";
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["midnight-cast://error-codes", "midnight-cast://support-matrix"]);
    const matrix = await client.readResource({ uri: "midnight-cast://support-matrix" });
    expect(JSON.parse((matrix.contents[0] as { text: string }).text).networks.preprod).toBeDefined();
    const codes = await client.readResource({ uri: "midnight-cast://error-codes" });
    expect(JSON.parse((codes.contents[0] as { text: string }).text).ledger.codes["170"].name).toBe("InvalidDustSpendProof");
  });
});

describe("network allow-list", () => {
  it("defaults to every built-in network, accepts configured ones and rejects unknown names", () => {
    expect(allowedNetworks(undefined, [])).toEqual(["preview", "preprod", "mainnet", "local"]);
    expect(allowedNetworks(" preprod , mainnet ", [])).toEqual(["preprod", "mainnet"]);
    expect(allowedNetworks("preprod,devnet", ["devnet"])).toEqual(["preprod", "devnet"]);
    expect(() => allowedNetworks("preprod,devnet", [])).toThrow(/unknown networks: devnet/);
  });
});

describe("warnings", () => {
  it("stay with the call that raised them", async () => {
    const { warn, withOwnWarnings } = await import("../src/output.js");
    const slow = withOwnWarnings(async () => {
      warn("from the slow call");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const fast = await withOwnWarnings(async () => undefined);
    expect(fast.warnings).toEqual([]);
    expect((await slow).warnings).toEqual(["from the slow call"]);
  });
});
