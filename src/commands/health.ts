import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { getLatestBlockHeight } from "../clients/indexer.js";
import { fetchProofServerVersion } from "../clients/proof-server.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { computeDelta, describeLag, tipExitCode } from "../lib/delta.js";
import {
  buildVersionChecks,
  fetchLiveVersions,
  isMatrixStale,
  matrixStalenessWarning,
} from "../lib/versions.js";
import { runServiceChecks } from "./ping.js";
import { describeMatrixSource, resolveSupportMatrix, type MatrixSource } from "../lib/upstream-matrix.js";
import { settle } from "../lib/settle.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, failReaching } from "../output.js";
import { EXPLAIN_VERSIONS, checkEndpoints, narrowDown } from "../lib/next-steps.js";

export interface HealthReport {
  network: string;
  healthy: boolean;
  services: Array<{
    service: string;
    status: string;
    latencyMs: number;
    optional?: boolean;
    detail?: string;
    errorKind?: string;
  }>;
  sync: {
    rpcHeight: number;
    indexerHeight: number;
    delta: number;
    threshold: number;
    inSync: boolean;
  };
  versions: {
    matrixUpdated: string;
    matrixStale: boolean;
    matrixWarning?: string;
    matrixSource?: MatrixSource;
    matrixNotes?: string[];
    allOk: boolean;
    checks: Array<{ label: string; ok: boolean; expected?: string; live?: string; note?: string }>;
  };
}

function formatHealthHuman(report: HealthReport): string {
  const lines: string[] = [
    `Network: ${report.network}`,
    `Healthy: ${report.healthy ? "yes" : "no"}`,
  ];

  if (report.healthy && !report.versions.allOk) {
    lines.push(
      "Note:    healthy (services/sync OK) but version checks mismatched — " +
        "use --fail-on-mismatch for CI",
    );
  }

  lines.push("", "Services:");

  for (const row of report.services) {
    const opt = row.optional ? " (optional)" : "";
    const detail = row.detail ? ` — ${row.detail}` : "";
    lines.push(
      `  ${row.service}: ${row.status} (${row.latencyMs}ms)${opt}${detail}`,
    );
  }

  lines.push(
    "",
    "Sync:",
    `  RPC height:      ${report.sync.rpcHeight}`,
    `  Indexer height:  ${report.sync.indexerHeight}`,
    `  Delta:           ${report.sync.delta} (threshold ${report.sync.threshold})`,
    `  In sync:         ${report.sync.inSync ? "yes" : "no"}`,
    "",
    "Versions:",
    report.versions.matrixSource
      ? `  Matrix:          ${describeMatrixSource(report.versions.matrixSource)}`
      : `  Matrix updated:  ${report.versions.matrixUpdated}${report.versions.matrixStale ? " (stale)" : ""}`,
    ...(report.versions.matrixNotes ?? []).map((note) => `  Note: published matrix: ${note}`),
  );

  if (report.versions.matrixWarning) {
    lines.push(`  ${report.versions.matrixWarning}`);
  }

  for (const check of report.versions.checks) {
    const status = check.ok ? "OK" : "MISMATCH";
    lines.push(
      `  ${check.label}: ${status} (expected ${check.expected ?? "?"}, live ${check.live ?? "?"})`,
    );
  }

  return lines.join("\n");
}

export async function healthCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & {
    threshold?: number;
    failOnLag?: boolean;
    failOnMismatch?: boolean;
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

  const threshold = flags.threshold ?? 100;
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

  const serviceResults = await runServiceChecks(endpoints, {
    proofServerExpected: expected.proofServer,
  });
  const servicesOk = serviceResults
    .filter((r) => r.service === "rpc" || r.service === "indexer")
    .every((r) => r.status === "OK");

  let rpcHeight: number;
  let indexerHeight: number;
  let syncOk = true;

  try {
    const header = await chainGetHeader(endpoints.rpc);
    rpcHeight = parseBlockNumber(header.number);
  } catch (err) {
    return failReaching(err, endpoints.network, flags);
  }

  try {
    indexerHeight = await getLatestBlockHeight(endpoints.indexerHttp);
  } catch (err) {
    return failReaching(err, endpoints.network, flags);
  }

  const delta = computeDelta(rpcHeight, indexerHeight);
  const inSync = Math.abs(delta) < threshold;
  syncOk = tipExitCode(delta, threshold, flags.failOnLag) === 0;

  const liveOutcome = await liveResult;
  if (!liveOutcome.ok) return failReaching(liveOutcome.error, endpoints.network, flags);
  const live = liveOutcome.value;

  let liveProofServer: string | undefined;
  if (endpoints.proofServer) {
    try {
      liveProofServer = await fetchProofServerVersion(endpoints.proofServer);
    } catch (err) {
      liveProofServer =
        err instanceof Error ? err.message : "proof server unreachable";
    }
  }

  const versionChecks = buildVersionChecks(expected, live, liveProofServer);
  const versionsOk = versionChecks.every((c) => c.ok);
  const matrixStale = isMatrixStale(matrix.updated);

  const healthy =
    servicesOk &&
    (!flags.failOnMismatch || versionsOk) &&
    syncOk;

  const report: HealthReport = {
    network: endpoints.network,
    healthy,
    services: serviceResults.map((r) => ({
      service: r.service,
      status: r.status,
      latencyMs: r.latencyMs,
      ...(r.service === "proof-server" ? { optional: true } : {}),
      ...(r.version ? { version: r.version } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.errorKind ? { errorKind: r.errorKind } : {}),
    })),
    sync: {
      rpcHeight,
      indexerHeight,
      delta,
      threshold,
      inSync,
    },
    versions: {
      matrixUpdated: matrix.updated,
      matrixStale,
      matrixWarning: matrixStalenessWarning(matrix.updated, matrix.docUrl),
      matrixSource,
      ...(matrixNotes.length ? { matrixNotes } : {}),
      allOk: versionsOk,
      checks: versionChecks.map((c) => ({
        label: c.label,
        ok: c.ok,
        expected: c.expected,
        live: c.live,
        ...(c.note ? { note: c.note } : {}),
      })),
    },
  };

  const exitCode = healthy ? 0 : 1;
  const error = healthy ? undefined : unhealthyReason(report, { syncOk, versionsCount: flags.failOnMismatch ?? false });
  const next = [
    ...narrowDown(endpoints.network, flags, { services: !servicesOk, sync: !inSync }),
    ...(servicesOk ? [] : checkEndpoints(endpoints.network, flags)),
    ...(versionsOk ? [] : [EXPLAIN_VERSIONS]),
  ];

  return {
    ok: healthy,
    data: options.json ? report : formatHealthHuman(report),
    exitCode,
    ...(error ? { error } : {}),
    next,
  };
}

function unhealthyReason(report: HealthReport, gates: { syncOk: boolean; versionsCount: boolean }): string {
  const reasons = report.services
    .filter((s) => !s.optional && s.status !== "OK")
    .map((s) => `${s.service} unreachable`);
  if (!gates.syncOk) {
    reasons.push(describeLag(report.sync.delta, report.sync.threshold));
  }
  if (gates.versionsCount) {
    reasons.push(...report.versions.checks.filter((c) => !c.ok).map((c) => `${c.label} mismatch`));
  }
  return `Unhealthy: ${reasons.join(", ") || "see the report"}`;
}
