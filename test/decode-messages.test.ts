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
      expect.objectContaining({ kind: "message", id: "unsupported-block-version", fix: "Upgrade the node and toolkit to 1.0.300 or newer." }),
    ]);
    expect(result.next).toEqual(["midnight-cast versions preprod"]);
  });

  it("the indexer's wording of the same error, for another runtime", () => {
    const result = decodeRaw("indexer received a block made with unsupported node version 2000000");
    expect(result.decodings).toEqual([
      expect.objectContaining({ id: "unsupported-block-version", description: expect.stringContaining("2000000") }),
    ]);
  });

  it("Blockfrost without a project token", () => {
    const result = decodeRaw(
      '{"error":"Forbidden","message":"Missing project token. Please include project_id in your request.","status_code":403}',
    );
    expect(result.decodings).toEqual([expect.objectContaining({ id: "blockfrost-missing-token" })]);
    expect(result.next).toEqual(["midnight-cast config show --network mainnet"]);
  });

  it("Blockfrost with a wrong or other-network token", () => {
    const result = decodeRaw('{"error":"Forbidden","message":"Invalid project token.","status_code":403}');
    expect(result.decodings).toEqual([expect.objectContaining({ id: "blockfrost-invalid-token" })]);
  });

  it("a failure from a retired mainnet host", () => {
    const result = decodeRaw("getaddrinfo ENOTFOUND indexer.mainnet.midnight.network");
    expect(result.decodings).toEqual([expect.objectContaining({ id: "retired-mainnet-host" })]);
    expect(result.next).toEqual(["midnight-cast config init --network mainnet"]);
  });

  it("output from Compact 0.35, which targets ledger 9", () => {
    for (const raw of [
      "this circuit requires --feature-zkir-v3",
      "proof server does not support ZKIR 3.1",
      "TypeError: ContractModuleProvider.resolve is not a function",
      "Cannot find module '@midnight-ntwrk/ledger-v9'",
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

  it("deserialization codes note ledger 8.1.2's stricter encoding", () => {
    const result = decodeRaw("1010: Invalid Transaction: Custom error: 1");
    expect(result.decodings[1]).toMatchObject({ code: 1, relatedHint: expect.stringContaining("8.1.2") });
  });

  it("leaves \"ledger 9\" to the ledger code parser", () => {
    expect(decodeRaw("ledger 9").decodings).toEqual([expect.objectContaining({ kind: "ledger", code: 9 })]);
  });

  it("still fails for text it doesn't know", () => {
    expect(decodeRaw("something unrelated went wrong").ok).toBe(false);
  });
});
