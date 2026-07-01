import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { getLatestBlockHeight } from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { computeDelta, tipExitCode } from "../lib/delta.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export async function tipCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & {
    threshold?: number;
    failOnLag?: boolean;
  },
  _options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const threshold = flags.threshold ?? 100;

  let rpcHeight: number;
  let indexerHeight: number;

  try {
    const header = await chainGetHeader(endpoints.rpc);
    rpcHeight = parseBlockNumber(header.number);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "RPC unreachable");
  }

  try {
    indexerHeight = await getLatestBlockHeight(endpoints.indexerHttp);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Indexer unreachable");
  }

  const delta = computeDelta(rpcHeight, indexerHeight);
  const lagging = Math.abs(delta) >= threshold;
  const exitCode = tipExitCode(delta, threshold, flags.failOnLag);

  return {
    ok: exitCode === 0,
    data: {
      network: endpoints.network,
      rpcHeight,
      indexerHeight,
      delta,
      threshold,
      inSync: !lagging,
    },
    exitCode,
  };
}
