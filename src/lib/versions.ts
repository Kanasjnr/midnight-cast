import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { jsonRpc } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import { loadDataJson } from "./data-path.js";

export interface MatrixNetwork {
  node: string;
  ledger: string;
  indexer: string;
  indexerApi: string;
  proofServer: string;
  onChainRuntime: string;
}

export interface SupportMatrixFile {
  docUrl: string;
  updated: string;
  networks: Record<string, MatrixNetwork>;
  localPackages?: string[];
}

export interface LiveVersions {
  nodeVersion: string;
  runtimeSpecVersion: number;
  runtimeImplVersion: number;
  indexerProtocolVersion: number;
  indexerApi: string;
}

export interface VersionCheck {
  label: string;
  expected: string;
  live: string;
  ok: boolean;
  note?: string;
}

export interface VersionsReport {
  network: string;
  matrixUpdated: string;
  docUrl: string;
  expected: MatrixNetwork;
  live: LiveVersions;
  checks: VersionCheck[];
  localPackages?: Record<string, string>;
  allOk: boolean;
}

export function loadSupportMatrix(): SupportMatrixFile {
  return loadDataJson<SupportMatrixFile>("support-matrix.json");
}

export function parseNodeVersion(systemVersion: string): string {
  return systemVersion.split("-")[0] ?? systemVersion;
}

export function versionMatches(expected: string, live: string): boolean {
  return live === expected || live.startsWith(`${expected}-`);
}

export function detectIndexerApi(indexerHttp: string): string {
  if (indexerHttp.includes("/api/v4/")) return "v4";
  if (indexerHttp.includes("/api/v3/")) return "v3";
  if (indexerHttp.includes("/api/v1/")) return "v1";
  return "unknown";
}

export async function fetchLiveVersions(
  rpcUrl: string,
  indexerHttp: string,
): Promise<LiveVersions> {
  const [runtime, systemVersion, blockData] = await Promise.all([
    jsonRpc<{
      specVersion: number;
      implVersion: number;
    }>(rpcUrl, "chain_getRuntimeVersion", []),
    jsonRpc<string>(rpcUrl, "system_version", []),
    gqlPost<{ block: { protocolVersion: number } }>(
      indexerHttp,
      `query { block { protocolVersion } }`,
    ),
  ]);

  return {
    nodeVersion: parseNodeVersion(systemVersion),
    runtimeSpecVersion: runtime.specVersion,
    runtimeImplVersion: runtime.implVersion,
    indexerProtocolVersion: blockData.block.protocolVersion,
    indexerApi: detectIndexerApi(indexerHttp),
  };
}

export function buildVersionChecks(
  expected: MatrixNetwork,
  live: LiveVersions,
): VersionCheck[] {
  const checks: VersionCheck[] = [
    {
      label: "node",
      expected: expected.node,
      live: live.nodeVersion,
      ok: versionMatches(expected.node, live.nodeVersion),
    },
    {
      label: "indexer-api",
      expected: expected.indexerApi,
      live: live.indexerApi,
      ok: live.indexerApi === expected.indexerApi,
      note: "from configured indexer URL path",
    },
    {
      label: "protocolVersion",
      expected: String(live.runtimeSpecVersion),
      live: String(live.indexerProtocolVersion),
      ok: live.runtimeSpecVersion === live.indexerProtocolVersion,
      note: "RPC specVersion vs indexer latest block",
    },
  ];

  return checks;
}

export function readLocalMidnightPackages(
  cwd = process.cwd(),
): Record<string, string> | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return undefined;

  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const matrix = loadSupportMatrix();
    const names = matrix.localPackages ?? [];
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const found: Record<string, string> = {};
    for (const name of names) {
      if (all[name]) found[name] = all[name]!;
    }
    return Object.keys(found).length > 0 ? found : undefined;
  } catch {
    return undefined;
  }
}

export function formatVersionsHuman(report: VersionsReport): string {
  const lines = [
    `Network:  ${report.network}`,
    `Matrix:   ${report.docUrl} (updated ${report.matrixUpdated})`,
    "",
    "Expected (support matrix):",
    `  node:           ${report.expected.node}`,
    `  ledger:         ${report.expected.ledger}`,
    `  indexer:        ${report.expected.indexer}`,
    `  indexer-api:    ${report.expected.indexerApi}`,
    `  proof-server:   ${report.expected.proofServer}`,
    `  on-chain runtime: ${report.expected.onChainRuntime}`,
    "",
    "Live:",
    `  node:             ${report.live.nodeVersion} (system_version)`,
    `  runtime spec:     ${report.live.runtimeSpecVersion}`,
    `  indexer-api:      ${report.live.indexerApi}`,
    `  indexer protocol: ${report.live.indexerProtocolVersion}`,
    "",
    "Checks:",
  ];

  for (const check of report.checks) {
    const mark = check.ok ? "OK" : "MISMATCH";
    const note = check.note ? ` (${check.note})` : "";
    lines.push(
      `  ${check.label}: expected=${check.expected} live=${check.live} → ${mark}${note}`,
    );
  }

  if (report.localPackages) {
    lines.push("", "Local package.json (@midnight-ntwrk):");
    for (const [name, version] of Object.entries(report.localPackages)) {
      lines.push(`  ${name}: ${version}`);
    }
    lines.push(
      "",
      "Compare local deps to matrix manually:",
      `  ledger target: ${report.expected.ledger}`,
    );
  }

  lines.push(
    "",
    report.allOk
      ? "Summary: live stack matches matrix checks ✓"
      : "Summary: mismatch detected — see decode 179/180 and support matrix",
  );

  return lines.join("\n");
}
