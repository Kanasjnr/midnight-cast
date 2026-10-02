import { jsonRpc } from "../clients/rpc.js";
import { getTransaction, formatTransactionHuman } from "../lib/transaction.js";
import {
  buildNetworkMismatchWarning,
  loadSupportMatrix,
  parseNodeVersion,
} from "../lib/versions.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

/** Optional: warns when the endpoints' node or runtime don't fit the selected network. */
async function networkWarningFor(
  endpoints: { rpc: string; network: string },
): Promise<string | undefined> {
  try {
    const [systemVersion, runtime] = await Promise.all([
      jsonRpc<string>(endpoints.rpc, "system_version", []),
      jsonRpc<{ specVersion: number }>(endpoints.rpc, "chain_getRuntimeVersion", []),
    ]);
    return buildNetworkMismatchWarning(
      endpoints.network,
      loadSupportMatrix(),
      parseNodeVersion(systemVersion),
      runtime.specVersion,
    );
  } catch {
    return undefined; // optional warning only
  }
}

export async function txCommand(
  hashOrId: string,
  networkArg: string | undefined,
  flags: ResolveFlags & { by?: "hash" | "identifier" },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const lookup =
    flags.by === "identifier"
      ? { identifier: hashOrId }
      : { hash: hashOrId };

  try {
    const tx = await getTransaction(endpoints.indexerHttp, lookup);

    if (!tx) {
      const kind = flags.by === "identifier" ? "identifier" : "hash";
      return fail(`Transaction not found for ${kind}: ${hashOrId}`);
    }

    const networkWarning = await networkWarningFor(endpoints);

    if (options.json) {
      return {
        ok: true,
        data: {
          network: endpoints.network,
          ...(networkWarning ? { networkWarning } : {}),
          ...tx,
        },
      };
    }

    let human = formatTransactionHuman(tx);
    if (networkWarning) {
      human += `\n\nWarning:  ${networkWarning}`;
    }

    return { ok: true, data: human };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Indexer unreachable");
  }
}
