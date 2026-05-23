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

  network = network ?? "preprod";

  try {
    const path = initConfig({
      network,
      rpc: opts.rpc,
      indexerHttp: opts.indexerHttp,
      indexerWs: opts.indexerWs,
      proofServer: opts.proofServer,
    });
    return success({ message: `Wrote config to ${path}`, network });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export function configShowCommand(
  flags: ResolveFlags,
  options: GlobalOptions,
): EmitResult {
  try {
    const resolved = resolveNetwork(flags.network, flags);
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
