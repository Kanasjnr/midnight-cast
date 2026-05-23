import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export async function blockLatestCommand(
  networkArg: string | undefined,
  flags: ResolveFlags,
  _options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    const header = await chainGetHeader(endpoints.rpc);
    const height = parseBlockNumber(header.number);

    return {
      ok: true,
      data: {
        network: endpoints.network,
        height,
        parentHash: header.parentHash,
        stateRoot: header.stateRoot,
        extrinsicsRoot: header.extrinsicsRoot,
      },
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "RPC unreachable");
  }
}
