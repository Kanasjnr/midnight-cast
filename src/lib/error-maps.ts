// The ledger error maps decode reads, one per ledger: Custom(N) codes change between node releases, so a code is
// read with the map for the ledger the network runs. The newest map comes first.

import { loadDataJson } from "./data-path.js";
import { ledgerMajor } from "./network-names.js";
import { loadSupportMatrix } from "./versions.js";

export interface ErrorCodeEntry {
  name: string;
  description: string;
  fix: string;
  /** The node's own name, where the map shows a clearer one, such as for a catch-all Unknown variant. */
  nodeName?: string;
}

export interface ErrorCodesFile {
  docUrl: string;
  ledger: string;
  /** The node release the map follows. */
  nodeTag?: string | null;
  updated?: string;
  source?: string;
  /** Codes the ledger before this one used that this one doesn't, and the codes that replace each. */
  retired?: Record<string, { name: string; replacedBy: number[] }>;
  codes: Record<string, ErrorCodeEntry>;
}

const FILES = ["error-codes-ledger-9.json", "error-codes.json"];

let cached: ErrorCodesFile[] | undefined;
export const ledgerMaps = (): ErrorCodesFile[] => (cached ??= FILES.map((file) => loadDataJson<ErrorCodesFile>(file)));

/** The map for the network's ledger. Without a network, or for one whose ledger has no map, the newest. */
export function ledgerMapFor(network?: string): ErrorCodesFile {
  const maps = ledgerMaps();
  const major = network ? ledgerMajor(loadSupportMatrix().networks[network]?.ledger) : undefined;
  return maps.find((map) => major !== undefined && ledgerMajor(map.ledger) === major) ?? maps[0]!;
}

/** Whether the network runs a ledger none of the maps covers, such as a newer one. */
export function noMapForNetwork(network: string): boolean {
  const major = ledgerMajor(loadSupportMatrix().networks[network]?.ledger);
  return major !== undefined && !ledgerMaps().some((map) => ledgerMajor(map.ledger) === major);
}

const lastPart = (name: string) => name.split("::").at(-1)!;

/**
 * One name per code to look for in free text: the last part of a qualified name, as errors print it
 * (NullifierAlreadyPresent), when no other code shares it, and the whole name otherwise.
 */
export function matchableNames(map: ErrorCodesFile): Record<string, string> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(map.codes)) counts.set(lastPart(entry.name), (counts.get(lastPart(entry.name)) ?? 0) + 1);
  return Object.fromEntries(
    Object.entries(map.codes).map(([code, entry]) => [code, counts.get(lastPart(entry.name)) === 1 ? lastPart(entry.name) : entry.name]),
  );
}

/** The code with this name: the whole name, or its last part when only one code has it. */
export function findLedgerByName(name: string, map: ErrorCodesFile): string | null {
  const wanted = name.replace(/\s+/g, "").toLowerCase();
  const exact = Object.entries(map.codes).find(([, entry]) => entry.name.toLowerCase() === wanted);
  if (exact) return exact[0];
  const byLast = Object.entries(map.codes).filter(([, entry]) => lastPart(entry.name).toLowerCase() === wanted);
  return byLast.length === 1 ? byLast[0]![0] : null;
}
