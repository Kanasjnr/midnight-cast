import { describe, expect, it } from "vitest";
import { checkEndpoints, narrowDown, targetArgs, toolCallFor } from "../src/lib/next-steps.js";

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

  it("map a suggested command to the MCP tool call that does the same", () => {
    expect(toolCallFor("midnight-cast explain 1010")).toEqual({ name: "explain", arguments: { topic: "1010" } });
    expect(toolCallFor("midnight-cast ping preprod")).toEqual({ name: "ping", arguments: { network: "preprod" } });
    expect(toolCallFor("midnight-cast dust-event 1586607 preprod")).toEqual({
      name: "dust_event",
      arguments: { id: 1586607, network: "preprod" },
    });
    expect(toolCallFor("midnight-cast block latest mainnet")).toEqual({ name: "block", arguments: { network: "mainnet" } });
    expect(toolCallFor("midnight-cast decode 170")).toEqual({ name: "decode", arguments: { message: "170" } });
  });

  it("give no tool call when something must be filled in or the endpoints were overridden", () => {
    expect(toolCallFor('midnight-cast decode --raw "<wallet or node error>"')).toBeUndefined();
    expect(toolCallFor("midnight-cast decode ledger <N>")).toBeUndefined();
    expect(toolCallFor("midnight-cast versions <network>")).toBeUndefined();
    expect(toolCallFor("midnight-cast ping preprod --rpc http://my-node:9944")).toBeUndefined();
    expect(toolCallFor("midnight-cast config show --network preprod")).toBeUndefined();
  });
});
