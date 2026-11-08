import { jsonRpc } from "../clients/rpc.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, warn } from "../output.js";
import { isReadOnlyRpcMethod } from "../lib/rpc-methods.js";

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
  { allowWrite = false }: { allowWrite?: boolean } = {},
): Promise<EmitResult> {
  const readOnly = isReadOnlyRpcMethod(method);
  if (!readOnly && !allowWrite) {
    return {
      ok: false,
      error: `${method} isn't on rpc's list of read-only methods, so it wasn't sent.`,
      hint: "midnight-cast explain --json lists the read-only methods under the rpc command. To send a method that may submit or change node state, pass --allow-write.",
      exitCode: 1,
    };
  }
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  let params: unknown[];
  try {
    params = parseParams(paramsJson);
  } catch (err) {
    return fail(err);
  }

  if (!readOnly) warn(`--allow-write: ${method} isn't a known read-only method and may submit or change node state.`);

  try {
    // A method that may submit is never retried.
    const result = await jsonRpc(endpoints.rpc, method, params, readOnly ? {} : { attempts: 1 });

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
    return fail(err);
  }
}
