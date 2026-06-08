import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";

describe("decodeCommand", () => {
  it("decodes numeric ledger code 170", () => {
    const result = decodeCommand(["170"], { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { kind: string; code: number; name: string };
    expect(data.kind).toBe("ledger");
    expect(data.code).toBe(170);
    expect(data.name).toBe("InvalidDustSpendProof");
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
    const data = result.data as { variant: number };
    expect(data.variant).toBe(3);
  });

  it("decodes jsonrpc -32602", () => {
    const result = decodeCommand(["jsonrpc", "-32602"], { json: true });
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
      parsed: { ledgerCode: string };
      decodings: unknown[];
    };
    expect(data.parsed.ledgerCode).toBe("170");
    expect(data.decodings.length).toBeGreaterThanOrEqual(2);
  });
});
