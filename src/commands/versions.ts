import {
  buildVersionChecks,
  buildNetworkMismatchWarning,
  fetchLiveVersions,
  formatVersionsHuman,
  isMatrixStale,
  matrixStalenessWarning,
  checkLocalPackages,
  type VersionsReport,
} from "../lib/versions.js";
import { fetchProofServerVersion } from "../clients/proof-server.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { sanitizeForOutput } from "../lib/sanitize.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, failReaching } from "../output.js";
import { EXPLAIN_VERSIONS } from "../lib/next-steps.js";
import { resolveSupportMatrix } from "../lib/upstream-matrix.js";

export async function versionsCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & { failOnMismatch?: boolean; local?: boolean; offline?: boolean; refreshMatrix?: boolean },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  const { matrix, source: matrixSource, notes } = await resolveSupportMatrix({
    offline: flags.offline,
    refresh: flags.refreshMatrix,
  });
  const expected = matrix.networks[endpoints.network];
  const matrixNotes = notes[endpoints.network] ?? [];

  if (!expected) {
    return fail(
      `No support matrix entry for network "${endpoints.network}". Known: ${Object.keys(matrix.networks).join(", ")}`,
    );
  }

  let live;
  try {
    live = await fetchLiveVersions(endpoints.rpc, endpoints.indexerHttp);
  } catch (err) {
    return failReaching(err, endpoints.network, flags);
  }

  let liveProofServer: string | undefined;
  if (endpoints.proofServer) {
    try {
      liveProofServer = await fetchProofServerVersion(endpoints.proofServer);
    } catch (err) {
      liveProofServer = sanitizeForOutput(
        err instanceof Error ? err.message : "proof server unreachable",
      );
    }
  }

  const checks = buildVersionChecks(expected, live, liveProofServer);
  const local = flags.local !== false ? checkLocalPackages(expected) : {};
  const { localPackageChecks } = local;
  const allOk =
    checks.every((c) => c.ok) &&
    (localPackageChecks?.every((c) => c.ok) ?? true);

  const matrixStale = matrixSource.kind === "bundled" && isMatrixStale(matrix.updated);
  const networkWarning = buildNetworkMismatchWarning(
    endpoints.network,
    matrix,
    live.nodeVersion,
    live.runtimeSpecVersion,
  );
  const report: VersionsReport = {
    network: endpoints.network,
    matrixUpdated: matrix.updated,
    matrixStale,
    matrixWarning: matrixSource.kind === "bundled" ? matrixStalenessWarning(matrix.updated, matrix.docUrl) : undefined,
    matrixSource,
    ...(matrixNotes.length ? { matrixNotes } : {}),
    networkWarning,
    docUrl: matrix.docUrl,
    expected,
    live,
    checks,
    ...local,
    allOk,
  };

  const failing = flags.failOnMismatch && !allOk;
  const error = failing
    ? `Version checks failed: ${[...checks, ...(local.localPackageChecks ?? [])].filter((c) => !c.ok).map((c) => c.label).join(", ")}`
    : undefined;

  return {
    ok: !failing,
    data: options.json ? report : formatVersionsHuman(report),
    exitCode: failing ? 1 : 0,
    ...(error ? { error } : {}),
    next: allOk ? [] : [EXPLAIN_VERSIONS],
  };
}
