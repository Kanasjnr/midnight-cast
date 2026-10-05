#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { emit, fail, type GlobalOptions } from "./output.js";
import { parseIntOrFail } from "./lib/parse-int.js";
import { configInitCommand, configShowCommand } from "./commands/config-cmd.js";
import { decodeCommand, type DecodeOptions } from "./commands/decode.js";
import { rpcCommand } from "./commands/rpc.js";
import { pingCommand } from "./commands/ping.js";
import { healthCommand } from "./commands/health.js";
import { tipCommand } from "./commands/tip.js";
import { blockAtHeightCommand, blockLatestCommand } from "./commands/block.js";
import { dustEventCommand, dustEventsCommand } from "./commands/dust.js";
import { TOPICS, explainCommand } from "./commands/explain.js";
import { buildCatalog, isDefaultSubcommand } from "./lib/catalog.js";
import { txCommand } from "./commands/tx.js";
import { contractCommand } from "./commands/contract.js";
import { agentsInitCommand } from "./commands/agents.js";
import { dustStatusCommand } from "./commands/dust-status.js";
import { versionsCommand } from "./commands/versions.js";
import type { ResolveFlags } from "./config.js";
import { normalizeArgv } from "./lib/argv.js";
import { isNetworkName, splitRpcPositionalArgs } from "./lib/network-arg.js";

const program = new Command().exitOverride();

function cliVersion(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
}

program
  .name("midnight-cast")
  .description("Read-only developer CLI for Midnight")
  .version(cliVersion(), "-V, --version", "Show CLI version")
  .option("--json", "JSON output")
  .option("--network <name>", "Network (preview|preprod|mainnet|local)")
  .option("--rpc <url>", "Override RPC URL")
  .option("--indexer-http <url>", "Override indexer HTTP URL")
  .option("--indexer-ws <url>", "Override indexer WebSocket URL")
  .option("--proof-server <url>", "Override proof server URL")
  .option("--offline", "Use the bundled support matrix; don't fetch Midnight's (or set MN_OFFLINE=1)")
  .option(
    "--project-id <id>",
    "Blockfrost project ID for mainnet (or set BLOCKFROST_PROJECT_ID)",
  );

function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c?.parent; c = c.parent) {
    if (!isDefaultSubcommand(c)) names.unshift(c.name());
  }
  return names.join(" ");
}

function globalOpts(cmd: Command): GlobalOptions {
  const o = cmd.optsWithGlobals();
  return { json: o.json, command: commandPath(cmd) };
}

function decodeOpts(cmd: Command, networkPositional?: string): DecodeOptions {
  const o = cmd.optsWithGlobals();
  const network =
    o.network ??
    (isNetworkName(networkPositional) ? networkPositional : undefined);
  return { json: o.json, raw: o.raw, network };
}

function parseFlagInt(
  value: string,
  label: string,
  options?: { min?: number; max?: number },
): number {
  const parsed = parseIntOrFail(value, label, options);
  if (typeof parsed === "object") {
    throw new Error(parsed.error);
  }
  return parsed;
}

function matrixFlags(cmd: Command): { offline?: boolean; refreshMatrix?: boolean } {
  const o = cmd.optsWithGlobals();
  return { offline: o.offline, refreshMatrix: o.refreshMatrix };
}

function resolveFlags(cmd: Command): ResolveFlags {
  const o = cmd.optsWithGlobals();
  return {
    network: o.network,
    rpc: o.rpc,
    indexerHttp: o.indexerHttp,
    indexerWs: o.indexerWs,
    proofServer: o.proofServer,
    projectId: o.projectId,
  };
}

async function run(
  fn: () => Promise<{ ok: boolean; exitCode?: number }>,
  cmd: Command,
): Promise<void> {
  try {
    const result = await fn();
    process.exitCode = emit(result, globalOpts(cmd));
  } catch (err) {
    process.exitCode = emit(fail(err), globalOpts(cmd));
  }
}

const config = program.command("config").description("Manage configuration");

config
  .command("init")
  .description("Write ~/.config/midnight-cast/config.toml")
  .option("-n, --network <name>", "Network name")
  .option("--rpc <url>", "RPC URL")
  .option("--indexer-http <url>", "Indexer HTTP URL")
  .option("--indexer-ws <url>", "Indexer WebSocket URL")
  .option("--proof-server <url>", "Proof server URL")
  .option("-y, --yes", "Non-interactive (default network: preprod)")
  .action(async (opts, cmd) => {
    const global = cmd.optsWithGlobals();
    await run(
      async () =>
        configInitCommand({
          ...opts,
          network: opts.network ?? global.network,
        }),
      cmd,
    );
  });

config
  .command("show")
  .description("Print resolved endpoints")
  .action(async (_opts, cmd) => {
    await run(
      async () => configShowCommand(resolveFlags(cmd), globalOpts(cmd)),
      cmd,
    );
  });

const decode = program
  .command("decode")
  .description("Decode errors (ledger, pallet, 1010, jsonrpc)")
  .option(
    "--raw <message>",
    "Parse full error string (1010, Custom N, pallet index/error)",
  );

decode
  .command("ledger <code>")
  .description("Ledger Custom(N) / LedgerApiError code (0–255)")
  .action(async (code: string, _opts, cmd) => {
    await run(
      async () => decodeCommand(["ledger", code], decodeOpts(cmd)),
      cmd,
    );
  });

decode
  .command("pallet <index> <variant>")
  .description("Pallet DispatchError::Module { index, error }")
  .action(async (index: string, variant: string, _opts, cmd) => {
    await run(
      async () => decodeCommand(["pallet", index, variant], decodeOpts(cmd)),
      cmd,
    );
  });

decode
  .command("1010")
  .description("Explain Substrate 1010 Invalid Transaction envelope")
  .action(async (_opts, cmd) => {
    await run(async () => decodeCommand(["1010"], decodeOpts(cmd)), cmd);
  });

decode
  .command("jsonrpc [code]")
  .description("JSON-RPC error code (e.g. -32602)")
  .option("--code <code>", "JSON-RPC error code (used for negative values)")
  .action(async (code: string | undefined, opts, cmd) => {
    const codeArg = opts.code ?? code;
    if (!codeArg) {
      await run(
        async () => ({
          ok: false,
          error: "Usage: midnight-cast decode jsonrpc <code> (e.g. -32602)",
          exitCode: 1,
        }),
        cmd,
      );
      return;
    }
    await run(
      async () => decodeCommand(["jsonrpc", codeArg], decodeOpts(cmd)),
      cmd,
    );
  });

decode
  .command("raw <message>")
  .description("Parse full error string (1010, Custom N, pallet index/error)")
  .action(async (message: string, _opts, cmd) => {
    const opts = { ...decodeOpts(cmd), raw: message };
    await run(async () => decodeCommand([], opts), cmd);
  });

decode
  .command("[code] [network]", { isDefault: true })
  .description("Shorthand: ledger code or 1010")
  .argument("[code]", "ledger code or 1010")
  .argument("[network]", "Network (preview|preprod|mainnet|local)")
  .action(async function (this: Command, code?: string, network?: string) {
    const opts = decodeOpts(this, network);
    if (opts.raw) {
      await run(async () => decodeCommand([], opts), this);
      return;
    }
    if (!code) {
      await run(async () => decodeCommand([], opts), this);
      return;
    }
    await run(async () => decodeCommand([code], opts), this);
  });

program
  .command("rpc <method> [params] [network]")
  .description("Call a JSON-RPC method on the node (params as JSON array)")
  .action(
    async (
      method: string,
      params: string | undefined,
      network: string | undefined,
      _opts,
      cmd,
    ) => {
      const split = splitRpcPositionalArgs(params, network);
      await run(
        async () =>
          rpcCommand(
            method,
            split.params,
            split.network,
            resolveFlags(cmd),
            globalOpts(cmd),
          ),
        cmd,
      );
    },
  );

program
  .command("ping [network]")
  .description("Check RPC, indexer, and optional proof server")
  .action(async (network: string | undefined, _opts, cmd) => {
    await run(
      async () => pingCommand(network, resolveFlags(cmd), globalOpts(cmd)),
      cmd,
    );
  });

program
  .command("health [network]")
  .description("Aggregate service ping, sync tip, and version checks")
  .option("--threshold <n>", "Lag threshold in blocks", "100")
  .option("--fail-on-lag", "Treat indexer lag as unhealthy (CI)")
  .option("--fail-on-mismatch", "Treat version mismatches as unhealthy (CI)")
  .option("--refresh-matrix", "Fetch Midnight's support matrix even if a cached copy is fresh")
  .action(async (network: string | undefined, opts, cmd) => {
    await run(
      async () =>
        healthCommand(
          network,
          {
            ...resolveFlags(cmd),
            threshold: parseFlagInt(opts.threshold, "threshold", { min: 0 }),
            failOnLag: opts.failOnLag,
            failOnMismatch: opts.failOnMismatch,
            ...matrixFlags(cmd),
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("tip [network]")
  .description("Compare RPC vs indexer block height")
  .option("--threshold <n>", "Lag threshold in blocks", "100")
  .option("--fail-on-lag", "Exit 1 when |delta| >= threshold (CI)")
  .action(async (network: string | undefined, opts, cmd) => {
    await run(
      async () =>
        tipCommand(
          network,
          {
            ...resolveFlags(cmd),
            threshold: parseFlagInt(opts.threshold, "threshold", { min: 0 }),
            failOnLag: opts.failOnLag,
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("block [selector] [network]")
  .description("Latest block or block header at height")
  .action(
    async (
      selector: string | undefined,
      network: string | undefined,
      _opts,
      cmd,
    ) => {
      await run(
        async () => {
          if (!selector || selector === "latest") {
            return blockLatestCommand(
              network,
              resolveFlags(cmd),
              globalOpts(cmd),
            );
          }

          return blockAtHeightCommand(
            selector,
            network,
            resolveFlags(cmd),
            globalOpts(cmd),
          );
        },
        cmd,
      );
    },
  );

function registerVersions(alias: string, description: string): void {
  program
    .command(alias + " [network]")
    .description(description)
    .option("--fail-on-mismatch", "Exit 1 when live node/api checks fail (CI)")
    .option("--no-local", "Skip reading package.json in current directory")
    .option("--project-dir <dir>", "Check the Midnight packages of the project in this directory (default: current directory)")
    .option("--refresh-matrix", "Fetch Midnight's support matrix even if a cached copy is fresh")
    .action(async (network: string | undefined, opts, cmd) => {
      await run(
        async () =>
          versionsCommand(
            network,
            {
              ...resolveFlags(cmd),
              failOnMismatch: opts.failOnMismatch,
              local: opts.local,
              projectDir: opts.projectDir,
              ...matrixFlags(cmd),
            },
            globalOpts(cmd),
          ),
        cmd,
      );
    });
}

registerVersions(
  "versions",
  "Compare live node/indexer versions to support matrix",
);
registerVersions("matrix", "Alias for versions");

program
  .command("tx <hashOrId> [network]")
  .description("Look up a transaction by hash or identifier (indexer)")
  .option("--by <kind>", "Lookup by hash or identifier", "hash")
  .action(async (hashOrId: string, network: string | undefined, opts, cmd) => {
    const by = opts.by === "identifier" ? "identifier" : "hash";
    await run(
      async () =>
        txCommand(
          hashOrId,
          network,
          { ...resolveFlags(cmd), by },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

const agents = program.command("agents").description("Guidance files that teach AI coding agents to use midnight-cast");

agents
  .command("init")
  .description("Print the AGENTS.md snippet, or write it into the project with --write")
  .option("--file <name>", "AGENTS.md, CLAUDE.md or GEMINI.md", "AGENTS.md")
  .option("--write", "Write the snippet into that file in the current directory")
  .option("--yes", "Change an existing file without asking (only the midnight-cast section)")
  .action(async (opts, cmd) => {
    await run(async () => agentsInitCommand({ file: opts.file, write: opts.write, yes: opts.yes }, globalOpts(cmd)), cmd);
  });

program
  .command("contract <address> [network]")
  .description("Look up a deployed contract: latest action, circuit, deploy block, balances (indexer)")
  .option("--state", "Include the full contract state hex")
  .action(async (address: string, network: string | undefined, opts, cmd) => {
    await run(
      async () => contractCommand(address, network, { ...resolveFlags(cmd), state: opts.state }, globalOpts(cmd)),
      cmd,
    );
  });

program
  .command("dust-status <addresses...>")
  .description("DUST registration and generation for Cardano reward addresses (indexer); a trailing network name picks the network")
  .action(async (args: string[], _opts, cmd) => {
    const network = args.length > 1 && isNetworkName(args.at(-1)) ? args.at(-1) : undefined;
    const addresses = network ? args.slice(0, -1) : args;
    await run(async () => dustStatusCommand(addresses, network, resolveFlags(cmd), globalOpts(cmd)), cmd);
  });

program
  .command("dust-event <id> [network]")
  .description("Fetch one DUST ledger event by id (indexer WebSocket)")
  .option("--verbose", "Print full raw hex")
  .option("--timeout <ms>", "Subscription timeout", "15000")
  .action(async (id: string, network: string | undefined, opts, cmd) => {
    await run(
      async () =>
        dustEventCommand(
          parseFlagInt(id, "dust-event id", { min: 0 }),
          network,
          {
            ...resolveFlags(cmd),
            verbose: opts.verbose,
            timeoutMs: parseFlagInt(opts.timeout, "timeout", { min: 1 }),
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("dust-events [network]")
  .description("List recent DUST ledger events (indexer WebSocket)")
  .option("--from <id>", "Start from event id")
  .option("--limit <n>", "Max events", "10")
  .option("--verbose", "Print full raw hex")
  .option("--timeout <ms>", "Subscription timeout", "30000")
  .action(async (network: string | undefined, opts, cmd) => {
    await run(
      async () =>
        dustEventsCommand(
          network,
          {
            ...resolveFlags(cmd),
            from: opts.from
              ? parseFlagInt(opts.from, "from", { min: 0 })
              : undefined,
            limit: parseFlagInt(opts.limit, "limit", { min: 1, max: 1000 }),
            verbose: opts.verbose,
            timeoutMs: parseFlagInt(opts.timeout, "timeout", { min: 1 }),
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("explain [topic]")
  .description("Static help (e.g. explain dust); with --json and no topic, a catalog of every command")
  .action(async (topic: string | undefined, _opts, cmd) => {
    await run(async () => explainCommand(topic, globalOpts(cmd), () => buildCatalog(program, TOPICS)), cmd);
  });

program
  .command("mcp")
  .description(
    "Run a read-only MCP server on stdio for AI agents (networks from MIDNIGHT_CAST_NETWORKS, Blockfrost ID from BLOCKFROST_PROJECT_ID)",
  )
  .action(async () => {
    // Loaded here so other commands don't pay for the MCP SDK.
    const { allowedNetworks, createMcpServer } = await import("./mcp/server.js");
    const { callsPerMinute } = await import("./mcp/rate-limit.js");
    let networks: string[];
    let perMinute: number;
    try {
      networks = allowedNetworks();
      perMinute = callsPerMinute();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
      return;
    }
    const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
    // serveStdio answers both the 2025 handshake and the stateless 2026-07-28 protocol.
    serveStdio(() =>
      createMcpServer({ version: cliVersion(), catalog: () => buildCatalog(program, TOPICS), networks, callsPerMinute: perMinute }),
    );
    // The client is gone once stdin ends; don't wait for in-flight network calls to time out.
    process.stdin.once("end", () => process.exit(0));
  });

const argv = normalizeArgv(process.argv);

program.parseAsync(argv).catch((err: unknown) => {
  if (!(err instanceof CommanderError)) throw err;
  if (err.exitCode === 0) {
    process.exitCode = 0;
    return;
  }
  if (!argv.includes("--json")) {
    process.exitCode = 2;
    return;
  }
  const missingCommand = err.code === "commander.help";
  const [message = "", ...suggestion] = missingCommand
    ? ["Missing command", "Run midnight-cast explain --json to list the commands"]
    : err.message.replace(/^error: /, "").split("\n");
  const hint = suggestion.join(" ").replace(/^\((.*)\)$/, "$1");
  process.exitCode = emit(
    { ok: false, error: message, errorKind: "usage", ...(hint ? { hint } : {}), exitCode: 2 },
    { json: true },
  );
});
