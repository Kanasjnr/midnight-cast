import { chainGetHeader, systemHealth } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import {
  fetchProofServerVersion,
  proofServerBaseUrl,
} from "../clients/proof-server.js";
import { isNewerPatch, proofServerMatches } from "../lib/versions.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { loadSupportMatrix } from "../lib/versions.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";
import { checkEndpoints } from "../lib/next-steps.js";
import { NetworkError, isTransportKind } from "../lib/network-error.js";

export interface ServiceResult {
  service: string;
  status: "OK" | "FAIL";
  latencyMs: number;
  detail?: string;
  errorKind?: string;
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
  const checks = [checkRpc(endpoints.rpc), checkIndexer(endpoints.indexerHttp)];
  if (endpoints.proofServer) {
    checks.push(checkProofServer(endpoints.proofServer, options?.proofServerExpected));
  }
  return Promise.all(checks);
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
  } catch (err) {
    const retriesExhausted =
      err instanceof NetworkError &&
      (isTransportKind(err.kind) || [502, 503, 504].includes(err.status ?? 0));
    if (retriesExhausted) {
      return {
        service: "rpc",
        status: "FAIL",
        latencyMs: Date.now() - start,
        ...failure(err, "RPC unreachable"),
      };
    }
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
        ...failure(err, "RPC unreachable"),
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
      ...failure(err, "Indexer unreachable"),
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
      proofServerMatches(expectedVersion, liveVersion);

    const detail =
      expectedVersion !== undefined
        ? versionOk
          ? isNewerPatch(expectedVersion, liveVersion)
            ? `version=${liveVersion} (newer patch than matrix ${expectedVersion})`
            : `version=${liveVersion} (matches matrix ${expectedVersion})`
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
    return fail(err);
  }

  const matrix = loadSupportMatrix();
  const expected = matrix.networks[endpoints.network];
  const results = await runServiceChecks(endpoints, {
    proofServerExpected: expected?.proofServer,
  });

  if (!endpoints.proofServer) {
    results.push({
      service: "proof-server",
      status: "FAIL",
      latencyMs: 0,
      detail: "not configured (set proofServer URL or use local default :6300)",
    });
  }

  const failed = results.filter((r) => (r.service === "rpc" || r.service === "indexer") && r.status !== "OK");
  return {
    ok: failed.length === 0,
    ...(failed.length
      ? {
          error: `Required services unreachable: ${failed.map((r) => r.service).join(", ")}`,
          ...(failed[0]?.errorKind ? { errorKind: failed[0].errorKind } : {}),
          next: checkEndpoints(endpoints.network, flags),
        }
      : {}),
    data: {
      network: endpoints.network,
      table: results.map((r) => ({
        service: r.service,
        status: r.status,
        latencyMs: r.latencyMs,
        ...(r.service === "proof-server" ? { optional: true } : {}),
        ...(r.version ? { version: r.version } : {}),
        ...(r.detail ? { detail: r.detail } : {}),
        ...(r.errorKind ? { errorKind: r.errorKind } : {}),
      })),
    },
    exitCode: failed.length === 0 ? 0 : 1,
  };
}

function failure(err: unknown, fallback: string): Pick<ServiceResult, "detail" | "errorKind"> {
  return {
    detail: err instanceof Error ? err.message : fallback,
    ...(err instanceof NetworkError ? { errorKind: err.kind } : {}),
  };
}
