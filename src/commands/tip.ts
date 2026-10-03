import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { getLatestBlockHeight } from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { computeDelta, describeLag, tipExitCode } from "../lib/delta.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, failReaching } from "../output.js";

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
    return fail(err);
  }

  const threshold = flags.threshold ?? 100;

  let rpcHeight: number;
  let indexerHeight: number;

  try {
    const header = await chainGetHeader(endpoints.rpc);
    rpcHeight = parseBlockNumber(header.number);
  } catch (err) {
    return failReaching(err, endpoints.network, flags);
  }

  try {
    indexerHeight = await getLatestBlockHeight(endpoints.indexerHttp);
  } catch (err) {
    return failReaching(err, endpoints.network, flags);
  }

  const delta = computeDelta(rpcHeight, indexerHeight);
  const lagging = Math.abs(delta) >= threshold;
  const exitCode = tipExitCode(delta, threshold, flags.failOnLag);

  return {
    ok: exitCode === 0,
    ...(exitCode === 0 ? {} : { error: describeLag(delta, threshold) }),
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
