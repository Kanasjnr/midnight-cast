import { describe, expect, it } from "vitest";
import { parseRawErrorMessage } from "../src/lib/error-parse.js";

describe("parseRawErrorMessage", () => {
  it("extracts 1010 and custom ledger code", () => {
    const parsed = parseRawErrorMessage(
      "1010: Invalid Transaction: Custom error: 186",
    );
    expect(parsed.substrate1010).toBe(true);
    expect(parsed.ledgerCode).toBe("186");
  });

  it("extracts pallet module index and error", () => {
    const parsed = parseRawErrorMessage(
      "DispatchError::Module { index: 5, error: 3 }",
    );
    expect(parsed.palletIndex).toBe("5");
    expect(parsed.palletVariant).toBe("3");
  });
});
