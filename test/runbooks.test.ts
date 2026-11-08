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
    expect(text).toContain("Midnight's service desk has a runbook for this:");
    expect(text).toContain("also Moving to Blockfrost");
  });

  it("matches parts in order, and is case-sensitive like the table", () => {
    expect(matchRunbooks("another binding found for x in the same scope")).toHaveLength(1);
    expect(matchRunbooks("in the same scope, another binding found for x")).toEqual([]);
    expect(matchRunbooks("insufficient funds: could not balance dust")).toEqual([]);
    expect(decodeCommand([], { raw: "nothing Midnight about this" }).ok).toBe(false);
  });
});

describe("reading the runbooks index", () => {
  it("takes the leading strings, with / and or as alternatives and … in order, and keeps the rest as context", () => {
    expect(parseErrorCell("`A`")).toEqual({ match: [["A"]] });
    expect(parseErrorCell("`A` / `B`")).toEqual({ match: [["A"], ["B"]] });
    expect(parseErrorCell("`A` … `B` (from `tool`)")).toEqual({ match: [["A", "B"]], when: "A … B (from tool)" });
    expect(parseErrorCell("`A` with `B` or `C`")).toEqual({ match: [["A"]], when: "A with B or C" });
    expect(parseErrorCell("No error: `f` never returns")).toEqual({ match: [], when: "No error: f never returns" });
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
  });
});
