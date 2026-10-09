import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";

function decodeRaw(raw: string, network?: string) {
  const result = decodeCommand([], { json: true, raw, ...(network ? { network } : {}) });
  const data = result.data as { decodings: Array<Record<string, unknown>> };
  return { ok: result.ok, decodings: data?.decodings ?? [], next: (result.next ?? []).map((s) => s.command) };
}

describe("decode --raw recognises messages from current tooling", () => {
  it("UnsupportedBlockVersion from toolkit 1.0.0 on runtime 1.0.300", () => {
    const result = decodeRaw("Error: UnsupportedBlockVersion(1000300)", "preprod");
    expect(result.decodings).toEqual([
      expect.objectContaining({ kind: "message", id: "unsupported-block-version", fix: "Upgrade the node and toolkit to 1.0.400, which Preview, Preprod and Mainnet run on runtime 1.0.300." }),
    ]);
    expect(result.next).toEqual(["midnight-cast versions preprod"]);
  });

  it("the indexer's wording of the same error, for another runtime", () => {
    const result = decodeRaw("Unsupported node version 2000000");
    expect(result.decodings).toEqual([
      expect.objectContaining({ id: "unsupported-block-version", description: expect.stringContaining("2000000") }),
    ]);
  });

  it("Blockfrost without a project token", () => {
    const result = decodeRaw(
      '{"error":"Forbidden","message":"Missing project token. Please include project_id in your request.","status_code":403}',
    );
    expect(result.decodings).toEqual([expect.objectContaining({ id: "blockfrost-missing-token" })]);
    expect(result.next).toEqual(["midnight-cast config show --network <network>"]);
  });

  it("Blockfrost with a wrong or other-network token", () => {
    const result = decodeRaw('{"error":"Forbidden","message":"Invalid project token.","status_code":403}', "preprod");
    expect(result.decodings).toEqual([expect.objectContaining({ id: "blockfrost-invalid-token" })]);
    expect(result.next).toEqual(["midnight-cast config show --network preprod"]);
  });

  it("a failure from a retired mainnet or preprod host", () => {
    const mainnet = decodeRaw("getaddrinfo ENOTFOUND indexer.mainnet.midnight.network");
    expect(mainnet.decodings).toEqual([expect.objectContaining({ id: "retired-midnight-host", name: "Retired mainnet endpoint" })]);
    expect(mainnet.next).toEqual(["midnight-cast config init --network mainnet"]);
    // What the preprod indexer answers since its shutdown, with HTTP 410.
    const preprod = decodeRaw(
      '{"errors":[{"message":"indexer.preprod.midnight.network was decommissioned on 2026-10-09. Use indexer.preprod.shielded.tools, or the Blockfrost-hosted indexer.","extensions":{"code":"ENDPOINT_DECOMMISSIONED"}}],"data":null}',
    );
    expect(preprod.decodings).toEqual([
      expect.objectContaining({ id: "retired-midnight-host", description: expect.stringContaining("retired on 2026-10-09"), fix: expect.stringContaining("Midnight Preprod project ID") }),
    ]);
    expect(preprod.next).toEqual(["midnight-cast config init --network preprod"]);
  });

  it("output from Compact 0.35, which targets ledger 9", () => {
    for (const raw of [
      "this circuit requires --feature-zkir-v3",
      "proof server does not support ZKIR 3.1",
      "TypeError: ContractModuleProvider.resolve is not a function",
      "Cannot find module '@midnight-ntwrk/ledger-v9'",
      '"@midnight-ntwrk/compact-runtime": "^0.20.0"',
      "compact-runtime@~0.20.1",
    ]) {
      expect(decodeRaw(raw).decodings, raw).toEqual([expect.objectContaining({ id: "compact-ledger-9" })]);
    }
  });

  it("OutOfDustValidityWindow notes the first-in-block indexer bug", () => {
    const result = decodeRaw("1010: Invalid Transaction: Custom error: 171", "preprod");
    expect(result.decodings.map((d) => d.kind)).toEqual(["substrate", "ledger"]);
    expect(result.decodings[1]).toMatchObject({ name: "OutOfDustValidityWindow", relatedHint: expect.stringContaining("4.3.5") });
    expect(result.next).toContain("midnight-cast versions preprod");
  });

  it("TransactionApplicationError notes the node 1.0.300 mainnet sync halt", () => {
    const result = decodeRaw("Transaction(3) failed due to Invalid(Custom(182)). Aborting the rest of the block execution.", "mainnet");
    expect(result.decodings).toEqual([
      expect.objectContaining({ code: 182, name: "TransactionApplicationError", relatedHint: expect.stringContaining("#1788979") }),
    ]);
    expect(result.next).toContain("midnight-cast versions mainnet");
    expect(decodeRaw("Invalid(Custom(182))", "preprod").decodings[0]).not.toHaveProperty("relatedHint");
  });

  it("deserialization codes note the stricter encoding of ledgers 8.1.2 and 8.1.3", () => {
    const result = decodeRaw("1010: Invalid Transaction: Custom error: 1");
    expect(result.decodings[1]).toMatchObject({ code: 1, relatedHint: expect.stringContaining("8.1.2") });
    expect(result.decodings[1]).toMatchObject({ relatedHint: expect.stringContaining("Since ledger 8.1.3 (node 1.0.400)") });
  });

  it("reads \"ledger N\" as a code only when the text says it is one", () => {
    expect(decodeRaw("ledger error 9").decodings).toEqual([expect.objectContaining({ kind: "ledger", code: 9 })]);
    expect(decodeRaw("compact-runtime 0.20.0 targets ledger 9").decodings).toEqual([
      expect.objectContaining({ id: "compact-ledger-9" }),
    ]);
    expect(decodeRaw("rejected by ledger 8.1.2").ok).toBe(false);
  });

  it("still fails for text it doesn't know", () => {
    expect(decodeRaw("something unrelated went wrong").ok).toBe(false);
  });
});
