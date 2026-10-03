// Records what preview and preprod return for every request midnight-cast makes,
// plus the indexer's GraphQL schema, into test/fixtures/<network>/.
//
//   tsx scripts/record-fixtures.ts [network...] [--check] [--discover]
//
// --check re-records into memory and compares shapes (keys and types, not values)
// and the GraphQL schema with the committed fixtures. Exit 0 clean, 1 drift, 2 error.
// --discover looks for a fresh transaction with DUST events instead of reusing the recorded one.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildClientSchema, getIntrospectionQuery, printSchema, type IntrospectionQuery } from "graphql";
import { createClient } from "graphql-ws";
import WebSocket from "ws";
import { DUST_SUBSCRIPTION } from "../src/clients/indexer.js";
import { blockAtHeightCommand, blockLatestCommand } from "../src/commands/block.js";
import { healthCommand } from "../src/commands/health.js";
import { pingCommand } from "../src/commands/ping.js";
import { tipCommand } from "../src/commands/tip.js";
import { txCommand } from "../src/commands/tx.js";
import { versionsCommand } from "../src/commands/versions.js";
import { resolveNetwork } from "../src/config.js";
import { takeProjectId } from "../src/lib/blockfrost.js";
import { BUILTIN_NETWORKS } from "../src/networks.js";
import type { EmitResult } from "../src/output.js";
import { compareShapes, dustExchanges, recordingFetch, type Exchange, type FixtureFile } from "./fixtures.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_NETWORKS = ["preview", "preprod", "mainnet"] as const;
// Mainnet is served by Blockfrost and needs a project ID to record.
const NEEDS_PROJECT_ID = new Set(["mainnet"]);
const DUST_PAYLOADS = 3;

export function fixtureDir(network: string): string {
  return join(root, "test", "fixtures", network);
}

async function graphql<T>(endpoint: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { url, projectId } = takeProjectId(endpoint);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(projectId ? { project_id: projectId } : {}) },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = (await response.json()) as { data?: T; errors?: unknown };
      if (!result.data) throw new Error(`${url}: ${JSON.stringify(result.errors ?? response.status)}`);
      return result.data;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}

async function discoverInputs(indexerHttp: string): Promise<FixtureFile["inputs"]> {
  const { block } = await graphql<{ block: { height: number } }>(indexerHttp, "{ block { height } }");
  for (let height = block.height; height > block.height - 1000; height--) {
    const data = await graphql<{
      block: { transactions: Array<{ hash: string; dustLedgerEvents?: Array<{ id: number }> }> };
    }>(
      indexerHttp,
      "query($h: Int) { block(offset: { height: $h }) { transactions { hash ... on RegularTransaction { dustLedgerEvents { id } } } } }",
      { h: height },
    );
    const tx = data.block.transactions.find((t) => t.dustLedgerEvents?.length);
    if (tx) return { txHash: tx.hash, blockHeight: height, dustEventId: tx.dustLedgerEvents![0]!.id };
  }
  throw new Error(`No transaction with DUST events in the last 1000 blocks at ${indexerHttp}`);
}

// Public endpoints fail now and then; a fixture must come from a successful run.
async function requireOk(name: string, run: () => Promise<EmitResult>, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const result = await run();
    if (result.ok) return;
    if (attempt === attempts) throw new Error(`${name} failed while recording: ${result.error ?? "no message"}`);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

async function recordExchanges(network: string, inputs: FixtureFile["inputs"]): Promise<Exchange[]> {
  const endpoints = BUILTIN_NETWORKS[network]!;
  const exchanges = new Map<string, Exchange>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = recordingFetch(realFetch, endpoints.proofServer, exchanges);
  try {
    const json = { json: true };
    await requireOk("ping", () => pingCommand(network, {}, json));
    await requireOk("tip", () => tipCommand(network, {}, json));
    await requireOk("health", () => healthCommand(network, {}, json));
    await requireOk("versions", () => versionsCommand(network, { local: false }, json));
    await requireOk("block latest", () => blockLatestCommand(network, {}, json));
    await requireOk("block", () => blockAtHeightCommand(String(inputs.blockHeight), network, {}, json));
    await requireOk("tx", () => txCommand(inputs.txHash, network, {}, json));
  } finally {
    globalThis.fetch = realFetch;
  }
  return [...exchanges.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function recordDust(indexerWs: string, fromId: number): Promise<FixtureFile["dust"]> {
  const variables = { id: fromId };
  const payloads: unknown[] = [];
  // graphql-ws dispose() waits on a pending handshake, so sockets are closed directly instead.
  const sockets: WebSocket[] = [];
  class TrackedWebSocket extends WebSocket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      sockets.push(this);
    }
  }
  const client = createClient({
    url: indexerWs,
    webSocketImpl: TrackedWebSocket,
    connectionParams: {},
    retryAttempts: 0,
    lazy: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => (payloads.length ? resolve() : reject(new Error(`no DUST events from ${indexerWs} within 20s`))),
        20_000,
      );
      const unsubscribe = client.subscribe(
        { query: DUST_SUBSCRIPTION, variables },
        {
          next: (payload) => {
            payloads.push(payload);
            if (payloads.length >= DUST_PAYLOADS) {
              clearTimeout(timer);
              unsubscribe();
              resolve();
            }
          },
          error: (err) => {
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(JSON.stringify(err)));
          },
          complete: () => {
            clearTimeout(timer);
            resolve();
          },
        },
      );
    });
  } finally {
    void Promise.resolve(client.dispose()).catch(() => undefined);
    for (const socket of sockets) socket.terminate();
  }
  return { variables, payloads };
}

// Midnight indexers cap query depth at 15, and the standard introspection query nests
// type references eight deep. Six levels still covers types such as [[T!]!]!.
function introspectionQuery(typeRefDepth = 6): string {
  const standard = getIntrospectionQuery();
  const typeRef =
    "fragment TypeRef on __Type { kind name " + "ofType { kind name ".repeat(typeRefDepth) + "}".repeat(typeRefDepth) + " }";
  return standard.slice(0, standard.indexOf("fragment TypeRef")) + typeRef;
}

async function recordSchema(indexerHttp: string): Promise<string> {
  const data = await graphql<IntrospectionQuery>(indexerHttp, introspectionQuery());
  return `${printSchema(buildClientSchema(data))}\n`;
}

async function record(network: string, inputs: FixtureFile["inputs"]): Promise<{ fixture: FixtureFile; schema: string }> {
  const endpoints = resolveNetwork(network, {});
  const [exchanges, dust, schema] = [
    await recordExchanges(network, inputs),
    await recordDust(endpoints.indexerWs, inputs.dustEventId).catch(() => recordDust(endpoints.indexerWs, inputs.dustEventId)),
    await recordSchema(endpoints.indexerHttp),
  ];
  return {
    fixture: { network, recordedAt: new Date().toISOString(), inputs, exchanges, dust },
    schema,
  };
}

export function readFixture(network: string): FixtureFile | undefined {
  const path = join(fixtureDir(network), "responses.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FixtureFile) : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const discover = args.includes("--discover");
  const networks = args.filter((a) => !a.startsWith("--"));
  // Built-in endpoints and the bundled matrix only: nothing from the user's config, no matrix fetch.
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "mc-record-"));
  process.env.MN_OFFLINE = "1";

  let drifted = false;
  let incomplete = false;
  for (const network of networks.length ? networks : FIXTURE_NETWORKS) {
    if (!BUILTIN_NETWORKS[network]) throw new Error(`Unknown network ${network}`);
    if (NEEDS_PROJECT_ID.has(network) && !process.env.BLOCKFROST_PROJECT_ID) {
      if (networks.includes(network)) throw new Error(`${network} needs BLOCKFROST_PROJECT_ID to record`);
      console.log(`${network}: skipped, BLOCKFROST_PROJECT_ID is not set`);
      continue;
    }
    const committed = readFixture(network);
    const indexerHttp = resolveNetwork(network, {}).indexerHttp;
    const inputs = !discover && committed ? committed.inputs : await discoverInputs(indexerHttp);
    // Shapes are compared by request kind, so after a network reset any recent transaction will do.
    const { fixture, schema } = await record(network, inputs).catch(async (err: unknown) => {
      if (!check) throw err;
      console.log(`${network}: recorded inputs didn't resolve (${err instanceof Error ? err.message : err}); using fresh ones`);
      return record(network, await discoverInputs(indexerHttp));
    });
    const dir = fixtureDir(network);

    const secret = process.env.BLOCKFROST_PROJECT_ID;
    if (secret && (JSON.stringify(fixture).includes(secret) || schema.includes(secret))) {
      throw new Error(`${network}: the recording contains the Blockfrost project ID; nothing was written`);
    }

    if (!check) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "responses.json"), `${JSON.stringify(fixture, null, 2)}\n`);
      writeFileSync(join(dir, "indexer-schema.graphql"), schema);
      console.log(`${network}: recorded ${fixture.exchanges.length} responses and ${fixture.dust.payloads.length} DUST events`);
      continue;
    }

    if (!committed) throw new Error(`${network}: no committed fixtures; run npm run fixtures first`);
    const { drift: all, unverified } = compareShapes(
      [...committed.exchanges, ...dustExchanges(committed.dust)],
      [...fixture.exchanges, ...dustExchanges(fixture.dust)],
    );
    const outages = all.filter((d) => d.change === "unavailable");
    const drift = all.filter((d) => d.change !== "unavailable");
    const committedSchema = readFileSync(join(dir, "indexer-schema.graphql"), "utf8");
    const schemaChanged = committedSchema !== schema;
    console.log(`${network}: ${drift.length || schemaChanged ? "schema drift" : "responses and indexer schema match the fixtures"}`);
    for (const d of [...drift, ...outages]) {
      console.log(`  ${d.change}: ${d.key}${d.recorded ? `\n    recorded ${d.recorded}\n    live     ${d.live}` : ""}`);
    }
    if (schemaChanged) console.log("  indexer GraphQL schema changed; run npm run fixtures and review the diff");
    if (unverified.length) console.log(`  not compared this run (null or empty on one side): ${unverified.join("; ")}`);
    drifted ||= drift.length > 0 || schemaChanged;
    incomplete ||= outages.length > 0;
  }
  if (drifted) return 1;
  if (incomplete) {
    console.error("Incomplete, re-run: an endpoint answered with a server error");
    return 2;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (err: unknown) => {
      console.error(`Incomplete, re-run: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    },
  );
}
