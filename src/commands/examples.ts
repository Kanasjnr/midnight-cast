import { findExamples, loadExamplesIndex, type ExampleMatch, type ExamplesIndex } from "../lib/examples-index.js";
import type { EmitResult, GlobalOptions } from "../output.js";

export interface ExamplesReport {
  repo: string;
  commit: string;
  toolchain: Record<string, string>;
  /** The question asked, when there was one. */
  topic?: string;
  matches?: ExampleMatch[];
  /** Without a topic: every example and what it shows. */
  examples?: Array<{ name: string; summary: string; topics: string[]; url: string }>;
}

/** Midnight's official examples: all of them, or the ones that show a topic, with the code that does. */
export function examplesCommand(topic: string | undefined, options: GlobalOptions, index: ExamplesIndex = loadExamplesIndex()): EmitResult {
  const base = { repo: index.repo, commit: index.commit, toolchain: index.toolchain };
  const query = topic?.trim();
  if (!query) {
    const report: ExamplesReport = {
      ...base,
      examples: index.examples.map(({ name, summary, topics, url }) => ({ name, summary, topics, url })),
    };
    return { ok: true, data: options.json ? report : formatList(report), exitCode: 0 };
  }
  const matches = findExamples(index, query);
  const report: ExamplesReport = { ...base, topic: query, matches };
  if (!matches.length) {
    return {
      ok: false,
      data: options.json ? report : formatMatches(report),
      exitCode: 1,
      error: `No example matches "${query}"`,
      next: [{ command: "midnight-cast examples", reason: "List every example and the topics it covers" }],
    };
  }
  return { ok: true, data: options.json ? report : formatMatches(report), exitCode: 0 };
}

const pin = (report: ExamplesReport) =>
  `${report.repo} at ${report.commit.slice(0, 7)}, pinned to ${Object.entries(report.toolchain)
    .filter(([k]) => /pragma|compiler|midnight-js/.test(k))
    .map(([k, v]) => `${k.replace(/ \(.*\)$/, "")} ${v}`)
    .join(", ")}`;

function formatList(report: ExamplesReport): string {
  const lines = [`Midnight's examples (${pin(report)})`, ""];
  for (const e of report.examples ?? []) lines.push(`  ${e.name.padEnd(16)} ${e.summary}`, `  ${"".padEnd(16)} topics: ${e.topics.join(", ")}`);
  lines.push("", "Find the code for a topic: midnight-cast examples \"<topic>\"");
  return lines.join("\n");
}

function formatMatches(report: ExamplesReport): string {
  const matches = report.matches ?? [];
  if (!matches.length) return "Try other words, or list every example and its topics: midnight-cast examples";
  const lines = [`Midnight's examples for "${report.topic}" (${pin(report)})`];
  matches.forEach((match, i) => {
    lines.push("", `${match.name}: ${match.summary}`);
    for (const file of match.files) lines.push(`  ${file.about}: ${file.path}:${file.lines[0]}-${file.lines[1]}`, `    ${file.url}`);
    // The best match's best file, so the answer is on screen.
    if (i === 0 && match.files[0]) lines.push("", ...match.files[0].excerpt.split("\n").map((l) => `    ${l}`));
  });
  return lines.join("\n");
}
