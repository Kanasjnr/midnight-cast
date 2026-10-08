// Working code from Midnight's examples for a problem decode or explain has identified. Each link
// names an example and a declaration in the examples index, so it points at exactly that code at
// the index's pinned commit; a test fails if one stops resolving when the pin moves.

import { loadExamplesIndex } from "./examples-index.js";

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
