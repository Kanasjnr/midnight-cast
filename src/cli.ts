#!/usr/bin/env node
import { Command } from "commander";
import { emit, type GlobalOptions } from "./output.js";
import { configInitCommand, configShowCommand } from "./commands/config-cmd.js";
import { decodeCommand } from "./commands/decode.js";
import { rpcCommand } from "./commands/rpc.js";
import { pingCommand } from "./commands/ping.js";
import { tipCommand } from "./commands/tip.js";
import { blockLatestCommand } from "./commands/block.js";
import { dustEventCommand, dustEventsCommand } from "./commands/dust.js";
import { explainCommand } from "./commands/explain.js";
import { txCommand } from "./commands/tx.js";
import { versionsCommand } from "./commands/versions.js";
import type { ResolveFlags } from "./config.js";

const program = new Command();

program
  .name("mn")
  .description("Read-only developer CLI for Midnight")
  .option("--json", "JSON output")
  .option("--network <name>", "Network (preview|preprod|mainnet|local)")
  .option("--rpc <url>", "Override RPC URL")
  .option("--indexer-http <url>", "Override indexer HTTP URL")
  .option("--indexer-ws <url>", "Override indexer WebSocket URL")
  .option("--proof-server <url>", "Override proof server URL");

function globalOpts(cmd: Command): GlobalOptions {
  const o = cmd.optsWithGlobals();
  return { json: o.json };
}

function resolveFlags(cmd: Command): ResolveFlags {
  const o = cmd.optsWithGlobals();
  return {
    network: o.network,
    rpc: o.rpc,
    indexerHttp: o.indexerHttp,
    indexerWs: o.indexerWs,
    proofServer: o.proofServer,
  };
}

async function run(
  fn: () => Promise<{ ok: boolean; exitCode?: number }>,
  cmd: Command,
): Promise<void> {
  try {
    const result = await fn();
    process.exit(emit(result, globalOpts(cmd)));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.exit(
      emit({ ok: false, error: message, exitCode: 1 }, globalOpts(cmd)),
    );
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
    await run(async () => configInitCommand(opts), cmd);
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
  .description("Decode errors (ledger, pallet, 1010, jsonrpc)");

decode
  .command("ledger <code>")
  .description("Ledger Custom(N) / LedgerApiError code (0–255)")
  .action(async (code: string, _opts, cmd) => {
    await run(
      async () => decodeCommand(["ledger", code], globalOpts(cmd)),
      cmd,
    );
  });

decode
  .command("pallet <index> <variant>")
  .description("Pallet DispatchError::Module { index, error }")
  .action(async (index: string, variant: string, _opts, cmd) => {
    await run(
      async () => decodeCommand(["pallet", index, variant], globalOpts(cmd)),
      cmd,
    );
  });

decode
  .command("1010")
  .description("Explain Substrate 1010 Invalid Transaction envelope")
  .action(async (_opts, cmd) => {
    await run(async () => decodeCommand(["1010"], globalOpts(cmd)), cmd);
  });

decode
  .command("jsonrpc <code>")
  .description("JSON-RPC error code (e.g. -32602)")
  .action(async (code: string, _opts, cmd) => {
    await run(
      async () => decodeCommand(["jsonrpc", code], globalOpts(cmd)),
      cmd,
    );
  });

decode
  .command("[code]")
  .description("Shorthand: ledger code or 1010")
  .action(async (code: string | undefined, _opts, cmd) => {
    if (!code) {
      await run(
        async () => decodeCommand([], globalOpts(cmd)),
        cmd,
      );
      return;
    }
    await run(async () => decodeCommand([code], globalOpts(cmd)), cmd);
  });

program
  .command("rpc <method> [params]")
  .description("Call a JSON-RPC method on the node (params as JSON array)")
  .action(async (method: string, params: string | undefined, _opts, cmd) => {
    const o = cmd.optsWithGlobals();
    await run(
      async () =>
        rpcCommand(
          method,
          params,
          undefined,
          resolveFlags(cmd),
          globalOpts(cmd),
        ),
      cmd,
    );
  });

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
            threshold: parseInt(opts.threshold, 10),
            failOnLag: opts.failOnLag,
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

const block = program.command("block").description("Block queries");

block
  .command("latest [network]")
  .description("Latest block header from RPC")
  .action(async (network: string | undefined, _opts, cmd) => {
    await run(
      async () =>
        blockLatestCommand(network, resolveFlags(cmd), globalOpts(cmd)),
      cmd,
    );
  });

function registerVersions(alias: string, description: string): void {
  program
    .command(alias + " [network]")
    .description(description)
    .option("--fail-on-mismatch", "Exit 1 when live node/api checks fail (CI)")
    .option("--no-local", "Skip reading package.json in current directory")
    .action(async (network: string | undefined, opts, cmd) => {
      await run(
        async () =>
          versionsCommand(
            network,
            {
              ...resolveFlags(cmd),
              failOnMismatch: opts.failOnMismatch,
              local: opts.local,
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
  .command("tx <hashOrId>")
  .description("Look up a transaction by hash or identifier (indexer)")
  .option("--by <kind>", "Lookup by hash or identifier", "hash")
  .action(async (hashOrId: string, opts, cmd) => {
    const by = opts.by === "identifier" ? "identifier" : "hash";
    const o = cmd.optsWithGlobals();
    await run(
      async () =>
        txCommand(
          hashOrId,
          o.network,
          { ...resolveFlags(cmd), by },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("dust-event <id>")
  .description("Fetch one DUST ledger event by id (indexer WebSocket)")
  .option("--verbose", "Print full raw hex")
  .option("--timeout <ms>", "Subscription timeout", "15000")
  .action(async (id: string, opts, cmd) => {
    await run(
      async () =>
        dustEventCommand(
          parseInt(id, 10),
          undefined,
          {
            ...resolveFlags(cmd),
            verbose: opts.verbose,
            timeoutMs: parseInt(opts.timeout, 10),
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
            from: opts.from ? parseInt(opts.from, 10) : undefined,
            limit: parseInt(opts.limit, 10),
            verbose: opts.verbose,
            timeoutMs: parseInt(opts.timeout, 10),
          },
          globalOpts(cmd),
        ),
      cmd,
    );
  });

program
  .command("explain <topic>")
  .description("Static help (e.g. explain dust)")
  .action(async (topic: string, _opts, cmd) => {
    await run(async () => explainCommand(topic, globalOpts(cmd)), cmd);
  });

program.parseAsync(process.argv);
