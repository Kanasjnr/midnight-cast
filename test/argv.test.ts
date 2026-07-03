import { describe, expect, it } from "vitest";
import { normalizeArgv } from "../src/lib/argv.js";

describe("normalizeArgv", () => {
  it("rewrites negative jsonrpc code to --code=", () => {
    expect(
      normalizeArgv(["node", "cli.js", "decode", "jsonrpc", "-32602", "--json"]),
    ).toEqual([
      "node",
      "cli.js",
      "decode",
      "jsonrpc",
      "--code=-32602",
      "--json",
    ]);
  });

  it("leaves positive jsonrpc code unchanged", () => {
    expect(
      normalizeArgv(["node", "cli.js", "decode", "jsonrpc", "32602"]),
    ).toEqual(["node", "cli.js", "decode", "jsonrpc", "32602"]);
  });

  it("leaves unrelated argv unchanged", () => {
    const argv = ["node", "cli.js", "ping", "preprod"];
    expect(normalizeArgv(argv)).toEqual(argv);
  });
});
