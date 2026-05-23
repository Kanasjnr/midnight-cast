import { jsonRpc } from "../clients/rpc.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

function parseParams(input?: string): unknown[] {
  if (!input || input.trim() === "") {
    return [];
  }
  try {
    const parsed = JSON.parse(input) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [parsed];
  } catch {
    throw new Error(
      'Invalid JSON params. Use a JSON array, e.g. \'[]\' or \'["0xabc"]\'',
    );
  }
}

export async function rpcCommand(
  method: string,
  paramsJson: string | undefined,
  networkArg: string | undefined,
  flags: ResolveFlags,
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  let params: unknown[];
  try {
    params = parseParams(paramsJson);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    const result = await jsonRpc(endpoints.rpc, method, params);

    return {
      ok: true,
      data: options.json
        ? {
            network: endpoints.network,
            method,
            params,
            result,
          }
        : JSON.stringify(result, null, 2),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : "RPC unreachable");
  }
}
