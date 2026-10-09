import { postJson, readJson } from "../lib/http.js";
import { sanitizeForOutput } from "../lib/sanitize.js";
import { blockfrostHttpError, isBlockfrostUrl, takeProjectId } from "../lib/blockfrost.js";
import { NetworkError, statusKind, transportKind } from "../lib/network-error.js";

const DEFAULT_TIMEOUT_MS = 10_000;

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
  { timeoutMs = DEFAULT_TIMEOUT_MS, attempts }: { timeoutMs?: number; attempts?: number } = {},
): Promise<T> {
  const { url: target, projectId } = takeProjectId(url);
  let response: Response;
  try {
    response = await postJson(
      target,
      { jsonrpc: "2.0", method, params, id: 1 },
      { timeoutMs, attempts, headers: projectId ? { project_id: projectId } : {} },
    );
  } catch (err) {
    throw new NetworkError("RPC unreachable", transportKind(err), "RPC");
  }

  if (!response.ok) {
    throw new NetworkError(
      (isBlockfrostUrl(target) && blockfrostHttpError("RPC", response.status, target)) ||
        `RPC unreachable (${response.status})`,
      statusKind(response.status),
      "RPC",
      response.status,
    );
  }

  const body = await readJson<JsonRpcResponse<T>>(response, "RPC");
  if (body.error) {
    throw new NetworkError(`RPC error: ${sanitizeForOutput(body.error.message)}`, "rpc_error", "RPC");
  }
  if (body.result === undefined) {
    throw new NetworkError("RPC unreachable (empty result)", "invalid_response", "RPC");
  }
  return body.result;
}

export async function chainGetHeader(
  rpcUrl: string,
  blockHash?: string,
): Promise<ChainHeader> {
  const params = blockHash ? [blockHash] : [];
  return jsonRpc<ChainHeader>(rpcUrl, "chain_getHeader", params);
}

export async function chainGetBlockHash(
  rpcUrl: string,
  blockNumber: number,
): Promise<string> {
  const heightHex = `0x${blockNumber.toString(16)}`;
  return jsonRpc<string>(rpcUrl, "chain_getBlockHash", [heightHex]);
}

export async function chainGetHeadBlockHash(rpcUrl: string): Promise<string> {
  return jsonRpc<string>(rpcUrl, "chain_getBlockHash", []);
}

export async function systemHealth(
  rpcUrl: string,
): Promise<Record<string, unknown>> {
  return jsonRpc<Record<string, unknown>>(rpcUrl, "system_health", []);
}

export function parseBlockNumber(numberHex: string): number {
  return parseInt(numberHex.replace(/^0x/i, ""), 16);
}
