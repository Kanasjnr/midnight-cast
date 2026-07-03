import { describe, expect, it } from "vitest";
import { rpcCommand } from "../src/commands/rpc.js";

const integration = process.env.INTEGRATION === "1";

describe("rpcCommand", () => {
  it("rejects invalid params JSON", async () => {
    const result = await rpcCommand(
      "chain_getHeader",
      "not-json",
      "preprod",
      {},
      { json: true },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid JSON params");
  });

  it.skipIf(!integration)("calls chain_getHeader on preprod", async () => {
    const result = await rpcCommand(
      "chain_getHeader",
      "[]",
      "preprod",
      {},
      { json: true },
    );
    expect(result.ok).toBe(true);
    const data = result.data as { result: { number: string } };
    expect(data.result.number).toMatch(/^0x/i);
  });
});
