import { describe, expect, it } from "vitest";
import { parseIntOrFail } from "../src/lib/parse-int.js";

describe("parseIntOrFail", () => {
  it("accepts valid integers", () => {
    expect(parseIntOrFail("100", "threshold")).toBe(100);
    expect(parseIntOrFail("-32602", "code")).toBe(-32602);
  });

  it("rejects non-numeric input", () => {
    const result = parseIntOrFail("abc", "threshold");
    expect(result).toEqual({ error: 'Invalid threshold: "abc" (expected integer)' });
  });

  it("enforces min and max", () => {
    expect(parseIntOrFail("0", "limit", { min: 1 })).toEqual({
      error: "Invalid limit: 0 (minimum 1)",
    });
    expect(parseIntOrFail("2000", "limit", { max: 1000 })).toEqual({
      error: "Invalid limit: 2000 (maximum 1000)",
    });
  });
});
