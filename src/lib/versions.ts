import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath } from "../config.js";
import { jsonRpc } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import { loadDataJson } from "./data-path.js";
import { sanitizeForOutput } from "./sanitize.js";
import { isBlockfrostUrl } from "./blockfrost.js";

export interface MatrixNetwork {
  /** Recommended node release for running your own node. */
  node: string;
  /**
   * Oldest node that can follow this network. When set, the live check is
   * "at least minNode" rather than an exact match: operators (Midnight,
   * Blockfrost, self-hosted) run different builds of a compatible node.
   */
  minNode?: string;
  /** Runtime spec_version the network runs; checked exactly when set. */
  runtimeSpec?: number;
  ledger: string;
  indexer: string;
  indexerApi: string;
  proofServer: string;
  onChainRuntime: string;
  packages?: Record<string, string>;
}

export interface SupportMatrixFile {
  docUrl: string;
  updated: string;
  networks: Record<string, MatrixNetwork>;
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
  matrixStale: boolean;
  matrixWarning?: string;
  networkWarning?: string;
  docUrl: string;
  expected: MatrixNetwork;
  live: LiveVersions;
  checks: VersionCheck[];
  localPackages?: Record<string, string>;
  localPackageChecks?: VersionCheck[];
  allOk: boolean;
}

const MATRIX_STALE_DAYS = 45;

export function parseMatrixUpdated(updated: string): Date | null {
  const trimmed = updated.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [year, month] = trimmed.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, 1));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00Z`);
  }
  return null;
}

export function isMatrixStale(
  updated: string,
  maxAgeDays = MATRIX_STALE_DAYS,
  now: number = Date.now(),
): boolean {
  const parsed = parseMatrixUpdated(updated);
  if (!parsed) return false;
  const ageMs = now - parsed.getTime();
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

export function matrixStalenessWarning(
  updated: string,
  docUrl: string,
): string | undefined {
  if (!isMatrixStale(updated)) return undefined;
  return (
    `Bundled support matrix is stale (updated ${updated}). ` +
    `Live network versions may differ — refresh from ${docUrl} ` +
    `or run: npm i -g midnight-cast@latest`
  );
}

export function loadSupportMatrix(): SupportMatrixFile {
  const override = join(dirname(configPath()), "support-matrix.json");
  if (existsSync(override)) {
    return JSON.parse(readFileSync(override, "utf8")) as SupportMatrixFile;
  }
  return loadDataJson<SupportMatrixFile>("support-matrix.json");
}

export function parseNodeVersion(systemVersion: string): string {
  const clean = sanitizeForOutput(systemVersion);
  return clean.split("-")[0] ?? clean;
}

export function versionMatches(expected: string, live: string): boolean {
  return live === expected || live.startsWith(`${expected}-`);
}

/** Compare dotted numeric versions, ignoring any "-suffix". */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.split("-")[0] ?? v).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether a live node version satisfies the matrix row for its network. */
export function nodeSatisfies(expected: MatrixNetwork, liveNodeVersion: string): boolean {
  return expected.minNode
    ? compareVersions(liveNodeVersion, expected.minNode) >= 0
    : versionMatches(expected.node, liveNodeVersion);
}

export function detectIndexerApi(indexerHttp: string): string {
  // Blockfrost serves the same v4 indexer API under /api/v0.
  if (isBlockfrostUrl(indexerHttp) && /\/api\/v0(\/|\?|$)/.test(indexerHttp)) return "v4";
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
  liveProofServer?: string,
): VersionCheck[] {
  const checks: VersionCheck[] = [
    {
      label: "node",
      expected: expected.minNode ? `>=${expected.minNode}` : expected.node,
      live: live.nodeVersion,
      ok: nodeSatisfies(expected, live.nodeVersion),
      ...(expected.minNode ? { note: `recommended ${expected.node}` } : {}),
    },
    ...(expected.runtimeSpec !== undefined
      ? [
          {
            label: "runtimeSpec",
            expected: String(expected.runtimeSpec),
            live: String(live.runtimeSpecVersion),
            ok: live.runtimeSpecVersion === expected.runtimeSpec,
            note: "node runtime spec_version vs matrix",
          },
        ]
      : []),
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

  if (liveProofServer !== undefined) {
    checks.push({
      label: "proof-server",
      expected: expected.proofServer,
      live: liveProofServer,
      ok: versionMatches(expected.proofServer, liveProofServer),
      note: "GET /version on configured proof server URL",
    });
  }

  return checks;
}

export function buildNetworkMismatchWarning(
  selectedNetwork: string,
  matrix: SupportMatrixFile,
  liveNodeVersion: string,
  liveRuntimeSpec?: number,
): string | undefined {
  const expected = matrix.networks[selectedNetwork];
  if (!expected) return undefined;
  const fits = (row: MatrixNetwork) =>
    nodeSatisfies(row, liveNodeVersion) &&
    (liveRuntimeSpec === undefined || row.runtimeSpec === undefined || row.runtimeSpec === liveRuntimeSpec);
  if (fits(expected)) return undefined;

  const wanted = expected.minNode ? `>=${expected.minNode}` : expected.node;
  const live =
    liveRuntimeSpec !== undefined && expected.runtimeSpec !== undefined
      ? `Live node ${liveNodeVersion} (runtime spec ${liveRuntimeSpec})`
      : `Live node ${liveNodeVersion}`;
  const want =
    expected.runtimeSpec !== undefined && liveRuntimeSpec !== undefined
      ? `expected node ${wanted}, runtime spec ${expected.runtimeSpec}`
      : `expected ${wanted}`;

  const otherMatches = Object.entries(matrix.networks)
    .filter(([name, row]) => name !== selectedNetwork && fits(row))
    .map(([name]) => name);

  if (otherMatches.length > 0) {
    return (
      `${live} does not match "${selectedNetwork}" matrix ` +
      `(${want}). Endpoints may point to ${otherMatches.join(" or ")}.`
    );
  }

  return (
    `${live} does not match "${selectedNetwork}" matrix ` +
    `(${want}). Check --network and endpoint URLs.`
  );
}

export function normalizePackageVersion(spec: string): string {
  return spec.replace(/^[\^~>=<]+/, "").split("-")[0] ?? spec;
}

export function buildLocalPackageChecks(
  expected: MatrixNetwork,
  localPackages: Record<string, string>,
): VersionCheck[] {
  const pins = expected.packages ?? {};
  const checks: VersionCheck[] = [];

  for (const [name, expectedVersion] of Object.entries(pins)) {
    const liveSpec = localPackages[name];
    if (!liveSpec) continue;
    const live = normalizePackageVersion(liveSpec);
    checks.push({
      label: `pkg:${name}`,
      expected: expectedVersion,
      live,
      ok: versionMatches(expectedVersion, live),
    });
  }

  for (const [name, liveSpec] of Object.entries(localPackages)) {
    if (pins[name]) continue;
    checks.push({
      label: `pkg:${name}`,
      expected: "(no matrix pin)",
      live: normalizePackageVersion(liveSpec),
      ok: true,
      note: "listed only",
    });
  }

  return checks.sort((a, b) => a.label.localeCompare(b.label));
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
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const found: Record<string, string> = {};
    for (const [name, version] of Object.entries(all)) {
      if (name.startsWith("@midnight-ntwrk/")) {
        found[name] = version;
      }
    }
    return Object.keys(found).length > 0
      ? Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)))
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatVersionsHuman(report: VersionsReport): string {
  const lines = [
    `Network:  ${report.network}`,
    `Matrix:   ${report.docUrl} (updated ${report.matrixUpdated})`,
  ];

  if (report.matrixWarning) {
    lines.push(`Warning:  ${report.matrixWarning}`);
  }

  if (report.networkWarning) {
    lines.push(`Warning:  ${report.networkWarning}`);
  }

  lines.push(
    "",
    "Expected (support matrix — reference):",
    report.expected.minNode
      ? `  node:             >=${report.expected.minNode} (recommended ${report.expected.node})  [auto-checked]`
      : `  node:             ${report.expected.node}  [auto-checked]`,
    ...(report.expected.runtimeSpec !== undefined
      ? [`  runtime spec:     ${report.expected.runtimeSpec}  [auto-checked]`]
      : []),
    `  ledger:           ${report.expected.ledger}  [reference]`,
    `  indexer:          ${report.expected.indexer}  [reference]`,
    `  indexer-api:      ${report.expected.indexerApi}  [auto-checked]`,
    `  proof-server:     ${report.expected.proofServer}  [auto-checked when URL configured]`,
    `  on-chain runtime: ${report.expected.onChainRuntime}  [reference]`,
    "",
    "Live:",
    `  node:             ${report.live.nodeVersion} (system_version)`,
    `  runtime spec:     ${report.live.runtimeSpecVersion}`,
    `  indexer-api:      ${report.live.indexerApi}`,
    `  indexer protocol: ${report.live.indexerProtocolVersion}`,
    "",
    "Checks:",
  );

  for (const check of report.checks) {
    const mark = check.ok ? "OK" : "MISMATCH";
    const note = check.note ? ` (${check.note})` : "";
    lines.push(
      `  ${check.label}: expected=${check.expected} live=${check.live} → ${mark}${note}`,
    );
  }

  if (report.localPackageChecks?.length) {
    lines.push("", "Local package checks (@midnight-ntwrk vs matrix):");
    for (const check of report.localPackageChecks) {
      const mark = check.ok ? "OK" : "MISMATCH";
      const note = check.note ? ` (${check.note})` : "";
      lines.push(
        `  ${check.label}: expected=${check.expected} live=${check.live} → ${mark}${note}`,
      );
    }
  } else if (report.localPackages) {
    lines.push("", "Local package.json (@midnight-ntwrk):");
    for (const [name, version] of Object.entries(report.localPackages)) {
      lines.push(`  ${name}: ${version}`);
    }
    lines.push(
      "",
      "No matrix package pins for this network — compare manually to:",
      `  ledger: ${report.expected.ledger}`,
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
