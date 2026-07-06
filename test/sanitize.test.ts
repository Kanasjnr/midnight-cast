import { describe, expect, it } from "vitest";
import { stripControlChars, sanitizeDeep } from "../src/lib/sanitize.js";

describe("stripControlChars", () => {
  it("removes C0 control bytes but keeps whitespace", () => {
    const input = "hello\u0007world\ntab\there";
    expect(stripControlChars(input)).toBe("helloworld\ntab\there");
  });

  it("removes ESC and BEL used in terminal spoofing", () => {
    const spoofed = "8.0.3\u001b[31mFAKE\u0007";
    expect(stripControlChars(spoofed)).toBe("8.0.3[31mFAKE");
  });
});

describe("sanitizeDeep", () => {
  it("sanitizes nested data strings", () => {
    const cleaned = sanitizeDeep({
      live: { nodeVersion: "0.22.5\u001b[31mEVIL" },
      table: [{ detail: "version=8.0.3\u0007" }],
    });
    expect(cleaned.live.nodeVersion).toBe("0.22.5[31mEVIL");
    expect(cleaned.table[0]?.detail).toBe("version=8.0.3");
  });
});
