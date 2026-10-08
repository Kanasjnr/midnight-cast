// Working code from Midnight's examples for a problem decode or explain has identified: each
// kind of problem names a topic, and the examples index finds the code for it at its pinned
// commit, so the links follow the index when the pin moves.

import { findExamples, loadExamplesIndex } from "./examples-index.js";

export interface ExampleLink {
  example: string;
  about: string;
  path: string;
  lines: [number, number];
  url: string;
}

// Ledger codes by what usually fixes them in practice.
const LEDGER_TOPICS: Array<{ codes: number[]; topic: string }> = [
  // The wallet built its DUST spend on stale state: sync it before spending.
  { codes: [170, 171, 196], topic: "wallet sync" },
  // Fees came to more than the DUST available: another wallet can pay them.
  { codes: [138, 155, 168], topic: "dust sponsorship" },
  { codes: [126, 183, 189, 190, 191, 194], topic: "send tokens" },
  { codes: [103, 124, 127, 137], topic: "send shielded tokens" },
];

const EXPLAIN_TOPICS: Record<string, string[]> = {
  dust: ["dust sponsorship", "wallet sync"],
  sync: ["wallet sync"],
};

export function linksFor(topics: string[]): ExampleLink[] {
  const index = loadExamplesIndex();
  const links: ExampleLink[] = [];
  for (const topic of topics) {
    const match = findExamples(index, topic, 1)[0];
    const file = match?.filesMatched ? match.files[0] : undefined;
    if (match && file && !links.some((l) => l.url === file.url)) {
      links.push({ example: match.name, about: file.about, path: file.path, lines: file.lines, url: file.url });
    }
  }
  return links;
}

export function examplesForLedgerCode(code: number): ExampleLink[] {
  return linksFor(LEDGER_TOPICS.filter((t) => t.codes.includes(code)).map((t) => t.topic));
}

export function examplesForTopic(topic: string): ExampleLink[] {
  return linksFor(EXPLAIN_TOPICS[topic] ?? []);
}

export function describeLinks(links: ExampleLink[]): string[] {
  return links.map((l) => `${l.about} (${l.example}): ${l.url}`);
}
