import { describe, expect, it } from "vitest";
import { missingProjectIdError } from "../src/lib/blockfrost.js";
import { NetworkError } from "../src/lib/network-error.js";
import { runAsMcpCall } from "../src/lib/surface.js";

describe("messages for MCP calls", () => {
  it("say where an MCP server gets the Blockfrost ID instead of naming CLI flags", () => {
    expect(missingProjectIdError("mainnet")).toContain("--project-id");
    const mcp = runAsMcpCall(() => missingProjectIdError("mainnet"));
    expect(mcp).toContain("this server's env in the MCP client's configuration");
    expect(mcp).not.toContain("--project-id");
  });

  it("drop flag advice from network hints", () => {
    const cli = new NetworkError("RPC unreachable", "timeout", "RPC").hint!;
    const mcp = runAsMcpCall(() => new NetworkError("RPC unreachable", "timeout", "RPC").hint!);
    expect(cli).toContain("--rpc");
    expect(mcp).not.toMatch(/--\w/);
  });
});
