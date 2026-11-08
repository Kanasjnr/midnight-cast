import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";
import { loadRunbooksIndex, matchRunbooks } from "../src/lib/runbooks.js";
import { parseErrorCell, parseRunbooksReadme } from "../scripts/runbooks-index.js";
import { schemaErrors } from "./schema.js";

const index = loadRunbooksIndex();
// Text that contains one alternative of a row: its parts in order, with other text around and between them.
const sample = (parts: string[]) => `Error: ${parts.join(" ... ")} (at line 3)`;

describe("the service desk's runbooks in decode", () => {
  it("bundles every runbook the lookup links, at main", () => {
    expect(Object.keys(index.runbooks).length).toBeGreaterThanOrEqual(17);
    for (const runbook of Object.values(index.runbooks)) {
      expect(runbook.url).toMatch(/^https:\/\/github\.com\/midnightntwrk\/servicedesk\/blob\/main\/runbooks\/[^/]+\/[^/]+\.md$/);
    }
    for (const row of index.lookups) for (const key of row.runbooks) expect(index.runbooks, key).toHaveProperty(key);
  });

  // A new row the matcher can't find fails here until decode knows it.
  it("finds every row's runbooks from each of its error strings", () => {
    for (const row of index.lookups) {
      for (const parts of row.match) {
        const found = matchRunbooks(sample(parts)).flatMap((m) => m.runbooks.map((r) => r.url));
        for (const key of row.runbooks) expect(found, parts.join(" … ")).toContain(index.runbooks[key]!.url);
      }
    }
  });

  it("answers an error only a runbook knows, with a valid envelope", () => {
    const result = decodeCommand([], { json: true, raw: "npm warn EBADENGINE Unsupported engine" });
    expect(result.ok).toBe(true);
    const data = result.data as { decodings: unknown[]; runbooks: Array<{ matched: string; runbooks: Array<{ title: string }> }> };
    expect(data.decodings).toEqual([]);
    expect(data.runbooks).toEqual([expect.objectContaining({ matched: "EBADENGINE", runbooks: [expect.objectContaining({ title: index.runbooks["toolchain-project-setup-runbook"]!.title })] })]);
    expect(schemaErrors({ command: "decode", data: result.data, schemaVersion: 2, ok: true, network: null, warnings: [], error: null, next: [] } as never)).toEqual([]);
  });

  it("lists a runbook once, under the longest string, beside what decodes", () => {
    const result = decodeCommand([], { json: true, raw: "1010: Invalid Transaction: Custom error: 170" });
    const data = result.data as { decodings: Array<{ kind: string }>; runbooks: Array<{ matched: string }> };
    expect(data.decodings.map((d) => d.kind)).toContain("ledger");
    expect(data.runbooks.map((r) => r.matched)).toEqual(["1010: Invalid Transaction: Custom error:"]);
    const text = decodeCommand([], { raw: "values inserted non-linearly into dust generation tree" }).data as string;
    expect(text).toContain("Midnight's service desk has a runbook for this. Symptoms overlap");
    expect(text).toContain("also Moving to Blockfrost");
  });

  it("matches parts in order, and is case-sensitive like the table", () => {
    expect(matchRunbooks("another binding found for x in the same scope")).toHaveLength(1);
    expect(matchRunbooks("in the same scope, another binding found for x")).toEqual([]);
    expect(matchRunbooks("insufficient funds: could not balance dust")).toEqual([]);
    expect(decodeCommand([], { raw: "nothing Midnight about this" }).ok).toBe(false);
  });

  it("leaves out rows for other networks, and keeps decode's hints beside a runbook-only answer", () => {
    const titles = (raw: string, network?: string) =>
      ((decodeCommand([], { json: true, raw, ...(network ? { network } : {}) }).data as { runbooks: Array<{ runbooks: Array<{ title: string }> }> }).runbooks ?? []).flatMap((m) => m.runbooks.map((r) => r.title));
    const night = index.runbooks["contract-native-night-mainnet-runbook"]!.title;
    expect(titles("1010: Invalid Transaction: Custom error: 194", "mainnet")).toContain(night);
    expect(titles("1010: Invalid Transaction: Custom error: 194", "preview")).not.toContain(night);
    const proving = decodeCommand([], { json: true, raw: "Error: Failed to prove transaction: proof server returned 500" });
    expect((proving.data as { warnings: string[] }).warnings).toEqual([expect.stringContaining("proof-server")]);
    const word = decodeCommand([], { json: true, raw: "EBADENGINE" }).data as object;
    expect(word).not.toHaveProperty("warnings");
    expect(titles("Cannot find module '@midnight-ntwrk/ledger-v7'")).toEqual([index.runbooks["sdk-ai-generated-code-errors-runbook"]!.title]);
  });

  it("names each runbook once across rows", () => {
    const matches = matchRunbooks("Transaction submission error, then 1000:: Normal Closure");
    const urls = matches.flatMap((m) => m.runbooks.map((r) => r.url));
    expect(urls).toHaveLength(new Set(urls).size);
    expect(urls).toContain(index.runbooks["wallet-preprod-sync-runbook"]!.url);
  });
});

describe("reading the runbooks index", () => {
  it("takes the leading strings, with / and or as alternatives and … in order, and keeps the rest as context", () => {
    expect(parseErrorCell("`A`")).toEqual({ match: [["A"]] });
    expect(parseErrorCell("`A` / `B`")).toEqual({ match: [["A"], ["B"]] });
    expect(parseErrorCell("`A` … `B` (from `tool`)")).toEqual({ match: [["A", "B"]], when: "A … B (from tool)" });
    expect(parseErrorCell("`A` with `B` or `C`")).toEqual({ match: [["A"]], when: "A with B or C" });
    expect(parseErrorCell("No error: `f` never returns")).toEqual({ match: [], when: "No error: f never returns" });
    expect(parseErrorCell("`Cannot find module 'x/wallet'` (or `ledger-v7`, `zswap`)").match).toEqual([
      ["Cannot find module 'x/wallet'"],
      ["Cannot find module 'x/ledger-v7'"],
      ["Cannot find module 'x/zswap'"],
    ]);
  });

  it("links each row to the runbooks in the index, and refuses a row that links one the index doesn't list", () => {
    const readme = [
      "## Index",
      "| Runbook | Covers |",
      "|---|---|",
      "| [Sync](sync-runbook/sync-runbook.md) | x |",
      "| [Funds](funds-runbook/funds-runbook.md) | y |",
      "",
      "## Error-string lookup",
      "| Error text | Runbook |",
      "|---|---|",
      "| `stuck` | [Sync](sync-runbook/sync-runbook.md) |",
      "| `empty` on Preprod | [Funds](funds-runbook/funds-runbook.md) (if new: [Sync](sync-runbook/sync-runbook.md)) |",
      "| No error: `hang` | [Sync](sync-runbook/sync-runbook.md) |",
      "",
      "## Conventions",
    ].join("\n");
    const parsed = parseRunbooksReadme(readme, "abc");
    expect(parsed.runbooks["sync-runbook"]).toEqual({ title: "Sync", url: "https://github.com/midnightntwrk/servicedesk/blob/main/runbooks/sync-runbook/sync-runbook.md" });
    expect(parsed.lookups).toEqual([
      { match: [["stuck"]], runbooks: ["sync-runbook"] },
      { match: [["empty"]], when: "empty on Preprod", runbooks: ["funds-runbook", "sync-runbook"], advice: "Funds (if new: Sync)" },
    ]);
    expect(() => parseRunbooksReadme(readme.replace("| [Funds](funds-runbook/funds-runbook.md) | y |\n", ""), "abc")).toThrow(/doesn't list/);
    // A heading that only starts the same isn't the section, and an escaped pipe is a pipe.
    const tricky = `## Indexer notes\n| a | b |\n|---|---|\n| x | y |\n\n${readme.replace("`stuck`", "`exit 1 \\| signal`")}`;
    expect(parseRunbooksReadme(tricky, "abc").lookups[0]).toEqual({ match: [["exit 1 | signal"]], runbooks: ["sync-runbook"] });
  });
});
