import { afterEach, describe, expect, it } from "vitest";
import { resolveNetwork } from "../src/config.js";
import { formatTransactionHuman, getTransaction } from "../src/lib/transaction.js";

const integration = process.env.INTEGRATION === "1";

// Block 909000 on preprod (stable enough for integration smoke test)
const SAMPLE_TX_HASH =
  "e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c";

describe.skipIf(!integration)("getTransaction", () => {
  it("finds transaction by hash on preprod", async () => {
    const tx = await getTransaction(resolveNetwork("preprod").indexerHttp, {
      hash: SAMPLE_TX_HASH,
    });
    expect(tx).not.toBeNull();
    // Transaction ids are each indexer's own numbering, and Blockfrost's differs from Midnight's retired one.
    expect(tx!.id).toEqual(expect.any(Number));
    expect(tx!.hash).toBe(SAMPLE_TX_HASH);
    expect(tx!.status).toBeDefined();
    expect(tx!.blockHeight).toBe(909000);
  });

  it("returns null for unknown hash", async () => {
    const tx = await getTransaction(resolveNetwork("preprod").indexerHttp, {
      hash: "0x" + "00".repeat(32),
    });
    expect(tx).toBeNull();
  });
});

describe("getTransaction's field mapping", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const indexer = "http://indexer.test/api/v4/graphql";
  const answer = (transaction: object) => {
    const body = JSON.stringify({ data: { transactions: [transaction] } });
    globalThis.fetch = (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  };
  const common = { id: 7, hash: "0xabc", protocolVersion: 22000, block: { height: 5, hash: "0xdef" }, dustLedgerEvents: [], zswapLedgerEvents: [], contractActions: [] };

  // Every recorded transaction has a fee of 1 and equal indexes, so these use values that tell the fields apart.
  it("reads the fee and the zswap indexes from the fields the indexer hasn't deprecated", async () => {
    answer({ ...common, __typename: "RegularTransaction", fee: "123", zswapStartIndex: 10, zswapEndIndex: 14 });
    const tx = await getTransaction(indexer, { hash: "abc" });
    expect(tx).toMatchObject({ fees: { paidFees: "123", estimatedFees: "123" }, startIndex: 10, endIndex: 14 });
    expect(formatTransactionHuman(tx!)).toContain("Fees:     paid=123\n");
    expect(formatTransactionHuman(tx!)).toContain("ZswapIdx: 10 → 14");
  });

  it("leaves fees out for a transaction that has none", async () => {
    answer({ ...common, __typename: "SystemTransaction" });
    const tx = await getTransaction(indexer, { hash: "abc" });
    expect(tx).not.toHaveProperty("fees");
    expect(formatTransactionHuman(tx!)).not.toContain("Fees:");
  });
});
