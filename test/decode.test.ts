import { describe, expect, it } from "vitest";
import { decodeCommand } from "../src/commands/decode.js";

describe("decodeCommand", () => {
  it("decodes numeric code 170", () => {
    const result = decodeCommand("170", { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { code: number; name: string };
    expect(data.code).toBe(170);
    expect(data.name).toBe("InvalidDustSpendProof");
  });

  it("decodes hex code 0xAA", () => {
    const result = decodeCommand("0xaa", { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { code: number };
    expect(data.code).toBe(170);
  });

  it("decodes by name", () => {
    const result = decodeCommand("InvalidDustSpendProof", { json: true });
    expect(result.ok).toBe(true);
    const data = result.data as { name: string };
    expect(data.name).toBe("InvalidDustSpendProof");
  });

  it("fails on unknown code", () => {
    const result = decodeCommand("999", { json: true });
    expect(result.ok).toBe(false);
  });
});
