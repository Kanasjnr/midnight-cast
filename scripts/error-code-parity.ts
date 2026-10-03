// Checks the bundled ledger error map against the node source at the release the
// networks run, and against a pinned copy of Midnight Expert's status-codes catalog.
//
//   tsx scripts/error-code-parity.ts
//
// Exit 0 when the map matches the node, 1 on drift or a name conflict, 2 on error.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupportMatrixFile } from "../src/lib/versions.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_RAW = "https://raw.githubusercontent.com/midnightntwrk/midnight-node";
// The LedgerApiError -> u8 table moved into per-ledger modules after node 1.0.300.
function codeTablePaths(ledger: string): string[] {
  return ["ledger/src/versions/common/types.rs", `ledger/src/ledger_${ledger.split(".")[0]}/types.rs`];
}

// The map serves every network, so it follows mainnet; a network ahead of it during a rollout is noted.
const REFERENCE_NETWORK = "mainnet";

export const MIDNIGHT_EXPERT_REF = "caabc67ee232cb2ea44d293fbee4f12acd08a0f0";
const MIDNIGHT_EXPERT_CODES =
  `https://raw.githubusercontent.com/midnightntwrk/midnight-expert/${MIDNIGHT_EXPERT_REF}` +
  "/plugins/midnight-status-codes/skills/status-codes-lookup/scripts/codes.json";

export type CodeTable = Map<number, string[]>;

export interface ExpertEntry {
  code: string;
  name: string;
  source: string;
  description: string;
}

export interface ParityReport {
  nodeTag: string;
  missing: Array<{ code: number; names: string[] }>;
  extra: Array<{ code: number; name: string }>;
  renamed: Array<{ code: number; ours: string; node: string[] }>;
  expertConflicts: Array<{ code: number; ours: string; expert: string }>;
  expertRetiredButLive: number[];
  expertNotDeployed: number[];
}

export function parseCodeTable(source: string): CodeTable {
  const table: CodeTable = new Map();
  for (const match of source.matchAll(/(\w+)(?:\([^)]*\)|\s*\{[^}]*\})?\s*=>\s*(\d+),/g)) {
    const code = Number(match[2]);
    table.set(code, [...(table.get(code) ?? []), match[1]!]);
  }
  return table;
}

export function requireCodeTable(source: string, where: string): CodeTable {
  const table = parseCodeTable(source);
  if (table.size === 0) throw new Error(`${where} has no ledger error table; the parser needs updating`);
  return table;
}

// The node prefixes the (de)serialization variants; the map keeps the type name.
function sameName(ours: string, node: string): boolean {
  return node === ours || node === `Deserialization${ours}` || node === `Serialization${ours}`;
}

export function compare(
  ours: Record<string, { name: string }>,
  node: CodeTable,
  expert: ExpertEntry[],
  nodeTag: string,
): ParityReport {
  const ourCodes = new Map(Object.entries(ours).map(([code, entry]) => [Number(code), entry.name]));
  const ledgerEntries = expert.filter(
    (e) => e.source === "midnight-node" && /^\d{1,3}$/.test(e.code) && Number(e.code) <= 255,
  );

  return {
    nodeTag,
    missing: [...node].filter(([code]) => !ourCodes.has(code)).map(([code, names]) => ({ code, names })),
    extra: [...ourCodes].filter(([code]) => !node.has(code)).map(([code, name]) => ({ code, name })),
    renamed: [...ourCodes]
      .filter(([code, name]) => node.has(code) && !node.get(code)!.some((n) => sameName(name, n)))
      .map(([code, name]) => ({ code, ours: name, node: node.get(code)! })),
    expertConflicts: ledgerEntries
      .filter((e) => ourCodes.has(Number(e.code)) && ourCodes.get(Number(e.code)) !== e.name)
      .map((e) => ({ code: Number(e.code), ours: ourCodes.get(Number(e.code))!, expert: e.name })),
    expertRetiredButLive: ledgerEntries
      .filter((e) => e.description.startsWith("[RETIRED") && node.has(Number(e.code)))
      .map((e) => Number(e.code))
      .sort((a, b) => a - b),
    expertNotDeployed: ledgerEntries.filter((e) => !node.has(Number(e.code))).map((e) => Number(e.code)),
  };
}

export function hasDrift(report: ParityReport): boolean {
  return (
    report.missing.length + report.extra.length + report.renamed.length + report.expertConflicts.length > 0
  );
}

export function formatReport(report: ParityReport): string {
  const lines = [`Ledger error map vs midnight-node ${report.nodeTag}`];
  const list = (label: string, items: string[]) => {
    if (items.length) lines.push(`${label}:`, ...items.map((item) => `  ${item}`));
  };
  list("Missing from the map", report.missing.map((m) => `${m.code} ${m.names.join(" / ")}`));
  list("In the map but not in the node", report.extra.map((e) => `${e.code} ${e.name}`));
  list("Named differently", report.renamed.map((r) => `${r.code} ours ${r.ours}, node ${r.node.join(" / ")}`));
  list("Midnight Expert names differ", report.expertConflicts.map((c) => `${c.code} ours ${c.ours}, theirs ${c.expert}`));
  if (!hasDrift(report)) lines.push("The map matches the node, and Midnight Expert's names agree.");
  if (report.expertRetiredButLive.length) {
    lines.push(
      `Note: Midnight Expert marks ${report.expertRetiredButLive.join(", ")} as retired, but ${report.nodeTag} still emits them (midnightntwrk/midnight-expert#272).`,
    );
  }
  if (report.expertNotDeployed.length) {
    lines.push(`Note: Midnight Expert lists ${report.expertNotDeployed.length} codes that ${report.nodeTag} doesn't emit yet.`);
  }
  return lines.join("\n");
}

export interface NodeRelease {
  tag: string;
  ledger: string;
  networks: string[];
}

export function deployedNodeReleases(matrix: SupportMatrixFile): { reference: NodeRelease; others: NodeRelease[] } {
  const byTag = new Map<string, NodeRelease>();
  for (const [network, row] of Object.entries(matrix.networks)) {
    const tag = `node-${row.minNode ?? row.node}`;
    const release = byTag.get(tag) ?? { tag, ledger: row.ledger, networks: [] };
    release.networks.push(network);
    byTag.set(tag, release);
  }
  const reference = [...byTag.values()].find((r) => r.networks.includes(REFERENCE_NETWORK));
  if (!reference) throw new Error(`The support matrix has no ${REFERENCE_NETWORK} entry`);
  return { reference, others: [...byTag.values()].filter((r) => r !== reference) };
}

export function tableDifference(reference: CodeTable, other: CodeTable): { added: number[]; removed: number[] } {
  return {
    added: [...other.keys()].filter((code) => !reference.has(code)).sort((a, b) => a - b),
    removed: [...reference.keys()].filter((code) => !other.has(code)).sort((a, b) => a - b),
  };
}

async function fetchText(url: string, attempts = 3): Promise<string | undefined> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return undefined;
      if (response.ok) return await response.text();
      if (response.status < 500 || attempt === attempts) throw new Error(`${url}: HTTP ${response.status}`);
    } catch (err) {
      if (attempt === attempts) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
}

async function fetchNodeTable(release: NodeRelease): Promise<CodeTable> {
  for (const path of codeTablePaths(release.ledger)) {
    const source = await fetchText(`${NODE_RAW}/${release.tag}/${path}`);
    if (source === undefined) continue;
    return requireCodeTable(source, `${release.tag}/${path}`);
  }
  throw new Error(`No ledger error table found in midnight-node ${release.tag}`);
}

async function main(): Promise<number> {
  const matrix = JSON.parse(readFileSync(join(root, "src/data/support-matrix.json"), "utf8")) as SupportMatrixFile;
  const ours = JSON.parse(readFileSync(join(root, "src/data/error-codes.json"), "utf8")).codes;
  const { reference, others } = deployedNodeReleases(matrix);
  const [node, expertText, ...otherTables] = await Promise.all([
    fetchNodeTable(reference),
    fetchText(MIDNIGHT_EXPERT_CODES),
    ...others.map(fetchNodeTable),
  ]);
  if (!expertText) throw new Error("Midnight Expert catalog not found at the pinned ref");
  const report = compare(ours, node, JSON.parse(expertText).entries, reference.tag);
  console.log(formatReport(report));
  others.forEach((release, i) => {
    const { added, removed } = tableDifference(node, otherTables[i]!);
    const change = added.length || removed.length ? `adds ${added.join(", ") || "none"}, removes ${removed.join(", ") || "none"}` : "same codes";
    console.log(`Note: ${release.networks.join(", ")} run ${release.tag} (${change}); the map follows ${reference.tag}.`);
  });
  return hasDrift(report) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (err: unknown) => {
      console.error(`Incomplete, re-run the check: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
    },
  );
}
