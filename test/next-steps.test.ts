import { describe, expect, it } from "vitest";
import { checkEndpoints, narrowDown, targetArgs } from "../src/lib/next-steps.js";

describe("next steps", () => {
  it("keep endpoint overrides so the suggestion rechecks the same endpoints", () => {
    expect(targetArgs("preprod", { rpc: "http://my-node:9944", indexerHttp: "https://idx/api/v4/graphql" })).toBe(
      "preprod --rpc http://my-node:9944 --indexer-http https://idx/api/v4/graphql",
    );
    expect(narrowDown("preprod", { indexerWs: "ws://idx/ws" }, { services: true, sync: false })).toEqual([
      expect.objectContaining({ command: "midnight-cast ping preprod --indexer-ws ws://idx/ws" }),
    ]);
  });

  it("quote values the shell would split", () => {
    expect(targetArgs("local", { rpc: "http://h/a b" })).toBe("local --rpc 'http://h/a b'");
    expect(targetArgs("local", { rpc: "http://h/it's" })).toBe(`local --rpc 'http://h/it'\\''s'`);
  });

  it("never copy the project ID", () => {
    expect(targetArgs("mainnet", { projectId: "secret" })).toBe("mainnet");
  });

  it("skip config show when the endpoints came from flags", () => {
    expect(checkEndpoints("preprod", {})).toHaveLength(1);
    expect(checkEndpoints("preprod", { rpc: "http://my-node:9944" })).toEqual([]);
  });
});
