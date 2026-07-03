import { describe, expect, it } from "vitest";
import { stripControlChars } from "../src/lib/sanitize.js";

describe("stripControlChars", () => {
  it("removes C0 control bytes but keeps whitespace", () => {
    const input = "hello\u0007world\ntab\there";
    expect(stripControlChars(input)).toBe("helloworld\ntab\there");
  });
});
