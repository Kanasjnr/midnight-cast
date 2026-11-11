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

/** The bundled maps, newest first. */
export const ERROR_MAP_FILES = ["error-codes-ledger-9.json", "error-codes.json"];

let cached: ErrorCodesFile[] | undefined;
export const ledgerMaps = (): ErrorCodesFile[] => (cached ??= ERROR_MAP_FILES.map((file) => loadDataJson<ErrorCodesFile>(file)));

/** The ledger major the network runs, by its matrix row, or undefined when the matrix doesn't say. */
const networkMajor = (network: string) => ledgerMajor(loadSupportMatrix().networks[network]?.ledger);

/** The map for the network's ledger. Without a network, or for one whose ledger has no map or isn't known, the newest. */
export function ledgerMapFor(network?: string): ErrorCodesFile {
  const maps = ledgerMaps();
  const major = network ? networkMajor(network) : undefined;
  return maps.find((map) => major !== undefined && ledgerMajor(map.ledger) === major) ?? maps[0]!;
}

/** Whether the matrix says which ledger the network runs; when it doesn't, decode reads the newest map and says so. */
export const knowsLedger = (network: string): boolean => networkMajor(network) !== undefined;

/** Whether the network runs a ledger none of the maps covers, such as a newer one. */
export function noMapForNetwork(network: string): boolean {
  const major = networkMajor(network);
  return major !== undefined && !ledgerMaps().some((map) => ledgerMajor(map.ledger) === major);
}

/** The last part of a qualified name: NullifierAlreadyPresent from ZswapInvalid::NullifierAlreadyPresent or Zswap.Invalid.NullifierAlreadyPresent. */
export const lastPart = (name: string): string => name.split(/::|\./).at(-1)!;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A pattern for the code's name in free text, as the node prints errors. A qualified name whose last part other
 * codes share needs its qualifier before it, as in ZswapInvalid(MerkleTreeError) or ZswapInvalid::MerkleTreeError;
 * one whose last part is its own is found bare. A catch-all, such as 145 FeeCalculation, matches only when no
 * variant follows it, so FeeCalculation(OutsideTimeToDismiss) is 231 alone. Short or single-word names, which
 * appear in ordinary text ("Invalid Transaction"), aren't looked for.
 */
function namePattern(entry: ErrorCodeEntry, shared: boolean): RegExp | undefined {
  const parts = entry.name.split("::");
  const last = parts.at(-1)!;
  const distinctive = last.length >= 10 && (last.match(/[A-Z]/g) ?? []).length >= 2;
  if (entry.nodeName === "Unknown") return new RegExp(`\\b${escape(entry.name)}\\b(?!\\s*[(:.{])`);
  if (parts.length > 1 && shared) {
    // The qualifier as the node may print it, with an Error or ErrorCode suffix, then up to three separators.
    const qualifier = parts.slice(0, -1).map(escape).join("\\W{1,3}");
    return new RegExp(`\\b${qualifier}\\w*\\W{1,3}${escape(last)}\\b`);
  }
  if (!distinctive) return undefined;
  // A bare name other codes share as a variant isn't that variant: MerkleTreeError alone, not ZswapInvalid(MerkleTreeError).
  return new RegExp(`${shared ? "(?<!\\w\\(\\s?|::|\\w\\s?\\{\\s?)" : ""}\\b${escape(last)}\\b`);
}

/** The map's codes whose names appear in the text, longest name first, each once. */
export function findCodesInText(text: string, map: ErrorCodesFile): string[] {
  const counts = new Map<string, number>();
  for (const entry of Object.values(map.codes)) counts.set(lastPart(entry.name), (counts.get(lastPart(entry.name)) ?? 0) + 1);
  return Object.entries(map.codes)
    .sort(([, a], [, b]) => b.name.length - a.name.length)
    .filter(([, entry]) => namePattern(entry, counts.get(lastPart(entry.name))! > 1)?.test(text))
    .map(([code]) => code);
}

/** The code with this name in the map: the whole name, or its last part when only one code has it. */
export function findLedgerByName(name: string, map: ErrorCodesFile): string | null {
  const wanted = name.replace(/\s+/g, "").toLowerCase();
  const exact = Object.entries(map.codes).find(([, entry]) => entry.name.toLowerCase() === wanted);
  if (exact) return exact[0];
  const byLast = Object.entries(map.codes).filter(([, entry]) => lastPart(entry.name).toLowerCase() === wanted);
  return byLast.length === 1 ? byLast[0]![0] : null;
}
