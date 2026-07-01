import { chainGetHeader, systemHealth } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

interface ServiceResult {
  service: string;
  status: "OK" | "FAIL";
  latencyMs: number;
  detail?: string;
}

export async function runServiceChecks(endpoints: {
  rpc: string;
  indexerHttp: string;
  proofServer?: string;
}): Promise<ServiceResult[]> {
  const results: ServiceResult[] = [
    await checkRpc(endpoints.rpc),
    await checkIndexer(endpoints.indexerHttp),
  ];

  if (endpoints.proofServer) {
    results.push(await checkProofServer(endpoints.proofServer));
  }

  return results;
}

async function checkRpc(rpcUrl: string): Promise<ServiceResult> {
  const start = Date.now();
  try {
    await systemHealth(rpcUrl);
    return {
      service: "rpc",
      status: "OK",
      latencyMs: Date.now() - start,
    };
  } catch {
    try {
      await chainGetHeader(rpcUrl);
      return {
        service: "rpc",
        status: "OK",
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        service: "rpc",
        status: "FAIL",
        latencyMs: Date.now() - start,
        detail: err instanceof Error ? err.message : "RPC unreachable",
      };
    }
  }
}

async function checkIndexer(indexerHttp: string): Promise<ServiceResult> {
  const start = Date.now();
  try {
    await gqlPost(indexerHttp, `query { block { height } }`);
    return {
      service: "indexer",
      status: "OK",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      service: "indexer",
      status: "FAIL",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "Indexer unreachable",
    };
  }
}

async function checkProofServer(url: string): Promise<ServiceResult> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        service: "proof-server",
        status: "FAIL",
        latencyMs: Date.now() - start,
        detail: `HTTP ${response.status}`,
      };
    }
    return {
      service: "proof-server",
      status: "OK",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      service: "proof-server",
      status: "FAIL",
      latencyMs: Date.now() - start,
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

export async function pingCommand(
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

  const results = await runServiceChecks(endpoints);

  const requiredOk = results
    .filter((r) => r.service === "rpc" || r.service === "indexer")
    .every((r) => r.status === "OK");

  return {
    ok: requiredOk,
    data: {
      network: endpoints.network,
      table: results.map((r) => ({
        service: r.service,
        status: r.status,
        latencyMs: r.latencyMs,
        ...(r.service === "proof-server" ? { optional: true } : {}),
        ...(r.detail ? { detail: r.detail } : {}),
      })),
    },
    exitCode: requiredOk ? 0 : 1,
  };
}
