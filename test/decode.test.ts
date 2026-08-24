import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";

describe("decodeCommand", () => {
  it("decodes numeric ledger code 170", () => {
    const result = decodeCommand(["170"], { json: true, network: "preview" });
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
    expect(data.ledger).toBe("8.0.3");
    expect(data.networkLedger).toBe("8.1.0");
    expect(data.mapMismatch).toContain("8.1.0");
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
