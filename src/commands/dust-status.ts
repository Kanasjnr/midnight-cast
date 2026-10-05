import { resolveNetwork, type ResolveFlags } from "../config.js";
import { formatDustStatusHuman, getDustStatus } from "../lib/dust-status.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export async function dustStatusCommand(
  addresses: string[],
  networkArg: string | undefined,
  flags: ResolveFlags,
  options: GlobalOptions,
): Promise<EmitResult> {
  const wanted = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))];
  if (!wanted.length) return fail("Give at least one Cardano reward address (stake… or stake_test…)");

  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  try {
    const statuses = await getDustStatus(endpoints.indexerHttp, wanted);
    const unregistered = statuses.some((s) => !s.registered);
    return {
      ok: true,
      data: options.json ? { network: endpoints.network, addresses: statuses } : formatDustStatusHuman(endpoints.network, statuses),
      next: unregistered
        ? [{ command: "midnight-cast explain dust", reason: "How DUST generation and registration work" }]
        : [],
    };
  } catch (err) {
    return fail(err);
  }
}
