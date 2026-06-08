import {
  buildVersionChecks,
  fetchLiveVersions,
  formatVersionsHuman,
  isMatrixStale,
  loadSupportMatrix,
  matrixStalenessWarning,
  readLocalMidnightPackages,
  type VersionsReport,
} from "../lib/versions.js";
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

  const checks = buildVersionChecks(expected, live);
  const allOk = checks.every((c) => c.ok);

  const matrixStale = isMatrixStale(matrix.updated);
  const report: VersionsReport = {
    network: endpoints.network,
    matrixUpdated: matrix.updated,
    matrixStale,
    matrixWarning: matrixStalenessWarning(matrix.updated),
    docUrl: matrix.docUrl,
    expected,
    live,
    checks,
    localPackages:
      flags.local !== false ? readLocalMidnightPackages() : undefined,
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
