import { describe, expect, it } from "vitest";
import { getTransaction } from "../src/lib/transaction.js";

const integration = process.env.INTEGRATION === "1";
const PREPROD_INDEXER =
  "https://indexer.preprod.midnight.network/api/v4/graphql";

// Block 909000 on preprod (stable enough for integration smoke test)
const SAMPLE_TX_HASH =
  "e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c";

describe.skipIf(!integration)("getTransaction", () => {
  it("finds transaction by hash on preprod", async () => {
    const tx = await getTransaction(PREPROD_INDEXER, {
      hash: SAMPLE_TX_HASH,
    });
    expect(tx).not.toBeNull();
    expect(tx!.id).toBe(232830);
    expect(tx!.hash).toBe(SAMPLE_TX_HASH);
    expect(tx!.status).toBeDefined();
    expect(tx!.blockHeight).toBe(909000);
  });

  it("returns null for unknown hash", async () => {
    const tx = await getTransaction(PREPROD_INDEXER, {
      hash: "0x" + "00".repeat(32),
    });
    expect(tx).toBeNull();
  });
});
