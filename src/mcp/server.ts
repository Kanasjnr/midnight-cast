import { McpServer, completable } from "@modelcontextprotocol/server";
import { z } from "zod";
import { blockAtHeightCommand, blockLatestCommand } from "../commands/block.js";
import { decodeCommand } from "../commands/decode.js";
import { dustEventCommand, dustEventsCommand } from "../commands/dust.js";
import { TOPICS, explainCommand } from "../commands/explain.js";
import { healthCommand } from "../commands/health.js";
import { preflightCommand } from "../commands/preflight.js";
import { examplesCommand } from "../commands/examples.js";
import { loadExamplesIndex } from "../lib/examples-index.js";
import { pingCommand } from "../commands/ping.js";
import { tipCommand } from "../commands/tip.js";
import { txCommand } from "../commands/tx.js";
import { versionsCommand } from "../commands/versions.js";
import { contractCommand } from "../commands/contract.js";
import { dustStatusCommand } from "../commands/dust-status.js";
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
- When the user needs working Midnight code for a pattern, call examples with the topic and start from what it returns.
- When a network might be the problem rather than the user's code, call health; ping and tip narrow it down. Its data.examples says whether Midnight's own examples pass on the node that network runs: if they pass and the network is healthy, look at the user's code or setup first.
- To see what happened to a transaction, call tx with its hash.
- Every result is an envelope: ok, data, error { message, kind, hint }, warnings and next. Follow next: when a step has a tool field, call that tool with exactly those arguments; otherwise the command is for a terminal.
- Preprod and mainnet go through Blockfrost and need a project ID, one per network. If a call says it is missing, pass on the error's instructions to the user: they depend on how this server was installed. Preview needs none.`;

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
    "Full check of a Midnight network: RPC and indexer reachability, indexer sync against the node, and live versions against the support matrix. data.examples says whether Midnight's own examples pass on the node the network runs. Start here when something might be wrong with the network rather than the user's code.",
    LIVE,
    { network, threshold: z.number().int().min(0).optional().describe("Indexer lag, in blocks, that counts as out of sync (default 100)") },
    ({ network, threshold }) => healthCommand(network, { threshold }, json),
  );
  tool(
    "preflight",
    "preflight",
    "Check that a network, its proof server and optionally a wallet are ready before the first transaction: the network answers and is in sync, the proof server answers at the expected version, and the wallet holds NIGHT registered for DUST generation. data.expectations quotes how long wallet sync and restore took in Midnight's examples run, so a long first sync isn't mistaken for a hang.",
    LIVE,
    {
      network,
      address: z
        .string()
        .min(1)
        .optional()
        .describe("The wallet's Midnight unshielded address (mn_addr_…) or a Cardano reward address (stake…)"),
    },
    ({ network, address }) => preflightCommand(network, { address }, json),
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
    ({ network, threshold }) => tipCommand(network, { threshold }, json),
  );
  tool(
    "versions",
    "versions",
    "Compare the network's live node, runtime, indexer API and proof server with Midnight's support matrix, and a project's Midnight packages (package.json and package-lock.json) with the matrix pins. data.localProject says which directory was checked and whether it had a package.json, and data.examples whether Midnight's own examples pass on the node the network runs.",
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
    "contract",
    "contract",
    "Look up a deployed contract by address: whether it exists, its latest action (deploy, call or update) and the circuit a call ran, the deploy transaction and block (not reported after an update), unshielded balances, and the state's size and sha256.",
    LIVE,
    {
      network,
      address: z.string().min(1).describe("Contract address, hex, optionally prefixed with 0x"),
      includeState: z.boolean().optional().describe("Also return the full state hex, which can be hundreds of kilobytes (default false)"),
    },
    ({ network, address, includeState }) => contractCommand(address, network, { state: includeState }, json),
  );
  tool(
    "dust_status",
    "dust-status",
    "DUST generation for Cardano reward addresses: whether each is registered, its NIGHT balance, generation rate, and current and maximum DUST capacity. Use when a wallet has no DUST.",
    LIVE,
    {
      network,
      addresses: z
        .array(z.string().min(1))
        .min(1)
        .max(20)
        .describe("Cardano reward addresses (stake1… on mainnet, stake_test1… on test networks)"),
    },
    ({ network, addresses }) => dustStatusCommand(addresses, network, {}, json),
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
  tool(
    "examples",
    "examples",
    "Working code from Midnight's official examples (midnightntwrk/midnight-examples), each compiled and tested in CI. Give a topic such as \"DUST sponsorship\", \"send shielded tokens\" or \"verify a signature in a circuit\" to get the examples that show it, with file paths, line ranges, links pinned to a commit and the code itself. Without a topic, lists every example and what it covers. Prefer these over writing Midnight code from memory.",
    OFFLINE,
    { topic: z.string().optional().describe("What the code should show; omit to list every example") },
    ({ topic }) => examplesCommand(topic, json),
  );

  // Prompts are user-invoked (slash commands in most clients): ready-made investigations over the tools.
  const networkArg = (description: string) =>
    completable(z.string().describe(description), (value) => networks.filter((n) => n.startsWith(value ?? "")));
  const ask = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });

  server.registerPrompt(
    "diagnose-error",
    {
      title: "Diagnose a Midnight error",
      description: "Explain an error from a wallet, node, toolkit, indexer or Blockfrost, and how to fix it",
      argsSchema: z.object({
        error: z.string().describe("The full error message"),
        network: networkArg("Network the error came from, if known").optional(),
      }),
    },
    ({ error, network }) =>
      ask(
        `A Midnight developer hit this error${network ? ` on ${network}` : ""}:\n\n${error}\n\n` +
          `Use the midnight-cast tools. Call decode with the whole message${network ? ` and network ${network}` : ""}, ` +
          "then follow the next steps it returns, calling a step's tool with its arguments when it has one. " +
          `If the error points at the network rather than the code, call health${network ? ` for ${network}` : ""}. ` +
          "Finish with what the error means, the most likely cause here, and the fix.",
      ),
  );
  server.registerPrompt(
    "check-network",
    {
      title: "Check a Midnight network",
      description: "Whether a network's RPC node, indexer and versions are healthy, and what to do if not",
      argsSchema: z.object({ network: networkArg("Network to check") }),
    },
    ({ network }) =>
      ask(
        `Check whether the Midnight ${network} network is healthy with the midnight-cast tools. Call health for ${network}. ` +
          "If anything fails, use ping or tip to narrow it down, and follow the next steps in the results. " +
          "Report what works, what doesn't, whether it looks like an outage or a local configuration problem, and what to do.",
      ),
  );
  server.registerPrompt(
    "investigate-transaction",
    {
      title: "Investigate a Midnight transaction",
      description: "What happened to a transaction: its status, failed segments, fees and DUST events",
      argsSchema: z.object({
        hash: z.string().describe("Transaction hash"),
        network: networkArg("Network the transaction was sent to"),
      }),
    },
    ({ hash, network }) =>
      ask(
        `Find out what happened to transaction ${hash} on Midnight ${network} with the midnight-cast tools. Call tx, ` +
          "then follow its next steps, such as dust_event for the DUST events it produced. " +
          "If a segment failed, explain that the indexer records only that it failed, and ask for the wallet or node error " +
          "to decode. Summarise the outcome in plain language.",
      ),
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
    "examples",
    "midnight-cast://examples",
    {
      title: "Midnight's examples",
      description: "Every official Midnight example at a pinned commit: what it shows, its topics, and the files and lines that show them",
      mimeType: "application/json",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(loadExamplesIndex(), null, 2) }] }),
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
