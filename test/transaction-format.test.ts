import { describe, expect, it } from "vitest";
import { formatTransactionHuman } from "../src/lib/transaction.js";

describe("formatTransactionHuman", () => {
  it("hints decode --raw when a segment failed", () => {
    const text = formatTransactionHuman({
      typename: "RegularTransaction",
      id: 1,
      hash: "0xabc",
      protocolVersion: 1,
      blockHeight: 100,
      blockHash: "0xdef",
      status: "Failed",
      segments: [{ id: 0, success: false }],
      dustLedgerEvents: [],
      zswapLedgerEvents: [],
      contractActions: [],
    });
    expect(text).toContain("indexer v4 exposes segment success only");
    expect(text).toContain("mn decode --raw");
  });

  it("links dust-event commands for DUST ledger events", () => {
    const text = formatTransactionHuman({
      typename: "RegularTransaction",
      id: 1,
      hash: "0xabc",
      protocolVersion: 1,
      blockHeight: 100,
      blockHash: "0xdef",
      dustLedgerEvents: [{ id: 42, typename: "DustSpend" }],
      zswapLedgerEvents: [],
      contractActions: [],
    });
    expect(text).toContain("DUST:");
    expect(text).toContain("mn dust-event 42");
  });
});
