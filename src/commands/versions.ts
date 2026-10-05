import { statSync } from "node:fs";
import { resolve } from "node:path";
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
import { settle } from "../lib/settle.js";
import { examplesVerdict } from "../lib/examples-report.js";

export async function versionsCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & {
    failOnMismatch?: boolean;
    local?: boolean;
    projectDir?: string;
    offline?: boolean;
    refreshMatrix?: boolean;
  },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  // A wrong directory is a usage mistake: say so before reaching any network.
  const projectDir = resolve(flags.projectDir ?? process.cwd());
  if (flags.local !== false && !statSync(projectDir, { throwIfNoEntry: false })?.isDirectory()) {
    return fail(`No such directory: ${projectDir}`);
  }
  const liveResult = settle(fetchLiveVersions(endpoints.rpc, endpoints.indexerHttp));
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

  const liveOutcome = await liveResult;
  if (!liveOutcome.ok) return failReaching(liveOutcome.error, endpoints.network, flags);
  const live = liveOutcome.value;
  const examples = examplesVerdict(endpoints.network, live, { offline: flags.offline, refresh: flags.refreshMatrix });

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
  const local = flags.local !== false ? checkLocalPackages(expected, projectDir) : {};
  const { localPackageChecks } = local;
  const allOk =
    checks.every((c) => c.ok) &&
    (localPackageChecks?.every((c) => c.ok) ?? true);

  const matrixStale = isMatrixStale(matrix.updated);
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
    matrixWarning: matrixStalenessWarning(matrix.updated, matrix.docUrl),
    matrixSource,
    ...(matrixNotes.length ? { matrixNotes } : {}),
    networkWarning,
    docUrl: matrix.docUrl,
    expected,
    live,
    checks,
    ...local,
    examples: await examples,
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
