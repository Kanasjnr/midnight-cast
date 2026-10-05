import { resolveNetwork, type ResolveFlags } from "../config.js";
import { formatContractHuman, getContract, normalizeContractAddress } from "../lib/contract.js";
import type { EmitResult, GlobalOptions, NextStep } from "../output.js";
import { fail } from "../output.js";

export async function contractCommand(
  addressArg: string,
  networkArg: string | undefined,
  flags: ResolveFlags & { state?: boolean },
  options: GlobalOptions,
): Promise<EmitResult> {
  const address = normalizeContractAddress(addressArg);
  if (!address) {
    return fail(`Invalid contract address: ${addressArg}. A contract address is hex, optionally prefixed with 0x`);
  }

  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  try {
    const contract = await getContract(endpoints.indexerHttp, address, flags.state ?? false);
    if (!contract) return fail(`No contract at ${address} on ${endpoints.network}`);

    const next: NextStep[] = [
      {
        command: `midnight-cast tx ${contract.latestAction.transactionHash} ${endpoints.network}`,
        reason: "See the transaction behind the latest action",
      },
    ];
    return {
      ok: true,
      data: options.json ? { network: endpoints.network, ...contract } : formatContractHuman(endpoints.network, contract),
      next,
    };
  } catch (err) {
    return fail(err);
  }
}
