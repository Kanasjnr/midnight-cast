// Working code from Midnight's examples for a problem decode or explain has identified. Each link
// names an example and a declaration in the examples index, so it points at exactly that code at
// the index's pinned commit; a test fails if one stops resolving when the pin moves.

import { loadExamplesIndex } from "./examples-index.js";
import { networkTitle } from "./blockfrost.js";
import { ledgerMajor, publicNetworks, runs } from "./network-names.js";
import { loadSupportMatrix, type SupportMatrixFile } from "./versions.js";

export interface ExampleLink {
  example: string;
  about: string;
  path: string;
  lines: [number, number];
  url: string;
}

/** A declaration in the examples index. */
export interface ExampleRef {
  example: string;
  symbol: string;
}

const SYNC: ExampleRef = { example: "hello-world", symbol: "export async function syncWallet" };
const SPONSOR: ExampleRef = { example: "private-party", symbol: "export async function sponsorAndSubmit" };
export const WALLET_ERRORS: ExampleRef = { example: "hello-world", symbol: "function withHint" };
const SEND: ExampleRef = { example: "token-transfers", symbol: "export circuit sendToUser" };
const RECEIVE_SHIELDED: ExampleRef = { example: "token-transfers", symbol: "export circuit receiveShieldedTokens" };

// Ledger codes linked only where the code shows what fixes them.
const LEDGER_LINKS: Array<{ codes: number[]; refs: ExampleRef[] }> = [
  // The wallet built its DUST spend on stale state: sync it before spending.
  { codes: [170, 171, 196], refs: [SYNC] },
  // A balance went negative once fees were applied: not enough DUST, so another wallet can pay.
  { codes: [138], refs: [SPONSOR] },
  // A token type went negative: send only what the contract holds.
  { codes: [126], refs: [SEND] },
  // A contract-owned shielded output wasn't claimed: receive it in the contract.
  { codes: [124], refs: [RECEIVE_SHIELDED] },
];

const TOPIC_LINKS = new Map<string, ExampleRef[]>([
  ["dust", [SPONSOR, SYNC]],
  ["sync", [SYNC]],
]);

/** Every declaration the links name, for the test that keeps them resolving. */
export const ALL_REFS: ExampleRef[] = [SYNC, SPONSOR, WALLET_ERRORS, SEND, RECEIVE_SHIELDED];

export function resolveLinks(refs: ExampleRef[]): ExampleLink[] {
  if (!refs.length) return [];
  const index = loadExamplesIndex();
  return refs.flatMap((ref) => {
    const example = index.examples.find((e) => e.name === ref.example);
    const file = example?.files.find((f) => f.symbol === ref.symbol);
    return example && file ? [{ example: example.name, about: file.about, path: file.path, lines: file.lines, url: file.url }] : [];
  });
}

export function examplesForLedgerCode(code: number): ExampleLink[] {
  return resolveLinks(LEDGER_LINKS.filter((l) => l.codes.includes(code)).flatMap((l) => l.refs));
}

export function examplesForTopic(topic: string): ExampleLink[] {
  return resolveLinks(TOPIC_LINKS.get(topic) ?? []);
}

export function describeLinks(links: ExampleLink[]): string[] {
  return links.map((l) => `${l.about} (${l.example}): ${l.url}`);
}

/**
 * When the examples' code targets a ledger a network doesn't run, a note saying so: for that network,
 * or, without one or for one the matrix gives no ledger for, the public networks on another ledger.
 * Undefined when nothing differs.
 */
export function examplesLedgerNote(network?: string): string | undefined {
  const ledger = Number(loadExamplesIndex().ledger);
  let matrix: SupportMatrixFile["networks"];
  try {
    matrix = loadSupportMatrix().networks;
    if (typeof matrix !== "object" || matrix === null) return undefined;
  } catch {
    // A note beside working code isn't worth failing over a broken support-matrix override.
    return undefined;
  }
  const majorOf = (name: string) => ledgerMajor(matrix[name]?.ledger);
  // A network the matrix gives no ledger for, such as local, gets the general note.
  const on = network ? majorOf(network) : undefined;
  if (on !== undefined) {
    return on !== ledger ? `This code targets Ledger ${ledger}, and ${networkTitle(network!)} runs Ledger ${on}, so its APIs may not match.` : undefined;
  }
  const known = publicNetworks(matrix).filter((name) => majorOf(name) !== undefined);
  const others = known.filter((name) => majorOf(name) !== ledger);
  if (!others.length) return undefined;
  const same = known.filter((name) => majorOf(name) === ledger);
  const otherLedgers = [...new Set(others.map(majorOf))].map((major) => `${runs(others.filter((name) => majorOf(name) === major))} Ledger ${major}`);
  return `This code targets Ledger ${ledger}${same.length ? `, which ${runs(same)}` : ""}; ${otherLedgers.join(", and ")}, so its APIs may not match there.`;
}
