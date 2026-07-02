import {
  buildVersionChecks,
  buildLocalPackageChecks,
  buildNetworkMismatchWarning,
  fetchLiveVersions,
  formatVersionsHuman,
  isMatrixStale,
  loadSupportMatrix,
  matrixStalenessWarning,
  readLocalMidnightPackages,
  type VersionsReport,
} from "../lib/versions.js";
import { fetchProofServerVersion } from "../clients/proof-server.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export async function versionsCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & { failOnMismatch?: boolean; local?: boolean },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const matrix = loadSupportMatrix();
  const expected = matrix.networks[endpoints.network];

  if (!expected) {
    return fail(
      `No support matrix entry for network "${endpoints.network}". Known: ${Object.keys(matrix.networks).join(", ")}`,
    );
  }

  let live;
  try {
    live = await fetchLiveVersions(endpoints.rpc, endpoints.indexerHttp);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Failed to fetch live versions");
  }

  let liveProofServer: string | undefined;
  if (endpoints.proofServer) {
    try {
      liveProofServer = await fetchProofServerVersion(endpoints.proofServer);
    } catch (err) {
      liveProofServer =
        err instanceof Error ? err.message : "proof server unreachable";
    }
  }

  const checks = buildVersionChecks(expected, live, liveProofServer);
  const localPackages =
    flags.local !== false ? readLocalMidnightPackages() : undefined;
  const localPackageChecks = localPackages
    ? buildLocalPackageChecks(expected, localPackages)
    : undefined;
  const allOk =
    checks.every((c) => c.ok) &&
    (localPackageChecks?.every((c) => c.ok) ?? true);

  const matrixStale = isMatrixStale(matrix.updated);
  const networkWarning = buildNetworkMismatchWarning(
    endpoints.network,
    matrix,
    live.nodeVersion,
  );
  const report: VersionsReport = {
    network: endpoints.network,
    matrixUpdated: matrix.updated,
    matrixStale,
    matrixWarning: matrixStalenessWarning(matrix.updated, matrix.docUrl),
    networkWarning,
    docUrl: matrix.docUrl,
    expected,
    live,
    checks,
    localPackages,
    localPackageChecks,
    allOk,
  };

  if (options.json) {
    return {
      ok: !flags.failOnMismatch || allOk,
      data: report,
      exitCode: flags.failOnMismatch && !allOk ? 1 : 0,
    };
  }

  return {
    ok: !flags.failOnMismatch || allOk,
    data: formatVersionsHuman(report),
    exitCode: flags.failOnMismatch && !allOk ? 1 : 0,
  };
}
