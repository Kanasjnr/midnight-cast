// The service desk's runbooks (midnightntwrk/servicedesk), by the exact error strings its lookup table lists.
// scripts/runbooks-index.ts builds src/data/runbooks.json from that table; decode --raw links the runbook for
// each string it finds in a pasted error. Only the strings and links are bundled: a runbook's cause, fix and
// steps stay in the runbook, so its edits reach users without a midnight-cast release.

import { loadDataJson } from "./data-path.js";

export interface Runbook {
  title: string;
  url: string;
}

export interface RunbookLookup {
  /** Alternatives: the row matches when any of them is in the error. Each is substrings that must appear in order. */
  match: string[][];
  /** The rest of the row's error cell, when it says more than the strings: where the error comes from, or when it applies. */
  when?: string;
  /** Keys into runbooks: the runbooks the row links, the first being the one to read first. */
  runbooks: string[];
  /** The row's runbook cell, when it says more than one link: which runbook applies when. */
  advice?: string;
}

export interface RunbooksIndex {
  repo: string;
  /** The servicedesk commit the table was read at. */
  commit: string;
  runbooks: Record<string, Runbook>;
  lookups: RunbookLookup[];
}

export interface RunbookMatch {
  /** The error text that matched, its parts joined by " … ". */
  matched: string;
  runbooks: Runbook[];
  when?: string;
  advice?: string;
}

export const loadRunbooksIndex = (): RunbooksIndex => loadDataJson<RunbooksIndex>("runbooks.json");

/** Whether the parts appear in the text in order. */
function inOrder(text: string, parts: string[]): boolean {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

/** The runbook rows whose error strings appear in the text, longest match first, each once. */
export function matchRunbooks(text: string, index: RunbooksIndex = loadRunbooksIndex()): RunbookMatch[] {
  const matches = index.lookups.flatMap((row) => {
    const hit = row.match.find((parts) => inOrder(text, parts));
    if (!hit) return [];
    const runbooks = row.runbooks.map((key) => index.runbooks[key]).filter((r): r is Runbook => r !== undefined);
    return [{ matched: hit.join(" … "), runbooks, ...(row.when ? { when: row.when } : {}), ...(row.advice ? { advice: row.advice } : {}) }];
  });
  return matches.sort((a, b) => b.matched.length - a.matched.length);
}
