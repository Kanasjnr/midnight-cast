import { describe, expect, it } from "vitest";
import { isNetworkName, splitRpcPositionalArgs } from "../src/lib/network-arg.js";

describe("network-arg", () => {
  it("recognizes builtin network names", () => {
    expect(isNetworkName("preprod")).toBe(true);
    expect(isNetworkName("bogus")).toBe(false);
  });

  it("treats lone network token as rpc network arg", () => {
    expect(splitRpcPositionalArgs("preprod", undefined)).toEqual({
      params: undefined,
      network: "preprod",
    });
  });

  it("keeps json params separate from network", () => {
    expect(splitRpcPositionalArgs("[]", "preprod")).toEqual({
      params: "[]",
      network: "preprod",
    });
  });
});
