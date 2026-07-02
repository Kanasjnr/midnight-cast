import { chainGetHeader, systemHealth } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import {
  fetchProofServerVersion,
  proofServerBaseUrl,
} from "../clients/proof-server.js";
import { versionMatches } from "../lib/versions.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { loadSupportMatrix } from "../lib/versions.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export interface ServiceResult {
  service: string;
  status: "OK" | "FAIL";
  latencyMs: number;
  detail?: string;
  version?: string;
}

export async function runServiceChecks(
  endpoints: {
    rpc: string;
    indexerHttp: string;
    proofServer?: string;
  },
  options?: { proofServerExpected?: string },
): Promise<ServiceResult[]> {
  const results: ServiceResult[] = [
    await checkRpc(endpoints.rpc),
    await checkIndexer(endpoints.indexerHttp),
  ];

  if (endpoints.proofServer) {
    results.push(
      await checkProofServer(
        endpoints.proofServer,
        options?.proofServerExpected,
      ),
    );
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

async function checkProofServer(
  url: string,
  expectedVersion?: string,
): Promise<ServiceResult> {
  const start = Date.now();
  const base = proofServerBaseUrl(url);

  try {
    const response = await fetch(base, {
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

    let liveVersion: string;
    try {
      liveVersion = await fetchProofServerVersion(base);
    } catch (err) {
      return {
        service: "proof-server",
        status: "FAIL",
        latencyMs: Date.now() - start,
        detail:
          err instanceof Error
            ? `/version failed: ${err.message}`
            : "/version failed",
      };
    }

    const versionOk =
      expectedVersion === undefined ||
      versionMatches(expectedVersion, liveVersion);

    const detail =
      expectedVersion !== undefined
        ? versionOk
          ? `version=${liveVersion} (matches matrix ${expectedVersion})`
          : `version=${liveVersion} (expected ${expectedVersion})`
        : `version=${liveVersion}`;

    return {
      service: "proof-server",
      status: versionOk ? "OK" : "FAIL",
      latencyMs: Date.now() - start,
      detail,
      version: liveVersion,
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

  const matrix = loadSupportMatrix();
  const expected = matrix.networks[endpoints.network];
  const results = await runServiceChecks(endpoints, {
    proofServerExpected: expected?.proofServer,
  });

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
        ...(r.version ? { version: r.version } : {}),
        ...(r.detail ? { detail: r.detail } : {}),
      })),
    },
    exitCode: requiredOk ? 0 : 1,
  };
}
