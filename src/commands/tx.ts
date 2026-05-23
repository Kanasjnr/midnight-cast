import { getTransaction, formatTransactionHuman } from "../lib/transaction.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

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

    if (options.json) {
      return { ok: true, data: { network: endpoints.network, ...tx } };
    }

    return { ok: true, data: formatTransactionHuman(tx) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Indexer unreachable");
  }
}
