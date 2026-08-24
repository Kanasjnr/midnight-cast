import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { getLatestBlockHeight } from "../clients/indexer.js";
import { fetchProofServerVersion } from "../clients/proof-server.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { computeDelta, tipExitCode } from "../lib/delta.js";
import {
  buildVersionChecks,
  fetchLiveVersions,
  isMatrixStale,
  loadSupportMatrix,
  matrixStalenessWarning,
} from "../lib/versions.js";
import { runServiceChecks } from "./ping.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

export interface HealthReport {
  network: string;
  healthy: boolean;
  services: Array<{
    service: string;
    status: string;
    latencyMs: number;
    optional?: boolean;
    detail?: string;
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
    `  Matrix updated:  ${report.versions.matrixUpdated}${report.versions.matrixStale ? " (stale)" : ""}`,
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
  },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  const threshold = flags.threshold ?? 100;
  const matrix = loadSupportMatrix();
  const expected = matrix.networks[endpoints.network];

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
    return fail(err instanceof Error ? err.message : "RPC unreachable");
  }

  try {
    indexerHeight = await getLatestBlockHeight(endpoints.indexerHttp);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Indexer unreachable");
  }

  const delta = computeDelta(rpcHeight, indexerHeight);
  const inSync = Math.abs(delta) < threshold;
  syncOk = tipExitCode(delta, threshold, flags.failOnLag) === 0;

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

  if (options.json) {
    return { ok: healthy, data: report, exitCode };
  }

  return { ok: healthy, data: formatHealthHuman(report), exitCode };
}
