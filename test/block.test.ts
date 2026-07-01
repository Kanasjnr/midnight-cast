import { describe, expect, it } from "vitest";
import { blockAtHeightCommand } from "../src/commands/block.js";

describe("blockAtHeightCommand", () => {
  it("rejects invalid height", async () => {
    const result = await blockAtHeightCommand("abc", "preprod", {}, { json: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid block height");
  });

  it("fetches block header at height on preprod", async () => {
    const result = await blockAtHeightCommand("909000", "preprod", {}, { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { height: number; hash: string };
    expect(data.height).toBe(909000);
    expect(data.hash).toMatch(/^0x/i);
  });
});
