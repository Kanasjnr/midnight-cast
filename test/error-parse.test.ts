import { describe, expect, it } from "vitest";
import {
  findLedgerCodesByName,
  parseRawErrorMessage,
} from "../src/lib/error-parse.js";

describe("parseRawErrorMessage", () => {
  it("extracts 1010 and custom ledger code", () => {
    const parsed = parseRawErrorMessage(
      "1010: Invalid Transaction: Custom error: 186",
    );
    expect(parsed.substrate1010).toBe(true);
    expect(parsed.ledgerCodes).toContain("186");
  });

  it("extracts pallet module index and error", () => {
    const parsed = parseRawErrorMessage(
      "DispatchError::Module { index: 5, error: 3 }",
    );
    expect(parsed.palletModules).toEqual([{ index: "5", variant: "3" }]);
  });

  it("extracts json-rpc code from JSON", () => {
    const parsed = parseRawErrorMessage(
      '{"jsonrpc":"2.0","error":{"code":-32602,"message":"bad param"}}',
    );
    expect(parsed.jsonRpcCodes).toContain("-32602");
  });

  it("extracts hex ledger code", () => {
    const parsed = parseRawErrorMessage("failed with code 0xaa in proof");
    expect(parsed.ledgerCodes).toContain("170");
  });

  it("extracts bare pasted ledger code", () => {
    const parsed = parseRawErrorMessage("170");
    expect(parsed.ledgerCodes).toEqual(["170"]);
  });

  it("dedupes repeated custom codes", () => {
    const parsed = parseRawErrorMessage(
      "Custom error: 170 and Custom(170) again",
    );
    expect(parsed.ledgerCodes).toEqual(["170"]);
  });
});

describe("findLedgerCodesByName", () => {
  it("finds ledger error names in free text", () => {
    const codes = findLedgerCodesByName(
      "proof failed: InvalidDustSpendProof at segment 0",
      { "170": "InvalidDustSpendProof", "1": "Transaction" },
    );
    expect(codes).toEqual(["170"]);
  });
});
