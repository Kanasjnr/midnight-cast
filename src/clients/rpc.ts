const DEFAULT_TIMEOUT_MS = 5000;

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export interface ChainHeader {
  number: string;
  parentHash: string;
  stateRoot: string;
  extrinsicsRoot: string;
  digest: unknown;
}

export async function jsonRpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("RPC unreachable");
  }

  if (!response.ok) {
    throw new Error(`RPC unreachable (${response.status})`);
  }

  const body = (await response.json()) as JsonRpcResponse<T>;
  if (body.error) {
    throw new Error(`RPC error: ${body.error.message}`);
  }
  if (body.result === undefined) {
    throw new Error("RPC unreachable (empty result)");
  }
  return body.result;
}

export async function chainGetHeader(
  rpcUrl: string,
): Promise<ChainHeader> {
  return jsonRpc<ChainHeader>(rpcUrl, "chain_getHeader", []);
}

export async function systemHealth(
  rpcUrl: string,
): Promise<Record<string, unknown>> {
  return jsonRpc<Record<string, unknown>>(rpcUrl, "system_health", []);
}

export function parseBlockNumber(numberHex: string): number {
  return parseInt(numberHex.replace(/^0x/i, ""), 16);
}
