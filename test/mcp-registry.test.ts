import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));

describe("MCP Registry entry", () => {
  const server = read("server.json");
  const pkg = read("package.json");

  it("matches the registry's server.json schema", () => {
    // The schema's formats are URIs and dates; ajv-formats isn't a dependency, so they aren't checked here.
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    const validate = ajv.compile(read("test/fixtures/mcp-registry/server.schema.json"));
    expect(validate(server), JSON.stringify(validate.errors)).toBe(true);
    expect(server.$schema).toBe(read("test/fixtures/mcp-registry/server.schema.json").$id);
  });

  it("names the npm package by the mcpName the registry checks, in the GitHub owner's namespace", () => {
    // The registry compares these exactly, and grants publishing to io.github.<owner> as GitHub spells the owner.
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toBe(`io.github.${new URL(pkg.repository.url.replace(/^git\+/, "")).pathname.split("/")[1]}/midnight-cast`);
    expect(server.packages).toEqual([expect.objectContaining({ registryType: "npm", identifier: pkg.name, transport: { type: "stdio" } })]);
  });

  it("is at the package's version, which the registry looks up on npm", () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it("starts the server the way the docs do, with a Blockfrost key per network as optional secrets", () => {
    expect(server.packages[0].packageArguments).toEqual([{ type: "positional", value: "mcp" }]);
    expect(server.packages[0].environmentVariables).toEqual([
      expect.objectContaining({ name: "BLOCKFROST_PREPROD_PROJECT_ID", isRequired: false, isSecret: true }),
      expect.objectContaining({ name: "BLOCKFROST_MAINNET_PROJECT_ID", isRequired: false, isSecret: true }),
      expect.objectContaining({ name: "MIDNIGHT_CAST_NETWORKS", isRequired: false }),
    ]);
  });
});
