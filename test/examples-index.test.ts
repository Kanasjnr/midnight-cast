import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { examplesCommand } from "../src/commands/examples.js";
import { findExamples, loadExamplesIndex, words } from "../src/lib/examples-index.js";
import { COMMIT, locate, readToolchain } from "../scripts/examples-index.js";
import { schemaErrors } from "./schema.js";

const index = loadExamplesIndex();
// A full envelope around a command's result, as the CLI prints it.
const envelope = (result: { ok: boolean; data?: unknown }) => ({
  schemaVersion: 1,
  ok: result.ok,
  command: "examples",
  network: null,
  data: result.data ?? null,
  warnings: [],
  error: null,
  next: [],
});
const top = (query: string) => findExamples(index, query)[0];

describe("Midnight's examples", () => {
  it("is pinned to one commit, and every link points at it and at the lines it names", () => {
    expect(index.commit).toBe(COMMIT);
    expect(index.examples.length).toBe(11);
    for (const example of index.examples) {
      expect(example.url).toContain(`/tree/${COMMIT}/examples/${example.name}`);
      for (const file of example.files) {
        expect(file.path.startsWith(`${example.path}/`), file.path).toBe(true);
        expect(file.url).toBe(`https://github.com/midnightntwrk/midnight-examples/blob/${COMMIT}/${file.path}#L${file.lines[0]}-L${file.lines[1]}`);
        expect(file.excerpt.split("\n")[0]!.trim().startsWith(file.symbol), `${file.path} ${file.symbol}`).toBe(true);
        expect(file.lines[1]).toBeGreaterThanOrEqual(file.lines[0]);
      }
    }
    expect(index.toolchain).toMatchObject({ "Compact language (pragma)": "0.23", "@midnight-ntwrk/midnight-js-*": "4.1.1" });
  });

  it("finds the example that shows a topic, asked in a person's words", () => {
    expect(top("DUST sponsorship")).toMatchObject({ name: "private-party", files: [expect.objectContaining({ symbol: "export async function sponsorAndSubmit" })] });
    expect(top("pay fees for another user")?.name).toBe("private-party");
    expect(top("send shielded tokens")?.name).toBe("token-transfers");
    expect(top("send shielded tokens")?.files[0]?.symbol).toBe("export circuit sendShieldedToUser");
    expect(top("verify a signature in a circuit")).toMatchObject({ name: "zk-loan", files: [expect.objectContaining({ symbol: "export circuit schnorrVerify" })] });
    expect(top("how do I use a witness")?.name).toBe("calculator");
    expect(top("send NIGHT to a user")?.files[0]?.symbol).toBe("export circuit sendNightTokensToUser");
    expect(top("prove my bid is above a minimum")?.name).toBe("private-bid");
    expect(findExamples(index, "commit-reveal").map((m) => m.name)).toEqual(expect.arrayContaining(["silent-auction", "election", "private-bid"]));
    expect(findExamples(index, "kubernetes")).toEqual([]);
    expect(findExamples(index, "the a of")).toEqual([]);
  });

  it("drops weak matches next to a strong one", () => {
    expect(findExamples(index, "verify a signature in a circuit").map((m) => m.name)).toEqual(["zk-loan"]);
  });

  it("reads words the way people write them", () => {
    expect(words("Send the Tokens, sponsorship!")).toEqual(["send", "token", "sponsorship"]);
  });

  it("finds a declaration's lines, through its closing brace or on its own line", () => {
    const source = ["pragma x;", "", "witness divMod(a: Uint<16>): Uint<16>;", "export circuit add(a: Uint<16>): [] {", "  if (a) {", "    x = 1;", "  }", "}", ""].join("\n");
    expect(locate(source, "witness divMod")).toEqual([3, 3]);
    expect(locate(source, "export circuit add")).toEqual([4, 8]);
    expect(() => locate(source, "export circuit missing")).toThrow("not found");
    expect(() => locate(source, "export circuit ad")).toThrow("not found");
  });

  it("reads the pinned toolchain table from the README", () => {
    const readme = "## Pinned toolchain\n\n| Component | Version |\n|---|---|\n| Compact language (`pragma`) | `0.23` |\n| Node.js | `22` (see `.nvmrc`) |\n";
    expect(readToolchain(readme)).toEqual({ "Compact language (pragma)": "0.23", "Node.js": "22" });
  });

  it("lists every example without a topic, and answers a topic with matches, as valid envelopes", () => {
    const list = examplesCommand(undefined, { json: true });
    expect(list.ok).toBe(true);
    expect(schemaErrors(envelope(list))).toEqual([]);
    const found = examplesCommand("dust sponsorship", { json: true });
    expect(schemaErrors(envelope(found))).toEqual([]);
    const none = examplesCommand("kubernetes", { json: true });
    expect(none).toMatchObject({ ok: false, exitCode: 1, error: 'No example matches "kubernetes"' });
  });

  it("ships the index with the package data", () => {
    expect(JSON.parse(readFileSync(join(process.cwd(), "src", "data", "examples-index.json"), "utf8")).commit).toBe(COMMIT);
  });
});
