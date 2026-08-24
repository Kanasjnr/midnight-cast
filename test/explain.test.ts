import { describe, expect, it } from "vitest";
import { explainCommand } from "../src/commands/explain.js";

describe("explainCommand", () => {
  it("explains dust", () => {
    const result = explainCommand("dust", { json: true });
    expect(result.ok).toBe(true);
    expect((result.data as { topic: string }).topic).toBe("dust");
  });

  it("explains 1010 and versions", () => {
    expect(explainCommand("1010", { json: true }).ok).toBe(true);
    expect(explainCommand("versions", { json: true }).ok).toBe(true);
    expect(explainCommand("transcript", { json: true }).ok).toBe(true);
  });

  it("rejects unknown topics", () => {
    const result = explainCommand("wallet", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dust");
  });
});
