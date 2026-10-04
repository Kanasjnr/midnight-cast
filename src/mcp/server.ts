import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { blockAtHeightCommand, blockLatestCommand } from "../commands/block.js";
import { decodeCommand } from "../commands/decode.js";
import { dustEventCommand, dustEventsCommand } from "../commands/dust.js";
import { TOPICS, explainCommand } from "../commands/explain.js";
import { healthCommand } from "../commands/health.js";
import { pingCommand } from "../commands/ping.js";
import { tipCommand } from "../commands/tip.js";
import { txCommand } from "../commands/tx.js";
import { versionsCommand } from "../commands/versions.js";
import type { Catalog } from "../lib/catalog.js";
import { loadDataJson } from "../lib/data-path.js";
import { resolveSupportMatrix } from "../lib/upstream-matrix.js";
import { loadConfigFile } from "../config.js";
import { NETWORK_NAMES } from "../networks.js";
import { envelopeOf, fail, withOwnWarnings, type EmitResult } from "../output.js";
import { RateLimiter, callsPerMinute } from "./rate-limit.js";
import { runAsMcpCall } from "../lib/surface.js";

export interface McpOptions {
  version: string;
  catalog: () => Catalog;
  /** Networks the model may query. Defaults to MIDNIGHT_CAST_NETWORKS, then every built-in network. */
  networks?: string[];
  /** Calls a minute to the tools that reach a network. Defaults to MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE, then 30. */
  callsPerMinute?: number;
}

/** Built-in networks plus any defined in the config file, which the CLI accepts too. */
export function allowedNetworks(
  env = process.env.MIDNIGHT_CAST_NETWORKS,
  configured: string[] = Object.keys(loadConfigFile().networks ?? {}),
): string[] {
  const requested = env
    ?.split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (!requested?.length) return NETWORK_NAMES;
  const known = [...new Set([...NETWORK_NAMES, ...configured])];
  const unknown = requested.filter((n) => !known.includes(n));
  if (unknown.length) {
    throw new Error(`MIDNIGHT_CAST_NETWORKS has unknown networks: ${unknown.join(", ")}. Known: ${known.join(", ")}`);
  }
  return requested;
}

const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  ok: z.boolean(),
  command: z.string().nullable(),
  network: z.string().nullable(),
  data: z.unknown(),
  warnings: z.array(z.string()),
  error: z.object({ message: z.string(), kind: z.string().nullable(), hint: z.string().nullable() }).nullable(),
  next: z.array(
    z.object({
      command: z.string(),
      reason: z.string(),
      tool: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }).optional(),
    }),
  ),
});

// Sent to the client at connection and usually shown to the model: how to get good answers from these tools.
export const INSTRUCTIONS = `midnight-cast reads the public Midnight networks and explains Midnight errors. Every tool only reads; nothing needs a wallet or keys.

- When the user has an error message, call decode with the whole message first.
- When a network might be the problem rather than the user's code, call health; ping and tip narrow it down.
- To see what happened to a transaction, call tx with its hash.
- Every result is an envelope: ok, data, error { message, kind, hint }, warnings and next. Follow next: when a step has a tool field, call that tool with exactly those arguments; otherwise the command is for a terminal.
- Mainnet goes through Blockfrost and needs BLOCKFROST_PROJECT_ID in this server's environment. If a mainnet call says it is missing, ask the user to add it to this server's MCP configuration.`;

// Tools only read. Those that reach a network say so; decode and explain work from bundled data.
const LIVE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const OFFLINE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// Like the CLI's run(): an exception still becomes a redacted envelope, and each call keeps its own warnings.
async function respond(command: string, work: () => Promise<EmitResult> | EmitResult) {
  const { value: result, warnings } = await withOwnWarnings(() =>
    runAsMcpCall(async () => {
      try {
        return await work();
      } catch (err) {
        return fail(err);
      }
    }),
  );
  const envelope = envelopeOf(result, command, warnings);
  return {
    structuredContent: envelope as z.infer<typeof envelopeSchema>,
    content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
    isError: !envelope.ok,
  };
}

/**
 * The read-only MCP server: each tool runs the matching midnight-cast command and returns
 * its --json envelope. The model picks a network from an allow-list but never supplies
 * endpoint URLs, so it can't point the server anywhere else.
 */
export function createMcpServer(options: McpOptions): McpServer {
  const networks = options.networks ?? allowedNetworks();
  const network = z
    .enum(networks as [string, ...string[]])
    .describe(`Midnight network to query: ${networks.join(", ")}`);
  const json = { json: true };
  // Network tools share one budget, so a looping agent can't exhaust public endpoints or a Blockfrost plan.
  const limiter = new RateLimiter(options.callsPerMinute ?? callsPerMinute());
  const rateLimited = (retryAfterMs: number): EmitResult => ({
    ok: false,
    error: `Rate limited: this server allows ${limiter.perMinute} network calls a minute. Try again in ${Math.ceil(retryAfterMs / 1000)} s.`,
    errorKind: "rate_limited",
    hint: "Wait before retrying. The limit is set with MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE in this server's environment.",
  });
  const server = new McpServer(
    {
      name: "midnight-cast",
      title: "midnight-cast",
      version: options.version,
      description: "Read-only access to the public Midnight networks: health, transactions, DUST events and error decoding",
      websiteUrl: "https://github.com/Kanasjnr/midnight-cast",
    },
    { instructions: INSTRUCTIONS },
  );

  const tool = <Shape extends z.ZodRawShape>(
    name: string,
    command: string,
    description: string,
    annotations: typeof LIVE | typeof OFFLINE,
    inputSchema: Shape,
    run: (input: z.infer<z.ZodObject<Shape>>) => Promise<EmitResult> | EmitResult,
  ) =>
    server.registerTool(
      name,
      {
        title: `midnight-cast ${command}`,
        description,
        inputSchema: z.object(inputSchema),
        outputSchema: envelopeSchema,
        annotations,
      },
      // The SDK validates input against inputSchema before calling this. Its callback type is
      // conditional on the schema, which TypeScript can't resolve while Shape is generic.
      ((input: z.infer<z.ZodObject<Shape>>) => {
        const allowed = annotations.openWorldHint ? limiter.take() : { ok: true as const };
        return respond(command, () => (allowed.ok ? run(input) : rateLimited(allowed.retryAfterMs)));
      }) as never,
    );

  tool(
    "health",
    "health",
    "Full check of a Midnight network: RPC and indexer reachability, indexer sync against the node, and live versions against the support matrix. Start here when something might be wrong with the network rather than the user's code.",
    LIVE,
    { network, threshold: z.number().int().min(0).optional().describe("Indexer lag, in blocks, that counts as out of sync (default 100)") },
    ({ network, threshold }) => healthCommand(network, { threshold }, json),
  );
  tool(
    "ping",
    "ping",
    "Check whether the network's RPC node, indexer and proof server answer, with latency and a classified error kind for each failure.",
    LIVE,
    { network },
    ({ network }) => pingCommand(network, {}, json),
  );
  tool(
    "tip",
    "tip",
    "Compare the node's latest block height with the indexer's, to see whether the indexer is behind.",
    LIVE,
    { network, threshold: z.number().int().min(0).optional().describe("Lag in blocks that counts as out of sync (default 100)") },
    ({ network, threshold }) => tipCommand(network, { threshold, failOnLag: true }, json),
  );
  tool(
    "versions",
    "versions",
    "Compare the network's live node, runtime, indexer API and proof server with Midnight's support matrix, and a project's Midnight packages (package.json and package-lock.json) with the matrix pins. data.localProject says which directory was checked and whether it had a package.json.",
    LIVE,
    {
      network,
      projectDir: z
        .string()
        .min(1)
        .optional()
        .describe("Absolute path of the user's project; defaults to the server's working directory, which may not be the project"),
      checkLocalPackages: z.boolean().optional().describe("Check the project's packages at all (default true)"),
    },
    ({ network, projectDir, checkLocalPackages }) =>
      versionsCommand(network, { local: checkLocalPackages ?? true, projectDir }, json),
  );
  tool(
    "block",
    "block",
    "Read a block header: the latest one, or the block at a height.",
    LIVE,
    { network, height: z.number().int().min(0).optional().describe("Block height; omit for the latest block") },
    ({ network, height }) =>
      height === undefined
        ? blockLatestCommand(network, {}, json)
        : blockAtHeightCommand(String(height), network, {}, json),
  );
  tool(
    "tx",
    "tx",
    "Look up a transaction on the indexer: status, segments, fees, contract actions and the DUST and Zswap events it produced.",
    LIVE,
    {
      network,
      hash: z.string().min(1).describe("Transaction hash, or an identifier when by is identifier"),
      by: z.enum(["hash", "identifier"]).optional().describe("What hash is (default hash)"),
    },
    ({ network, hash, by }) => txCommand(hash, network, { by }, json),
  );
  tool(
    "dust_event",
    "dust-event",
    "Read one DUST ledger event by id from the indexer subscription.",
    LIVE,
    { network, id: z.number().int().min(0).describe("DUST ledger event id") },
    ({ network, id }) => dustEventCommand(id, network, {}, json),
  );
  tool(
    "dust_events",
    "dust-events",
    "Read DUST ledger events from the indexer: the latest ones, or a run starting at an id.",
    LIVE,
    {
      network,
      from: z.number().int().min(0).optional().describe("First event id; omit for the latest events"),
      limit: z.number().int().min(1).max(50).optional().describe("How many events to read (default 10, at most 50)"),
    },
    ({ network, from, limit }) => dustEventsCommand(network, { from, limit: limit ?? 10 }, json),
  );
  tool(
    "decode",
    "decode",
    "Explain a Midnight error. Paste the whole message from a wallet, node, toolkit or Blockfrost: 1010 rejections, Custom(N) ledger codes, pallet errors, JSON-RPC codes and known tooling messages are recognised. A bare code such as 170 works too.",
    OFFLINE,
    {
      message: z.string().min(1).max(16_384).describe("The error message or code"),
      network: network.optional().describe("Network the error came from, to check the ledger map matches it"),
    },
    ({ message, network }) => decodeCommand([], { json: true, raw: message, ...(network ? { network } : {}) }),
  );
  tool(
    "explain",
    "explain",
    `Background on a Midnight topic: ${TOPICS.join(", ")}.`,
    OFFLINE,
    { topic: z.enum(TOPICS).describe("Topic to explain") },
    ({ topic }) => explainCommand(topic, json, options.catalog),
  );

  server.registerResource(
    "support-matrix",
    "midnight-cast://support-matrix",
    {
      title: "Midnight support matrix",
      description: "Versions each network is expected to run, as versions and health judge them",
      mimeType: "application/json",
    },
    async (uri) => {
      const { matrix, source } = await resolveSupportMatrix();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ source, ...matrix }, null, 2) }] };
    },
  );
  server.registerResource(
    "error-codes",
    "midnight-cast://error-codes",
    {
      title: "Midnight error codes",
      description: "Ledger Custom(N) codes, pallet errors and JSON-RPC codes that decode explains",
      mimeType: "application/json",
    },
    (uri) => {
      const catalog = {
        ledger: loadDataJson("error-codes.json"),
        pallets: loadDataJson("pallet-errors.json"),
        jsonRpc: loadDataJson("jsonrpc-errors.json"),
      };
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(catalog, null, 2) }] };
    },
  );

  server.registerResource(
    "catalog",
    "midnight-cast://catalog",
    {
      title: "midnight-cast command catalog",
      description: "Every midnight-cast CLI command with its options, exit codes and error kinds, for agents that also have a terminal",
      mimeType: "application/json",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(options.catalog(), null, 2) }] }),
  );

  return server;
}
