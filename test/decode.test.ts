import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";
import { LEDGER_8_ROW, withSupportMatrix } from "./support-matrix-override.js";

describe("decodeCommand", () => {
  it("decodes numeric ledger code 170", () => {
    const result = decodeCommand(["170"], { json: true, network: "preprod" });
    expect(result.ok).toBe(true);
    const data = result.data as {
      kind: string;
      code: number;
      name: string;
      ledger: string;
      networkLedger?: string;
      mapMismatch?: string;
    };
    expect(data.kind).toBe("ledger");
    expect(data.code).toBe(170);
    expect(data.name).toBe("InvalidDustSpendProof");
    // Every network runs Ledger 9, so each reads the Ledger 9 map, with no warning.
    expect(data.ledger).toBe("9.1.0.0");
    for (const network of ["preview", "preprod", "mainnet"]) {
      const on = decodeCommand(["170"], { json: true, network }).data as { ledger: string; networkLedger?: string; mapMismatch?: string };
      expect(on, network).toMatchObject({ ledger: "9.1.0.0", networkLedger: "9.1.0.0" });
      expect(on.mapMismatch, network).toBeUndefined();
    }
  });

  it("reads a network still on Ledger 8 with the 8.1.3 map", () =>
    withSupportMatrix({ preprod: LEDGER_8_ROW }, () => {
      const data = decodeCommand(["170"], { json: true, network: "preprod" }).data as { ledger: string; networkLedger?: string; mapMismatch?: string };
      expect(data).toMatchObject({ ledger: "8.1.3", networkLedger: "8.1.3" });
      expect(data.mapMismatch).toBeUndefined();
      expect((decodeCommand(["182"], { json: true, network: "preprod" }).data as object)).not.toHaveProperty("retired");
    }));

  it("warns when a network runs a ledger none of the bundled maps covers", () =>
    withSupportMatrix({ preview: { ledger: "10.0.0" } }, () => {
      const data = decodeCommand(["170"], { json: true, network: "preview" }).data as { ledger: string; mapMismatch?: string };
      expect(data.ledger).toBe("9.1.0.0");
      expect(data.mapMismatch).toContain("cover ledgers 9.1.0.0 and 8.1.3, but preview runs ledger 10.0.0");
    }));

  it("explains a code Ledger 9 retired, with the codes that replaced it", () => {
    const data = decodeCommand(["182"], { json: true, network: "mainnet" }).data as { name: string; ledger: string; retired: { on: string; replacedBy: number[]; note: string } };
    expect(data).toMatchObject({ name: "TransactionApplicationError", ledger: "8.1.3", retired: { on: "9.1.0.0", replacedBy: [228, 229, 230] } });
    expect(data.retired.note).toContain("returns 228, 229 or 230 instead");
  });

  it("says, without a network, when a code means something else or nothing on the other ledger", () => {
    const fresh = decodeCommand(["239"], { json: true }).data as { name: string; otherLedgers: unknown[]; otherLedgersNote: string };
    expect(fresh).toMatchObject({ name: "ZswapInvalid::NullifierAlreadyPresent", otherLedgers: [{ ledger: "8.1.3", nodeTag: "node-1.0.400", name: null }] });
    expect(fresh.otherLedgersNote).toContain("On ledger 8.1.3 (node 1.0.400), 239 isn't used");
    // The same name on both, such as a narrowed code or one that didn't change, gets no note.
    for (const code of ["103", "170"]) expect(decodeCommand([code], { json: true }).data as object, code).not.toHaveProperty("otherLedgers");
    expect(decodeCommand(["239"], { json: true, network: "preview" }).data as object).not.toHaveProperty("otherLedgers");
  });

  it("still decodes the names Ledger 9 retired, by argument and in a pasted error", () => {
    for (const [name, code] of [["TransactionApplicationError", 182], ["EffectsCheckFailure", 186]] as const) {
      const data = decodeCommand([name], { json: true, network: "mainnet" }).data as { code: number; ledger: string; retired?: object };
      expect(data, name).toMatchObject({ code, ledger: "8.1.3", retired: expect.any(Object) });
    }
    const pasted = decodeCommand([], { json: true, raw: "Error: TransactionApplicationError(IntentTtlExpired)" }).data as { decodings: Array<{ code?: number }> };
    expect(pasted.decodings.map((d) => d.code)).toEqual(expect.arrayContaining([228, 182]));
  });

  it("finds names in pasted errors the way the node prints them", () => {
    const codes = (raw: string) => (decodeCommand([], { json: true, raw }).data as { decodings: Array<{ code?: number }> }).decodings.map((d) => d.code);
    // A catch-all isn't claimed when a variant follows it, and a shared last part needs its qualifier.
    // The retired Ledger 8 code reads the same text, so it's listed too, with the note that says it's retired.
    expect(codes("Error: FeeCalculation(OutsideTimeToDismiss)")).toEqual([231, 168]);
    expect(codes("Error: FeeCalculation(OutsideTimeToDismiss)")).not.toContain(145);
    expect(codes("Error: ZswapInvalid(MerkleTreeError)")).toEqual([250]);
    expect(codes("Error: ReplayProtectionViolation(IntentAlreadyExists)")).toEqual([244, 193]);
  });

  it("says when a code is read with another ledger's map, and for a network whose ledger isn't known", () =>
    withSupportMatrix({ preprod: LEDGER_8_ROW }, () => {
      const onEight = decodeCommand(["228"], { json: true, network: "preprod" }).data as { ledger: string; notOnLedger?: { ledger: string; note: string } };
      expect(onEight).toMatchObject({ ledger: "9.1.0.0", notOnLedger: { ledger: "8.1.3", note: expect.stringContaining("doesn't use 228") } });
      const local = decodeCommand(["239"], { json: true, network: "local" }).data as { otherLedgersNote?: string };
      expect(local.otherLedgersNote).toContain("On ledger 8.1.3 (node 1.0.400), 239 isn't used");
      const text = decodeCommand(["182"], { network: "mainnet" }).data as string;
      expect(text).toContain("Map:    ledger 8.1.3 (mainnet, updated 2026-10)\n");
      expect((decodeCommand(["FeeCalculation"], { json: true }).data as { otherLedgersNote: string }).otherLedgersNote).toContain("FeeCalculation is 168");
    }));

  it("finds a Ledger 9 code by its full name or by a last part only one code has", () => {
    expect((decodeCommand(["NullifierAlreadyPresent"], { json: true }).data as { code: number }).code).toBe(239);
    expect((decodeCommand(["TransactionApplication::IntentTtlExpired"], { json: true }).data as { code: number }).code).toBe(228);
    // IntentTtlExpired alone could be 228, 242 or 245.
    expect(decodeCommand(["IntentTtlExpired"], { json: true }).ok).toBe(false);
    const raw = decodeCommand([], { json: true, raw: "Error: ZswapInvalid NullifierAlreadyPresent at block 12" }).data as { decodings: Array<{ code?: number }> };
    expect(raw.decodings.map((d) => d.code)).toContain(239);
  });

  it("uses the minimum node, and doesn't guess Ledger 8 for a network the matrix gives no ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "midnight-cast-decode-"));
    const previous = process.env.XDG_CONFIG_HOME;
    try {
      mkdirSync(join(dir, "midnight-cast"), { recursive: true });
      const row = { indexer: "4.4.101", indexerApi: "v4", proofServer: "9.0.0", onChainRuntime: "4.0.0" };
      writeFileSync(
        join(dir, "midnight-cast", "support-matrix.json"),
        JSON.stringify({
          docUrl: "https://example.com",
          updated: "2026-11",
          networks: {
            preview: { ...row, node: "2.1.200", minNode: "2.1.101", runtimeSpec: 2001100 },
            preprod: { ...row, node: "1.0.400", runtimeSpec: 1000300, ledger: "8.1.3" },
          },
        }),
      );
      process.env.XDG_CONFIG_HOME = dir;
      // An unparsable ledger is unknown too, not Ledger 8.
      const unparsable = JSON.parse(readFileSync(join(dir, "midnight-cast", "support-matrix.json"), "utf8"));
      unparsable.networks.mainnet = { ...row, node: "2.1.300", runtimeSpec: 2001100, ledger: "v9" };
      writeFileSync(join(dir, "midnight-cast", "support-matrix.json"), JSON.stringify(unparsable));
      unparsable.networks.local = { ...row, node: "1.0.0", runtimeSpec: 2001100, ledger: "8.0.0" };
      unparsable.networks.preview.minNode = undefined;
      unparsable.networks.preview.node = undefined;
      writeFileSync(join(dir, "midnight-cast", "support-matrix.json"), JSON.stringify(unparsable));
      const runtime = decodeCommand([], { json: true, raw: "UnsupportedBlockVersion(2001100)" });
      expect((runtime.data as { decodings: Array<{ fix: string }> }).decodings[0]!.fix).toBe(
        "Upgrade the node and toolkit to 2.1.300 or later, which Mainnet runs on this runtime. The support matrix gives no version for Preview.",
      );
      const compact = decodeCommand([], { json: true, raw: "ContractModuleProvider", network: "preview" });
      const [message] = (compact.data as { decodings: Array<{ description: string; fix: string }> }).decodings;
      expect(message!.description).toContain("The support matrix doesn't say which ledger Preview runs.");
      expect(message!.description).not.toContain("undefined");
      expect(message!.fix).toMatch(/^Check it with midnight-cast versions preview before changing the Compact toolchain/);
      // A row the override adds for local doesn't change the advice about the public networks, but is used when named.
      const general = decodeCommand([], { json: true, raw: "ContractModuleProvider" });
      expect(JSON.stringify(general.data)).not.toContain("Local");
      const named = decodeCommand([], { json: true, raw: "ContractModuleProvider", network: "local" });
      expect((named.data as { decodings: Array<{ description: string }> }).decodings[0]!.description).toContain("Local still runs Ledger 8");
      const mainnet = decodeCommand([], { json: true, raw: "ContractModuleProvider", network: "mainnet" });
      expect((mainnet.data as { decodings: Array<{ description: string }> }).decodings[0]!.description).toContain(
        "The support matrix doesn't say which ledger Mainnet runs.",
      );
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("decodes system transaction code 211 (added in ledger 8.1)", () => {
    const result = decodeCommand(["211"], { json: true });
    expect(result.ok).toBe(true);
    expect((result.data as { name: string }).name).toBe("MerkleTreeError");
  });

  it("decodes hex ledger code 0xAA", () => {
    const result = decodeCommand(["0xaa"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { code: number };
    expect(data.code).toBe(170);
  });

  it("decodes ledger by name", () => {
    const result = decodeCommand(
      ["InvalidDustSpendProof"],
      { json: true },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { name: string };
    expect(data.name).toBe("InvalidDustSpendProof");
  });

  it("decodes ledger subcommand", () => {
    const result = decodeCommand(["ledger", "154"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { name: string };
    expect(data.name).toBe("BlockLimitExceededError");
  });

  it("decodes 1010 envelope", () => {
    const result = decodeCommand(["1010"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { code: number; name: string; steps: string[] };
    expect(data.code).toBe(1010);
    expect(data.name).toBe("InvalidTransaction");
    expect(data.steps.length).toBeGreaterThan(0);
  });

  it("decodes pallet by index and variant", () => {
    const result = decodeCommand(["pallet", "5", "3"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as {
      kind: string;
      palletName: string;
      variantName: string;
    };
    expect(data.kind).toBe("pallet");
    expect(data.palletName).toBe("pallet_midnight");
    expect(data.variantName).toBe("Transaction");
  });

  it("decodes pallet by name", () => {
    const result = decodeCommand(
      ["pallet", "pallet_midnight", "Transaction"],
      { json: true },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { variant: number; innerHint?: string };
    expect(data.variant).toBe(3);
    expect(data.innerHint).toContain("Custom(N)");
  });

  it("groups transcript version codes 179-181", () => {
    const result = decodeCommand(["179"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { relatedHint?: string };
    expect(data.relatedHint).toContain("180");
    expect(data.relatedHint).toContain("181");
  });

  it("fails on unknown decode network", () => {
    const result = decodeCommand(["170"], { json: true, network: "bogus" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown network");
  });

  it("rejects oversized --raw input", () => {
    const result = decodeCommand([], {
      json: true,
      raw: "x".repeat(20_000),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("too long");
  });

  it("routes Compact/SDK-style --raw to other tooling", () => {
    const result = decodeCommand([], {
      json: true,
      raw: "Implicit disclosure of witness value in Compact circuit",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Compact");
  });

  it("decodes jsonrpc -32602", () => {
    const result = decodeCommand(["jsonrpc", "-32602"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { name: string };
    expect(data.name).toBe("INVALID_PARAMS");
  });

  it("decodes jsonrpc 32602 without minus sign", () => {
    const result = decodeCommand(["jsonrpc", "32602"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { name: string };
    expect(data.name).toBe("INVALID_PARAMS");
  });

  it("fails on unknown ledger code", () => {
    const result = decodeCommand(["999"], { json: true });
    expect(result.ok).toBe(false);
  });

  it("decodes --raw error string", () => {
    const result = decodeCommand([], {
      json: true,
      raw: "1010: Invalid Transaction: Custom error: 170",
    });
    expect(result.ok).toBe(true);
    const data = result.data as {
      parsed: { ledgerCodes: string[] };
      decodings: unknown[];
    };
    expect(data.parsed.ledgerCodes).toContain("170");
    expect(data.decodings.length).toBeGreaterThanOrEqual(2);
  });

  it("decodes --raw json-rpc error", () => {
    const result = decodeCommand([], {
      json: true,
      raw: '{"error":{"code":-32602,"message":"Invalid params"}}',
    });
    expect(result.ok).toBe(true);
    const data = result.data as { decodings: Array<{ kind: string }> };
    expect(data.decodings.some((d) => d.kind === "jsonrpc")).toBe(true);
  });

  it("decodes --raw ledger error name", () => {
    const result = decodeCommand([], {
      json: true,
      raw: "segment failed: InvalidDustSpendProof",
    });
    expect(result.ok).toBe(true);
    const data = result.data as { decodings: Array<{ code: number }> };
    expect(data.decodings.some((d) => d.code === 170)).toBe(true);
  });

  it("decodes --raw bare ledger code", () => {
    const result = decodeCommand([], {
      json: true,
      raw: "186",
    });
    expect(result.ok).toBe(true);
    const data = result.data as { decodings: Array<{ code: number }> };
    expect(data.decodings[0]?.code).toBe(186);
  });
});
