import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";

function decodeRaw(raw: string, network?: string) {
  const result = decodeCommand([], { json: true, raw, ...(network ? { network } : {}) });
  const data = result.data as { decodings: Array<Record<string, unknown>> };
  return { ok: result.ok, decodings: data?.decodings ?? [], next: (result.next ?? []).map((s) => s.command) };
}

describe("decode notes on ledger codes", () => {
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
});
