import { describe, expect, it } from "vitest";
import { packageProblems, quoteForCmd } from "../scripts/smoke-tarball.js";

describe("package contents", () => {
  const complete = [
    "package.json",
    "dist/cli.js",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
    "dist/data/error-codes.json",
    "schemas/envelope.schema.json",
  ];

  it("passes a package with every data file and schema", () => {
    expect(packageProblems(complete, ["error-codes.json"], ["envelope.schema.json"])).toEqual([]);
  });

  it("names missing data files, schemas and notices", () => {
    const packed = complete.filter((f) => !f.startsWith("dist/data") && f !== "NOTICE");
    expect(packageProblems(packed, ["error-codes.json"], ["envelope.schema.json"])).toEqual([
      "missing NOTICE",
      "missing dist/data/error-codes.json",
    ]);
  });

  it("rejects sources, tests and fixtures", () => {
    expect(packageProblems([...complete, "test/fixtures/preview/responses.json"], ["error-codes.json"], ["envelope.schema.json"]))
      .toEqual(["should not ship test/fixtures/preview/responses.json"]);
  });

  it("quotes arguments with spaces for cmd.exe", () => {
    expect(quoteForCmd("decode")).toBe("decode");
    expect(quoteForCmd("1010: Invalid Transaction: Custom error: 171")).toBe('"1010: Invalid Transaction: Custom error: 171"');
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
  });
});
