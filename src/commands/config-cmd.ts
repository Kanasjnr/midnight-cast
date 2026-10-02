import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  configPath,
  initConfig,
  loadConfigFile,
  resolveNetwork,
  type ResolveFlags,
} from "../config.js";
import { BUILTIN_NETWORKS, NETWORK_NAMES } from "../networks.js";
import { BLOCKFROST_ENV, PROJECT_ID_SOURCES, isBlockfrostUrl, usesBlockfrost } from "../lib/blockfrost.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

export async function configInitCommand(opts: {
  network?: string;
  rpc?: string;
  indexerHttp?: string;
  indexerWs?: string;
  proofServer?: string;
  yes?: boolean;
}): Promise<EmitResult> {
  let network = opts.network;

  if (!network && !opts.yes) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        `Network (${NETWORK_NAMES.join("|")}) [preprod]: `,
      );
      network = answer.trim() || "preprod";
    } finally {
      rl.close();
    }
  }

  network = network ?? process.env.MN_NETWORK ?? "preprod";

  try {
    const path = initConfig({
      network,
      rpc: opts.rpc,
      indexerHttp: opts.indexerHttp,
      indexerWs: opts.indexerWs,
      proofServer: opts.proofServer,
    });
    const needsToken =
      isBlockfrostUrl(BUILTIN_NETWORKS[network]?.rpc) &&
      !opts.rpc &&
      !loadConfigFile().networks?.[network]?.blockfrost_project_id;
    return success({
      message: `Wrote config to ${path}`,
      network,
      ...(needsToken
        ? {
            next:
              `${network} is served by Blockfrost: set ${BLOCKFROST_ENV}=<your Midnight Mainnet project ID> ` +
              `(or add blockfrost_project_id under [networks.${network}] in ${path})`,
          }
        : {}),
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export function configShowCommand(
  flags: ResolveFlags,
  options: GlobalOptions,
): EmitResult {
  try {
    const resolved = resolveNetwork(flags.network, flags, { requireProjectId: false });
    const file = loadConfigFile();
    const payload = {
      configPath: configPath(),
      defaultNetwork: file.defaults?.network ?? "preprod",
      network: resolved.network,
      networkId: resolved.networkId,
      rpc: resolved.rpc,
      rpcWs: resolved.rpcWs,
      indexerHttp: resolved.indexerHttp,
      indexerWs: resolved.indexerWs,
      proofServer: resolved.proofServer,
      ...(resolved.projectIdSource
        ? { blockfrostProjectId: `set (from ${projectIdSourceLabel(resolved.projectIdSource)})` }
        : usesBlockfrost(resolved)
          ? { blockfrostProjectId: `not set (read from ${PROJECT_ID_SOURCES})` }
          : {}),
      builtin: BUILTIN_NETWORKS[resolved.network] !== undefined,
    };

    if (options.json) {
      return success(payload);
    }

    const lines = Object.entries(payload)
      .filter(([k]) => k !== "builtin")
      .map(([k, v]) => `${k}: ${v ?? ""}`);
    return success(lines.join("\n"));
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function projectIdSourceLabel(source: string): string {
  return (
    { flag: "--project-id", env: BLOCKFROST_ENV, config: "config file", url: "configured URL" } as Record<string, string>
  )[source] ?? source;
}
