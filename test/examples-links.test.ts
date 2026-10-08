import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";
import { explainCommand } from "../src/commands/explain.js";
import { examplesForLedgerCode, examplesForTopic } from "../src/lib/example-links.js";
import { loadExamplesIndex } from "../src/lib/examples-index.js";
import { examplesToolchainChecks, findPragmas, nodeAdmits, pragmaAdmits } from "../src/lib/examples-toolchain.js";

const root = mkdtempSync(join(tmpdir(), "examples-links-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const toolchain = loadExamplesIndex().toolchain;

function project(name: string, packageJson: object, files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(packageJson));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("the examples' toolchain against a project", () => {
  it("reads pragma constraints the way Compact writes them", () => {
    expect(pragmaAdmits("0.23", "0.23")).toBe(true);
    expect(pragmaAdmits("0.23", "0.24")).toBe(false);
    expect(pragmaAdmits(">= 0.25.0", "0.23")).toBe(false);
    expect(pragmaAdmits(">= 0.16 && <= 0.23", "0.23")).toBe(true);
    expect(pragmaAdmits(">= 0.16 && <= 0.20", "0.23")).toBe(false);
    expect(pragmaAdmits("latest", "0.23")).toBeUndefined();
  });

  it("reads a declared Node.js version or range", () => {
    expect(nodeAdmits("22", "22")).toBe(true);
    expect(nodeAdmits("v22.3.0", "22")).toBe(true);
    expect(nodeAdmits(">=22.0.0", "22")).toBe(true);
    expect(nodeAdmits(">=18", "22")).toBe(true);
    expect(nodeAdmits("^20", "22")).toBe(false);
    expect(nodeAdmits("lts/*", "22")).toBeUndefined();
  });

  it("flags what differs from the examples, and checks only what the project declares", () => {
    const dir = project(
      "old",
      { engines: { node: "^20" } },
      { "contract/c.compact": "pragma language_version >= 0.16 && <= 0.20;\n", "node_modules/x/d.compact": "pragma language_version 0.99;\n" },
    );
    const checks = examplesToolchainChecks(toolchain, {
      dir,
      packages: { "@midnight-ntwrk/midnight-js-contracts": "4.0.0", "@midnightntwrk/midnight-js-types": "4.1.1", "@midnight-ntwrk/wallet-sdk": "^1.0.4" },
    });
    expect(checks.map((c) => [c.label, c.live, c.ok])).toEqual([
      ["midnight-js", "4.0.0, 4.1.1", false],
      ["wallet-sdk", "1.0.4", false],
      ["pragma language_version", ">= 0.16 && <= 0.20", false],
      ["node.js", "^20", false],
    ]);
    expect(checks[1]!.note).toBe(`the official examples run ${toolchain["wallet SDK"]}`);
    expect(findPragmas(dir).map((p) => p.constraint)).toEqual([">= 0.16 && <= 0.20"]);
  });

  it("finds nothing to compare in a project with no Midnight packages, pragmas or Node version", () => {
    expect(examplesToolchainChecks(toolchain, { dir: project("empty", {}) })).toEqual([]);
  });
});

describe("working code for what decode and explain identify", () => {
  it("links each kind of ledger error to the code that fixes it in practice", () => {
    expect(examplesForLedgerCode(170)).toEqual([expect.objectContaining({ example: "hello-world", path: "examples/hello-world/src/wallet.ts" })]);
    expect(examplesForLedgerCode(138)).toEqual([expect.objectContaining({ example: "private-party", path: "examples/private-party/src/sponsor.ts" })]);
    expect(examplesForLedgerCode(126)[0]).toMatchObject({ example: "token-transfers" });
    expect(examplesForLedgerCode(169)).toEqual([]);
    for (const link of examplesForLedgerCode(170)) expect(link.url).toContain(loadExamplesIndex().commit);
  });

  it("puts the links in decode's output", () => {
    const ledger = decodeCommand(["170"], { json: true });
    expect(ledger.data).toMatchObject({ code: 170, examples: [expect.objectContaining({ example: "hello-world" })] });
    const message = decodeCommand([], { json: true, raw: "Wallet.InsufficientFunds: Insufficient Funds: could not balance dust" });
    const decoded = (message.data as { decodings: Array<{ id?: string; examples?: Array<{ example: string; path: string }> }> }).decodings[0]!;
    expect(decoded.id).toBe("wallet-insufficient-dust");
    expect(decoded.examples?.map((e) => e.path)).toEqual([
      "examples/hello-world/ui/src/lib/errors.ts",
      "examples/private-party/src/sponsor.ts",
      "examples/hello-world/src/wallet.ts",
    ]);
    expect(decodeCommand([], { json: true, raw: "Wallet.InsufficientFunds: not enough NIGHT" }).ok).toBe(false);
  });

  it("explains a slow wallet sync with the examples' measurements, and links the code", () => {
    const sync = explainCommand("sync", { json: true }).data as { text: string; examples: Array<{ example: string }> };
    expect(sync.text).toContain("about 78 minutes");
    expect(sync.text).toMatch(/node 1\.0\.400 run \(30 Sep 2026\): 67 minutes/);
    expect(sync.text).toContain(`/blob/${loadExamplesIndex().commit}/FAST-SYNC.md`);
    expect(sync.examples).toEqual([expect.objectContaining({ example: "hello-world" })]);
    expect(examplesForTopic("dust").map((l) => l.example)).toEqual(["private-party", "hello-world"]);
    expect((explainCommand("1010", { json: true }).data as object)).not.toHaveProperty("examples");
  });
});
