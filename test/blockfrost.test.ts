import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockfrostHttpError,
  isBlockfrostUrl,
  isRetiredUrl,
  takeProjectId,
  withProjectId,
} from "../src/lib/blockfrost.js";
import { initConfig, loadConfigFile, resolveNetwork } from "../src/config.js";
import { redactSecrets, registerSecret } from "../src/lib/sanitize.js";
import { jsonRpc } from "../src/clients/rpc.js";
import { gqlPost } from "../src/clients/indexer.js";
import { detectIndexerApi } from "../src/lib/versions.js";

const TOKEN = "nightmainnetTESTabcdefgh12345678";
const configDir = join(tmpdir(), `midnight-cast-blockfrost-${process.pid}`);
const previousXdg = process.env.XDG_CONFIG_HOME;
const previousToken = process.env.BLOCKFROST_PROJECT_ID;

function writeConfig(toml: string) {
  mkdirSync(join(configDir, "midnight-cast"), { recursive: true });
  writeFileSync(join(configDir, "midnight-cast", "config.toml"), toml);
}

beforeEach(() => {
  mkdirSync(configDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = configDir;
  delete process.env.BLOCKFROST_PROJECT_ID;
});

afterEach(() => {
  if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousXdg;
  if (previousToken === undefined) delete process.env.BLOCKFROST_PROJECT_ID;
  else process.env.BLOCKFROST_PROJECT_ID = previousToken;
  rmSync(configDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("Blockfrost URL helpers", () => {
  it("recognises Blockfrost and retired Midnight hosts", () => {
    expect(isBlockfrostUrl("https://rpc.midnight-mainnet.blockfrost.io")).toBe(true);
    expect(isBlockfrostUrl("https://midnight-mainnet.blockfrost.io/api/v0")).toBe(true);
    expect(isBlockfrostUrl("https://blockfrost.io.evil.example")).toBe(false);
    expect(isBlockfrostUrl("https://rpc.preprod.midnight.network")).toBe(false);
    expect(isRetiredUrl("https://indexer.mainnet.midnight.network/api/v4/graphql")).toBe(true);
    expect(isRetiredUrl("https://indexer.preprod.midnight.network/api/v4/graphql")).toBe(false);
  });

  it("adds, replaces and removes the project_id parameter", () => {
    const withToken = withProjectId("https://midnight-mainnet.blockfrost.io/api/v0", "a1");
    expect(withToken).toBe("https://midnight-mainnet.blockfrost.io/api/v0?project_id=a1");
    expect(withProjectId(withToken, "b2")).toContain("project_id=b2");
    expect(takeProjectId(withToken)).toEqual({
      url: "https://midnight-mainnet.blockfrost.io/api/v0",
      projectId: "a1",
    });
    expect(takeProjectId("https://rpc.preprod.midnight.network")).toEqual({
      url: "https://rpc.preprod.midnight.network",
    });
  });

  it("explains 403 and rate limits, and leaves other statuses alone", () => {
    expect(blockfrostHttpError("RPC", 403)).toMatch(/project token is missing, invalid, or for a different network/);
    expect(blockfrostHttpError("Indexer", 429)).toMatch(/rate-limited/);
    expect(blockfrostHttpError("RPC", 500)).toBeUndefined();
  });

  it("detects the v4 indexer API under Blockfrost's /api/v0", () => {
    expect(detectIndexerApi("https://midnight-mainnet.blockfrost.io/api/v0")).toBe("v4");
    expect(detectIndexerApi("https://midnight-mainnet.blockfrost.io/api/v0?project_id=x")).toBe("v4");
    expect(detectIndexerApi("https://example.com/api/v0")).toBe("unknown");
  });
});

describe("resolving mainnet", () => {
  it("refuses before any request when there is no token", () => {
    expect(() => resolveNetwork("mainnet")).toThrow(/served by Blockfrost and need a project token/);
  });

  it("uses the env var when the network's config has no ID", () => {
    process.env.BLOCKFROST_PROJECT_ID = "nightmainnetFROMENV123456";
    const fromEnv = resolveNetwork("mainnet");
    expect(fromEnv.projectIdSource).toBe("env");
    expect(fromEnv.rpc).toContain("project_id=nightmainnetFROMENV123456");
  });

  it("prefers the network's own config ID over the global env var, and --project-id over both", () => {
    process.env.BLOCKFROST_PROJECT_ID = "nightmainnetFROMENV123456";
    writeConfig(`[networks.mainnet]\nblockfrost_project_id = "nightmainnetFROMCONFIG1234"\n`);
    const fromConfig = resolveNetwork("mainnet");
    expect(fromConfig.projectIdSource).toBe("config");
    expect(fromConfig.rpc).toContain("project_id=nightmainnetFROMCONFIG1234");

    const fromFlag = resolveNetwork("mainnet", { projectId: TOKEN });
    expect(fromFlag.projectIdSource).toBe("flag");
    for (const url of [fromFlag.rpc, fromFlag.rpcWs, fromFlag.indexerHttp, fromFlag.indexerWs]) {
      expect(url).toContain(`project_id=${TOKEN}`);
    }
  });

  it("prefers a project_id in the network's own URLs over the global env var", () => {
    process.env.BLOCKFROST_PROJECT_ID = "nightmainnetFROMENV123456";
    writeConfig(
      `[networks.custom]\nnetwork_id = "custom"\nrpc = "http://127.0.0.1:9944"\n` +
        `indexer_http = "https://midnight-mainnet.blockfrost.io/api/v0?project_id=nightpreprodOWNURL12345"\n` +
        `indexer_ws = "wss://midnight-mainnet.blockfrost.io/api/v0/ws?project_id=nightpreprodOWNURL12345"\n`,
    );
    const resolved = resolveNetwork("custom");
    expect(resolved.projectIdSource).toBe("url");
    expect(resolved.indexerHttp).toContain("nightpreprodOWNURL12345");
    expect(resolved.indexerHttp).not.toContain("FROMENV");
  });

  it("keeps a token already written into a configured URL unless one is given explicitly", () => {
    writeConfig(
      `[networks.mainnet]\nrpc = "https://rpc.midnight-mainnet.blockfrost.io?project_id=nightmainnetINURL12345678"\n`,
    );
    const resolved = resolveNetwork("mainnet");
    expect(resolved.projectIdSource).toBe("url");
    expect(resolved.indexerHttp).toContain("project_id=nightmainnetINURL12345678");
    expect(resolveNetwork("mainnet", { projectId: TOKEN }).rpc).toContain(`project_id=${TOKEN}`);
  });

  it("can resolve mainnet without a token when one isn't required", () => {
    const resolved = resolveNetwork("mainnet", {}, { requireProjectId: false });
    expect(resolved.projectIdSource).toBeUndefined();
    expect(resolved.rpc).not.toContain("project_id");
  });

  it("keeps a saved project ID when config init rewrites the network", () => {
    writeConfig(`[networks.mainnet]\nblockfrost_project_id = "nightmainnetSAVED1234567"\n`);
    initConfig({ network: "mainnet" });
    expect(loadConfigFile().networks?.mainnet?.blockfrost_project_id).toBe("nightmainnetSAVED1234567");
  });

  it("leaves non-Blockfrost networks untouched", () => {
    const preprod = resolveNetwork("preprod", { projectId: TOKEN });
    expect(preprod.projectIdSource).toBeUndefined();
    expect(preprod.rpc).toBe("https://rpc.preprod.midnight.network");
  });

  it("doesn't need a token for self-hosted mainnet endpoints", () => {
    const resolved = resolveNetwork("mainnet", {
      rpc: "http://127.0.0.1:9944",
      rpcWs: "ws://127.0.0.1:9944",
      indexerHttp: "http://127.0.0.1:8088/api/v4/graphql",
      indexerWs: "ws://127.0.0.1:8088/api/v4/graphql/ws",
    });
    expect(resolved.projectIdSource).toBeUndefined();
  });
});

describe("sending the token", () => {
  it("moves project_id from the URL into the header for RPC and indexer requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "2.1.0" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { block: { height: 1 } } })));
    vi.stubGlobal("fetch", fetchMock);

    await jsonRpc(withProjectId("https://rpc.midnight-mainnet.blockfrost.io", TOKEN), "system_version");
    await gqlPost(withProjectId("https://midnight-mainnet.blockfrost.io/api/v0", TOKEN), "query { block { height } }");

    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).not.toContain(TOKEN);
      expect(init.headers).toMatchObject({ project_id: TOKEN });
    }
  });

  it("reports a rejected token in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
    await expect(
      jsonRpc(withProjectId("https://rpc.midnight-mainnet.blockfrost.io", "nightmainnetWRONG12345"), "system_version"),
    ).rejects.toThrow(/rejected by Blockfrost \(403\)/);
  });
});

describe("redaction", () => {
  it("hides registered tokens, project_id parameters and Blockfrost-shaped IDs", () => {
    registerSecret("customSecretValue99");
    const text =
      "rpc=https://rpc.midnight-mainnet.blockfrost.io/?project_id=abc123&x=1 " +
      "encoded=project_id%3Dabc123 id=nightpreprodABCDEFGH1234 secret=customSecretValue99";
    const redacted = redactSecrets(text);
    expect(redacted).toContain("project_id=***&x=1");
    expect(redacted).toContain("project_id%3D***");
    expect(redacted).not.toMatch(/abc123|nightpreprod|customSecretValue99/);
  });
});

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "cli.js");

async function runCli(args: string[], env: Record<string, string>) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cli, ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: configDir, ...env },
      timeout: 15000,
    });
    return { output: stdout + stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { output: (e.stdout ?? "") + (e.stderr ?? ""), code: e.code ?? 1 };
  }
}

describe("CLI output never shows the token", () => {
  it("config show masks it and names the source", async () => {
    for (const json of [[], ["--json"]]) {
      const { output, code } = await runCli(["config", "show", "--network", "mainnet", ...json], {
        BLOCKFROST_PROJECT_ID: TOKEN,
      });
      expect(code).toBe(0);
      expect(output).not.toContain(TOKEN);
      expect(output).toContain("BLOCKFROST_PROJECT_ID");
    }
  });

  it("config show works before a token is set", async () => {
    const { output, code } = await runCli(["config", "show", "--network", "mainnet"], { BLOCKFROST_PROJECT_ID: "" });
    expect(code).toBe(0);
    expect(output).toContain("blockfrostProjectId: not set");
  });

  it("config show flags a missing ID when only the indexer is on Blockfrost", async () => {
    writeConfig(
      `[networks.custom]\nnetwork_id = "custom"\nrpc = "http://127.0.0.1:9944"\n` +
        `indexer_http = "https://midnight-mainnet.blockfrost.io/api/v0"\n` +
        `indexer_ws = "wss://midnight-mainnet.blockfrost.io/api/v0/ws"\n`,
    );
    const { output } = await runCli(["config", "show", "--network", "custom"], { BLOCKFROST_PROJECT_ID: "" });
    expect(output).toContain("blockfrostProjectId: not set");
  });

  it("a missing token fails with guidance and no request", async () => {
    const { output, code } = await runCli(["health", "mainnet"], { BLOCKFROST_PROJECT_ID: "" });
    expect(code).toBe(1);
    expect(output).toContain("need a project token");
  });

  it("a request error to a Blockfrost URL doesn't leak the token", async () => {
    const { output } = await runCli(
      ["ping", "mainnet", "--json", "--rpc", `http://127.0.0.1:9/?project_id=${TOKEN}`],
      { BLOCKFROST_PROJECT_ID: TOKEN },
    );
    expect(output).not.toContain(TOKEN);
  });
});
