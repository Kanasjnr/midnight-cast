// Which of Midnight's official examples shows which pattern, at one pinned commit of
// midnightntwrk/midnight-examples. scripts/examples-index.ts builds it; a live check keeps
// it matching the pin and notes when the repository moves on.

import { loadDataJson } from "./data-path.js";

export interface ExampleFile {
  path: string;
  /** The declaration the lines cover, e.g. `export circuit sendToUser`. */
  symbol: string;
  about: string;
  lines: [number, number];
  url: string;
  excerpt: string;
}

export interface Example {
  name: string;
  path: string;
  summary: string;
  topics: string[];
  url: string;
  files: ExampleFile[];
}

export interface ExamplesIndex {
  repo: string;
  commit: string;
  /** The toolchain the examples are pinned to at that commit, from their README. */
  toolchain: Record<string, string>;
  examples: Example[];
}

export interface ExampleMatch {
  name: string;
  summary: string;
  url: string;
  topics: string[];
  /** The files that show the topic, best first; all of the example's files when none stands out. */
  files: ExampleFile[];
}

export function loadExamplesIndex(): ExamplesIndex {
  return loadDataJson<ExamplesIndex>("examples-index.json");
}

const STOP = new Set(["a", "an", "the", "to", "in", "of", "for", "with", "and", "or", "how", "do", "i", "my", "on", "from", "is", "can", "it", "me", "show", "example", "examples", "code", "midnight", "circuit", "contract", "use", "using"]);

/** Lower-case words, with a plural "s" dropped so "tokens" finds "token". */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * The examples that best show a topic. A topic phrase the query contains counts most, then
 * words shared with an example's topics, its files' descriptions and symbols, and its summary.
 */
export function findExamples(index: ExamplesIndex, query: string, limit = 3): ExampleMatch[] {
  const asked = new Set(words(query));
  const text = ` ${words(query).join(" ")} `;
  if (!asked.size) return [];
  const overlap = (phrase: string) => words(phrase).filter((w) => asked.has(w)).length;
  const scored = index.examples.map((example) => {
    const topicScore = example.topics.reduce((sum, topic) => {
      const phrase = ` ${words(topic).join(" ")} `;
      return sum + (phrase.trim() && text.includes(phrase) ? 5 : 0) + overlap(topic);
    }, 0);
    const files = example.files
      .map((file) => ({ file, score: overlap(file.about) + overlap(file.symbol) }))
      .sort((a, b) => b.score - a.score);
    const fileScore = files[0]?.score ?? 0;
    const score = topicScore * 2 + fileScore + overlap(example.summary) * 0.5 + (asked.has(example.name.replace(/-/g, "")) || text.includes(` ${example.name.replace(/-/g, " ")} `) ? 5 : 0);
    const showing = files.filter((f) => f.score > 0).map((f) => f.file);
    return { example, score, files: showing.length ? showing : example.files };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  // Weak matches next to a strong one are noise.
  return scored
    .filter((s) => s.score > 0 && s.score >= best * 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ example, files }) => ({ name: example.name, summary: example.summary, url: example.url, topics: example.topics, files }));
}
