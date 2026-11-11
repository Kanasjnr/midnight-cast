// Checks each bundled ledger error map against the node source at the release the
// networks on its ledger run, or the release it names when none does, and against a
// pinned copy of Midnight Expert's status-codes catalog.
//
//   tsx scripts/error-code-parity.ts
//
// Exit 0 when the map matches the node, 1 on drift or a name conflict, 2 on error.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { SupportMatrixFile } from "../src/lib/versions.js";
import { ERROR_MAP_FILES, lastPart } from "../src/lib/error-maps.js";
import { ledgerMajor } from "../src/lib/network-names.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const NODE_RAW = "https://raw.githubusercontent.com/midnightntwrk/midnight-node";
// The LedgerApiError -> u8 table moved into per-ledger modules after node 1.0.300.
function codeTablePaths(ledger: string): string[] {
  return ["ledger/src/versions/common/types.rs", `ledger/src/ledger_${ledger.split(".")[0]}/types.rs`];
}

// The map is checked against the node release of the networks on its own ledger, falling back to mainnet's.
// Networks on another ledger during a rollout are noted, not failed.
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

// The node prefixes the (de)serialization variants, and its enums qualify the Ledger 9 ones, which the map names
// as Midnight's docs do (ZswapInvalid::NullifierAlreadyPresent); either way the last part is compared.
function sameName(ours: string, node: string): boolean {
  const name = lastPart(ours);
  return node === name || node === `Deserialization${name}` || node === `Serialization${name}`;
}

export function compare(
  ours: Record<string, { name: string; nodeName?: string }>,
  node: CodeTable,
  expert: ExpertEntry[],
  nodeTag: string,
): ParityReport {
  // nodeName is the node's own name where the map shows a clearer one, as for the catch-all Unknown variants.
  const ourCodes = new Map(Object.entries(ours).map(([code, entry]) => [Number(code), entry.nodeName ?? entry.name]));
  const shown = new Map(Object.entries(ours).map(([code, entry]) => [Number(code), entry.name]));
  // Midnight Expert qualifies the same names with dots (Zswap.Invalid.NullifierAlreadyPresent), which lastPart reads too.
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
      .filter((e) => shown.has(Number(e.code)) && lastPart(shown.get(Number(e.code))!) !== lastPart(e.name))
      .map((e) => ({ code: Number(e.code), ours: shown.get(Number(e.code))!, expert: e.name })),
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

export function deployedNodeReleases(
  matrix: SupportMatrixFile,
  mapLedger?: string,
  mapNodeTag?: string,
): { reference: NodeRelease; others: NodeRelease[] } {
  const byTag = new Map<string, NodeRelease>();
  for (const [network, row] of Object.entries(matrix.networks)) {
    const tag = `node-${row.minNode ?? row.node}`;
    const release = byTag.get(tag) ?? { tag, ledger: row.ledger, networks: [] };
    release.networks.push(network);
    byTag.set(tag, release);
  }
  const releases = [...byTag.values()];
  // A map covers its ledger's major, as decode reads it: the 9.1.0.0 map serves a network on 9.1.1.0 too.
  const onLedger = (r: NodeRelease) => mapLedger !== undefined && ledgerMajor(r.ledger) === ledgerMajor(mapLedger);
  const reference =
    // Among the releases on the map's ledger, mainnet's still comes first.
    releases.find((r) => onLedger(r) && r.networks.includes(REFERENCE_NETWORK)) ??
    releases.find(onLedger) ??
    // A map for a ledger no network runs any more is checked against the release it was built from.
    (mapNodeTag && mapLedger ? { tag: mapNodeTag, ledger: mapLedger, networks: [] } : undefined) ??
    releases.find((r) => r.networks.includes(REFERENCE_NETWORK));
  if (!reference) throw new Error(`The support matrix has no ${REFERENCE_NETWORK} entry`);
  // Other releases on the same ledger are compared with it; one on another ledger has its own map.
  return { reference, others: releases.filter((r) => r !== reference && (mapLedger === undefined || onLedger(r))) };
}

/** Networks on a ledger none of the maps covers, such as a newer one: decode would read their codes with the wrong map. */
export function uncoveredReleases(matrix: SupportMatrixFile, mapLedgers: string[]): NodeRelease[] {
  const covered = new Set(mapLedgers.map(ledgerMajor));
  const { reference, others } = deployedNodeReleases(matrix);
  return [reference, ...others].filter((r) => !covered.has(ledgerMajor(r.ledger)));
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

/** undefined when the release publishes none of the files the table can live in, as before its source is public. */
async function fetchNodeTable(release: NodeRelease): Promise<CodeTable | undefined> {
  let fileWithoutTable: string | undefined;
  for (const path of codeTablePaths(release.ledger)) {
    const source = await fetchText(`${NODE_RAW}/${release.tag}/${path}`);
    if (source === undefined) continue;
    const table = parseCodeTable(source);
    if (table.size) return table;
    fileWithoutTable ??= `${release.tag}/${path}`;
  }
  if (fileWithoutTable) throw new Error(`${fileWithoutTable} has no ledger error table, nor does any later path; the parser needs updating`);
  return undefined;
}


async function checkMap(file: string, matrix: SupportMatrixFile, expert: ExpertEntry[]): Promise<boolean> {
  const map = JSON.parse(readFileSync(join(root, "src", "data", file), "utf8")) as {
    ledger: string;
    nodeTag?: string | null;
    codes: Record<string, { name: string; nodeName?: string }>;
  };
  const { reference, others } = deployedNodeReleases(matrix, map.ledger, map.nodeTag ?? undefined);
  const [node, ...otherTables] = await Promise.all([
    fetchNodeTable(reference).then((table) => {
      if (!table) throw new Error(`No ledger error table found in midnight-node ${reference.tag}`);
      return table;
    }),
    // A release that isn't public yet can't be compared, but it doesn't make the map wrong.
    ...others.map(fetchNodeTable),
  ]);
  const report = compare(map.codes, node, expert, reference.tag);
  console.log(`${file} (ledger ${map.ledger}${reference.networks.length ? `, ${reference.networks.join(", ")}` : ", which no network runs now"}):`);
  console.log(formatReport(report));
  others.forEach((release, i) => {
    const table = otherTables[i];
    if (!table) {
      console.log(`Note: ${release.networks.join(", ")} run ${release.tag}, which isn't published with a code table, so it wasn't compared.`);
      return;
    }
    const { added, removed } = tableDifference(node, table);
    const change = added.length || removed.length ? `adds ${added.join(", ") || "none"}, removes ${removed.join(", ") || "none"}` : "same codes";
    console.log(`Note: ${release.networks.join(", ")} run ${release.tag} (${change}); the map follows ${reference.tag}.`);
  });
  return hasDrift(report);
}

async function main(): Promise<number> {
  const matrix = JSON.parse(readFileSync(join(root, "src/data/support-matrix.json"), "utf8")) as SupportMatrixFile;
  const expertText = await fetchText(MIDNIGHT_EXPERT_CODES);
  if (!expertText) throw new Error("Midnight Expert catalog not found at the pinned ref");
  const expert = (JSON.parse(expertText) as { entries: ExpertEntry[] }).entries;
  let drift = false;
  const ledgers: string[] = [];
  for (const [i, file] of ERROR_MAP_FILES.entries()) {
    if (i > 0) console.log("");
    ledgers.push((JSON.parse(readFileSync(join(root, "src", "data", file), "utf8")) as { ledger: string }).ledger);
    drift = (await checkMap(file, matrix, expert)) || drift;
  }
  for (const release of uncoveredReleases(matrix, ledgers)) {
    console.log(`\n${release.networks.join(", ")} run ${release.tag} on ledger ${release.ledger}, which no bundled error map covers: add one.`);
    drift = true;
  }
  return drift ? 1 : 0;
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
