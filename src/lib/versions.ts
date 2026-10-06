import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { configPath } from "../config.js";
import { jsonRpc } from "../clients/rpc.js";
import { gqlPost } from "../clients/indexer.js";
import { loadDataJson } from "./data-path.js";
import { sanitizeForOutput } from "./sanitize.js";
import { isBlockfrostUrl } from "./blockfrost.js";
import { NEW_SCOPE, OLD_SCOPE, isMidnightPackage, loadMigratedPackages, packageBaseName } from "./npm-scope.js";
import { describeMatrixSource, type MatrixSource } from "./upstream-matrix.js";
import { describeExamples, type ExamplesVerdict } from "./examples-report.js";

export interface MatrixNetwork {
  /** Recommended node release for running your own node. */
  node: string;
  /**
   * Oldest node that can follow this network. When set, the live check is
   * "at least minNode" rather than an exact match: operators (Midnight,
   * Blockfrost, self-hosted) run different builds of a compatible node.
   */
  minNode?: string;
  /** Why an older node falls short, shown when one does. */
  minNodeReason?: string;
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
  matrixSource?: MatrixSource;
  /** Inconsistencies inside Midnight's published matrix, such as tag vs containerTag. */
  matrixNotes?: string[];
  networkWarning?: string;
  docUrl: string;
  expected: MatrixNetwork;
  live: LiveVersions;
  checks: VersionCheck[];
  localPackages?: Record<string, string>;
  localPackageChecks?: VersionCheck[];
  /** Where local packages were looked for, and whether a package.json was there. */
  localProject?: { dir: string; packageJson: boolean };
  scopeHints?: string[];
  /** Whether Midnight's examples pass on the node this network runs. */
  examples?: ExamplesVerdict;
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
      ...(expected.minNode
        ? {
            note:
              !nodeSatisfies(expected, live.nodeVersion) && expected.minNodeReason
                ? `below ${expected.minNode}: ${expected.minNodeReason}`
                : `recommended ${expected.node}`,
          }
        : {}),
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

export function buildLocalPackageChecks(
  expected: MatrixNetwork,
  localPackages: Record<string, string>,
): VersionCheck[] {
  const pinsByBase = new Map(
    Object.entries(expected.packages ?? {}).map(([name, version]) => [packageBaseName(name) ?? name, version]),
  );
  const checks: VersionCheck[] = [];

  for (const [name, liveSpec] of Object.entries(localPackages)) {
    const pin = pinsByBase.get(packageBaseName(name) ?? name);
    const exact = liveSpec.trim().replace(/^[=v]/, "");
    const resolved = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(exact);
    checks.push(
      !resolved
        ? { label: `pkg:${name}`, expected: pin ?? "(no matrix pin)", live: liveSpec, ok: true, note: "version not resolved: no npm lockfile entry" }
        : pin
          ? { label: `pkg:${name}`, expected: pin, live: exact, ok: exact === pin }
          : { label: `pkg:${name}`, expected: "(no matrix pin)", live: exact, ok: true, note: "listed only" },
    );
  }

  return checks.sort((a, b) => a.label.localeCompare(b.label));
}

export interface InstalledPackage {
  name: string;
  version: string;
  path: string;
}

export function readInstalledMidnightPackages(cwd = process.cwd()): InstalledPackage[] {
  const path = join(cwd, "package-lock.json");
  if (!existsSync(path)) return [];
  try {
    const lock = JSON.parse(readFileSync(path, "utf8")) as {
      packages?: Record<string, { name?: string; version?: string }>;
    };
    const installed: InstalledPackage[] = [];
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      const folder = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(key)?.[1];
      if (!folder) continue;
      // npm records the real package in `name` when the folder is an alias.
      const name = entry.name ?? folder;
      if (name && entry.version && isMidnightPackage(name)) {
        installed.push({ name, version: entry.version, path: key });
      }
    }
    return installed;
  } catch {
    return [];
  }
}

export function readLocalMidnightPackages(
  cwd = process.cwd(),
  installed: InstalledPackage[] = readInstalledMidnightPackages(cwd),
): Record<string, string> | undefined {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return undefined;

  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const installedAt = new Map(installed.map((p) => [p.path, p.version]));
    const found: Record<string, string> = {};
    for (const [declared, spec] of Object.entries(all)) {
      const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@(.+))?$/.exec(spec);
      const name = alias ? alias[1]! : declared;
      if (!isMidnightPackage(name)) continue;
      found[name] = installedAt.get(`node_modules/${declared}`) ?? alias?.[2] ?? spec;
    }
    return Object.keys(found).length > 0
      ? Object.fromEntries(Object.entries(found).sort(([a], [b]) => a.localeCompare(b)))
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildScopeConflictChecks(
  declared: Record<string, string>,
  installed: InstalledPackage[],
): VersionCheck[] {
  const scopesByBase = new Map<string, Set<string>>();
  for (const name of [...Object.keys(declared), ...installed.map((p) => p.name)]) {
    const base = packageBaseName(name);
    if (!base) continue;
    const scope = name.startsWith(NEW_SCOPE) ? NEW_SCOPE : OLD_SCOPE;
    scopesByBase.set(base, (scopesByBase.get(base) ?? new Set()).add(scope));
  }
  const crossScope = [...scopesByBase]
    .filter(([, scopes]) => scopes.size > 1)
    .map(([base]) => ({
      label: `scope:${base}`,
      expected: "one npm scope",
      live: `${OLD_SCOPE}${base} and ${NEW_SCOPE}${base}`,
      ok: false,
      note: "two copies of the same package can break instanceof checks and types; depend on one scope only",
    }));

  const topLevelFolders = new Map<string, string[]>();
  for (const p of installed.filter((p) => /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(p.path))) {
    topLevelFolders.set(p.name, [...(topLevelFolders.get(p.name) ?? []), p.path]);
  }
  const declaredTwice = [...topLevelFolders]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({
      label: `twice:${name}`,
      expected: "one copy",
      live: paths.join(", "),
      ok: false,
      note: "the same package is installed under two names (an npm: alias and a direct dependency); keep one",
    }));

  return [...crossScope, ...declaredTwice].sort((a, b) => a.label.localeCompare(b.label));
}

export function readDeclaredDuplicates(cwd = process.cwd()): VersionCheck[] {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) return [];
  try {
    const pkg = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declaredAs = new Map<string, string[]>();
    for (const [declared, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      const name = /^npm:((?:@[^/]+\/)?[^@]+)/.exec(spec)?.[1] ?? declared;
      if (isMidnightPackage(name)) declaredAs.set(name, [...(declaredAs.get(name) ?? []), declared]);
    }
    return [...declaredAs]
      .filter(([, names]) => names.length > 1)
      .map(([name, names]) => ({
        label: `twice:${name}`,
        expected: "one copy",
        live: names.join(", "),
        ok: false,
        note: "the same package is installed under two names (an npm: alias and a direct dependency); keep one",
      }));
  } catch {
    return [];
  }
}

export function checkLocalPackages(
  expected: MatrixNetwork,
  cwd = process.cwd(),
): Pick<VersionsReport, "localPackages" | "localPackageChecks" | "scopeHints" | "localProject"> {
  const localProject = { dir: cwd, packageJson: existsSync(join(cwd, "package.json")) };
  if (!localProject.packageJson) return { localProject };
  const installed = readInstalledMidnightPackages(cwd);
  const localPackages = readLocalMidnightPackages(cwd, installed);
  const conflicts = buildScopeConflictChecks(localPackages ?? {}, installed);
  const conflictLabels = new Set(conflicts.map((c) => c.label));
  const checks = [
    ...(localPackages ? buildLocalPackageChecks(expected, localPackages) : []),
    ...conflicts,
    ...readDeclaredDuplicates(cwd).filter((c) => !conflictLabels.has(c.label)),
  ];
  const scopeHints = localPackages ? buildScopeHints(localPackages) : [];
  return {
    localProject,
    ...(localPackages ? { localPackages } : {}),
    ...(checks.length ? { localPackageChecks: checks } : {}),
    ...(scopeHints.length ? { scopeHints } : {}),
  };
}

export function buildScopeHints(
  declared: Record<string, string>,
  migrated: Set<string> = loadMigratedPackages(),
): string[] {
  return Object.keys(declared)
    .filter((name) => name.startsWith(OLD_SCOPE))
    .map((name) => name.slice(OLD_SCOPE.length))
    .filter((base) => migrated.has(base) && !(`${NEW_SCOPE}${base}` in declared))
    .map((base) => `${OLD_SCOPE}${base} is also published as ${NEW_SCOPE}${base} (rename only, same API)`);
}

export function formatVersionsHuman(report: VersionsReport): string {
  const lines = [
    `Network:  ${report.network}`,
    report.matrixSource
      ? `Matrix:   ${describeMatrixSource(report.matrixSource)}`
      : `Matrix:   ${report.docUrl} (updated ${report.matrixUpdated})`,
    ...(report.matrixNotes ?? []).map((note) => `Note:     published matrix: ${note}`),
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

  if (report.examples) lines.push("", ...describeExamples(report.examples));

  if (report.localPackageChecks?.length) {
    lines.push("", "Local package checks (Midnight packages vs matrix):");
    for (const check of report.localPackageChecks) {
      const mark = check.ok ? "OK" : "MISMATCH";
      const note = check.note ? ` (${check.note})` : "";
      lines.push(
        `  ${check.label}: expected=${check.expected} live=${check.live} → ${mark}${note}`,
      );
    }
  } else if (report.localPackages) {
    lines.push("", "Local package.json (Midnight packages):");
    for (const [name, version] of Object.entries(report.localPackages)) {
      lines.push(`  ${name}: ${version}`);
    }
    lines.push(
      "",
      "No matrix package pins for this network — compare manually to:",
      `  ledger: ${report.expected.ledger}`,
    );
  }

  if (report.localProject && !report.localProject.packageJson) {
    lines.push("", `Local packages: not checked, no package.json in ${report.localProject.dir}`);
  } else if (report.localProject && !report.localPackages) {
    lines.push("", `Local packages: no Midnight packages in ${join(report.localProject.dir, "package.json")}`);
  }

  if (report.scopeHints?.length) {
    lines.push("", "npm scope:");
    for (const hint of report.scopeHints) lines.push(`  ${hint}`);
  }

  lines.push(
    "",
    report.allOk
      ? "Summary: live stack matches matrix checks ✓"
      : "Summary: mismatch detected — see decode 179/180 and support matrix",
  );

  return lines.join("\n");
}
