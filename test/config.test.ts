import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initConfig,
  loadConfigFile,
  resolveNetwork,
} from "../src/config.js";

const testConfigDir = join(tmpdir(), `midnight-cast-test-${process.pid}`);

describe("config", () => {
  const prevXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    mkdirSync(testConfigDir, { recursive: true });
    process.env.XDG_CONFIG_HOME = testConfigDir;
  });

  afterEach(() => {
    if (prevXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = prevXdg;
    }
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("init writes config and resolve merges defaults", () => {
    const path = initConfig({ network: "preprod" });
    expect(path).toContain("midnight-cast/config.toml");

    const resolved = resolveNetwork("preprod");
    expect(resolved.rpc).toContain("preprod");
    expect(resolved.indexerHttp).toContain("preprod");

    const file = loadConfigFile();
    expect(file.defaults?.network).toBe("preprod");
  });

  it("MN_NETWORK overrides default network", () => {
    initConfig({ network: "preprod" });
    process.env.MN_NETWORK = "preview";
    const resolved = resolveNetwork();
    expect(resolved.network).toBe("preview");
    delete process.env.MN_NETWORK;
  });

  it("per-flag URL overrides file", () => {
    initConfig({ network: "preprod" });
    const custom = "https://custom-rpc.example";
    const resolved = resolveNetwork("preprod", { rpc: custom });
    expect(resolved.rpc).toBe(custom);
  });

  it("custom network section in toml", () => {
    const configPath = join(testConfigDir, "midnight-cast", "config.toml");
    mkdirSync(join(testConfigDir, "midnight-cast"), { recursive: true });
    writeFileSync(
      configPath,
      `
[defaults]
network = "staging"

[networks.staging]
network_id = "staging"
rpc = "https://rpc.staging.example"
indexer_http = "https://indexer.staging.example/graphql"
indexer_ws = "wss://indexer.staging.example/graphql/ws"
`,
    );
    const resolved = resolveNetwork();
    expect(resolved.network).toBe("staging");
    expect(resolved.rpc).toBe("https://rpc.staging.example");
  });
});
