// Writes src/data/runbooks.json from the service desk's runbooks index (midnightntwrk/servicedesk,
// runbooks/README.md): each runbook's title and link, and the exact error strings its error-string
// lookup table lists.
//
//   tsx scripts/runbooks-index.ts [--check]
//
// --check renders the table on servicedesk's main and exits 1 if it differs from the committed file,
// listing the rows added and removed, so a new runbook or row is noticed and shipped in a patch.
// Links point at main, so a runbook's edits need no release; only a new, moved or removed row does.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RunbookLookup, RunbooksIndex } from "../src/lib/runbooks.js";
import { fetchGitHub } from "./github.js";

const REPO = "midnightntwrk/servicedesk";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "src", "data", "runbooks.json");

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** A table's body rows under a heading, as cells. */
function tableRows(markdown: string, heading: string): string[][] {
  // The whole heading line, so "## Index" doesn't find "## Indexer notes".
  const at = markdown.search(new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \t]*$`, "m"));
  if (at === -1) throw new Error(`the runbooks README has no "## ${heading}" section`);
  const lines = markdown.slice(at).split("\n").slice(1);
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    // An escaped pipe is a pipe in the cell, as GitHub renders it.
    rows.push(line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim().replace(/\\\|/g, "|")));
  }
  return rows.slice(1);
}

/** A runbook's key: its directory, from a link such as `dir/dir.md`. */
const keyOf = (path: string) => path.split("/")[0]!;

/** Markdown links shown as their text, and backticks dropped, for a sentence a reader sees. */
const plain = (cell: string) => cell.replace(LINK, "$1").replace(/`/g, "").replace(/\s+/g, " ").trim();

/**
 * The strings a row's error cell asks to search for: the backticked strings at its start, outside
 * parentheses. `/` or "or" between two starts another alternative, `…` continues the same one in order,
 * and anything else, such as "on Mainnet" or "with `unshielded=false`", ends them: the rest is context. A
 * variant list right after them, as in "`Cannot find module '@midnight-ntwrk/wallet'` (or `ledger-v7`, `zswap`)",
 * adds the last string with its final name swapped for each variant.
 */
export function parseErrorCell(cell: string): { match: string[][]; when?: string } {
  const match: string[][] = [];
  let rest = cell.trim();
  let joiner: "start" | "or" | "then" = "start";
  while (rest.startsWith("`")) {
    const end = rest.indexOf("`", 1);
    if (end === -1) break;
    const text = rest.slice(1, end);
    if (joiner === "then") match.at(-1)!.push(text);
    else match.push([text]);
    rest = rest.slice(end + 1);
    const sep = /^\s*(\/|or|…)\s*(?=`)/.exec(rest);
    if (!sep) break;
    joiner = sep[1] === "…" ? "then" : "or";
    rest = rest.slice(sep[0].length);
  }
  const variants = /^\s*\(or ((?:`[^`]+`(?:,\s*)?)+)\)/.exec(rest);
  const last = match.at(-1);
  if (variants && last?.length === 1) {
    const name = /[\w.-]+(?=[^\w.-]*$)/.exec(last[0]!);
    if (name) {
      for (const [, variant] of variants[1]!.matchAll(/`([^`]+)`/g)) {
        match.push([last[0]!.slice(0, name.index) + variant + last[0]!.slice(name.index + name[0].length)]);
      }
    }
  }
  const shown = plain(cell);
  const matchedText = match.map((parts) => parts.join(" … ")).join(" / ");
  return { match, ...(shown !== matchedText ? { when: shown } : {}) };
}

export function parseRunbooksReadme(readme: string, commit: string): RunbooksIndex {
  const runbooks: RunbooksIndex["runbooks"] = {};
  for (const [cell] of tableRows(readme, "Index")) {
    const link = [...(cell ?? "").matchAll(LINK)][0];
    if (!link) continue;
    runbooks[keyOf(link[2]!)] = { title: link[1]!, url: `https://github.com/${REPO}/blob/main/runbooks/${link[2]}` };
  }
  const lookups: RunbookLookup[] = [];
  for (const [error = "", target = ""] of tableRows(readme, "Error-string lookup")) {
    const { match, when } = parseErrorCell(error);
    // A row with no error string, such as a hang, has nothing to search for.
    if (!match.length) continue;
    const links = [...target.matchAll(LINK)].map((m) => keyOf(m[2]!));
    for (const key of links) if (!runbooks[key]) throw new Error(`the lookup row for "${error}" links ${key}, which the index doesn't list`);
    if (!links.length) throw new Error(`the lookup row for "${error}" links no runbook`);
    const advice = plain(target);
    const single = links.length === 1 && advice === plain([...target.matchAll(LINK)][0]![0]);
    lookups.push({ match, ...(when ? { when } : {}), runbooks: [...new Set(links)], ...(single ? {} : { advice }) });
  }
  return { repo: REPO, commit, runbooks, lookups };
}

async function build(): Promise<RunbooksIndex> {
  const commit = (JSON.parse(await fetchGitHub(`https://api.github.com/repos/${REPO}/commits/main`)) as { sha: string }).sha;
  const readme = await fetchGitHub(`https://raw.githubusercontent.com/${REPO}/${commit}/runbooks/README.md`);
  return parseRunbooksReadme(readme, commit);
}

const rowKey = (row: RunbookLookup) => JSON.stringify(row);

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  let index: RunbooksIndex;
  try {
    index = await build();
  } catch (err) {
    console.error(`Couldn't build the runbooks index: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (!check) {
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    console.log(`wrote src/data/runbooks.json (${Object.keys(index.runbooks).length} runbooks, ${index.lookups.length} error strings at ${index.commit.slice(0, 7)})`);
    return 0;
  }
  const committed = JSON.parse(readFileSync(indexPath, "utf8")) as RunbooksIndex;
  const same = (a: RunbooksIndex, b: RunbooksIndex) => JSON.stringify({ ...a, commit: "" }) === JSON.stringify({ ...b, commit: "" });
  if (same(committed, index)) {
    console.log(`The runbooks index matches ${REPO} main (${index.commit.slice(0, 7)}).`);
    return 0;
  }
  const before = new Set(committed.lookups.map(rowKey));
  const after = new Set(index.lookups.map(rowKey));
  const describe = (row: RunbookLookup) => `- ${row.match.map((parts) => parts.map((p) => `\`${p}\``).join(" … ")).join(" / ")} → ${row.runbooks.join(", ")}`;
  const added = index.lookups.filter((row) => !before.has(rowKey(row))).map(describe);
  const removed = committed.lookups.filter((row) => !after.has(rowKey(row))).map(describe);
  const runbooksChanged = JSON.stringify(committed.runbooks) !== JSON.stringify(index.runbooks);
  console.log(
    [
      `The service desk's runbooks index on main (${index.commit.slice(0, 7)}) differs from src/data/runbooks.json (${committed.commit.slice(0, 7)}). Run npm run runbooks-index, review the diff, and ship it in a patch.`,
      ...(added.length ? ["", "Rows added or changed on main:", ...added] : []),
      ...(removed.length ? ["", "Rows removed or changed on main:", ...removed] : []),
      ...(runbooksChanged ? ["", "The runbooks' titles or links changed too."] : []),
    ].join("\n"),
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    },
  );
}
