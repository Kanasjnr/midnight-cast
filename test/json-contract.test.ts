import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "cli.js");
const REFUSED = "http://127.0.0.1:59999";

async function runJson(args: string[]): Promise<{ envelope: Record<string, unknown>; code: number }> {
  try {
    const { stdout } = await execFileAsync("node", [cli, ...args, "--json"], { timeout: 15000 });
    return { envelope: JSON.parse(stdout), code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; code?: number };
    return { envelope: JSON.parse(e.stdout ?? ""), code: e.code ?? 1 };
  }
}

describe("--json envelope", () => {
  it("names the command, including subcommands", async () => {
    const { envelope, code } = await runJson(["decode", "ledger", "170"]);
    expect(code).toBe(0);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      ok: true,
      command: "decode ledger",
      error: null,
      warnings: [],
      next: [],
    });
  });

  it("reports a usage error with exit 2 and the suggestion as the hint", async () => {
    const { envelope, code } = await runJson(["ping", "--indexer", "x"]);
    expect(code).toBe(2);
    expect(envelope).toMatchObject({
      ok: false,
      error: { message: "unknown option '--indexer'", kind: "usage", hint: "Did you mean --indexer-ws?" },
    });
  });

  it("summarises which required services failed", async () => {
    const { envelope, code } = await runJson([
      "ping",
      "preprod",
      "--rpc",
      REFUSED,
      "--indexer-http",
      `${REFUSED}/api/v4/graphql`,
    ]);
    expect(code).toBe(1);
    expect(envelope).toMatchObject({
      ok: false,
      command: "ping",
      network: "preprod",
      error: { message: "Required services unreachable: rpc, indexer", kind: "refused" },
    });
  });

  it("points a failed check at the configured endpoints", async () => {
    const { envelope } = await runJson(["tip", "preprod", "--rpc", REFUSED]);
    expect(envelope.next).toEqual([
      expect.objectContaining({ command: "midnight-cast config show --network preprod" }),
    ]);
  });
});

describe("next steps", () => {
  it("never sends decode --raw back to decode", async () => {
    const { envelope } = await runJson(["decode", "--raw", "1010: Invalid Transaction: Custom error: 180"]);
    const commands = (envelope.next as Array<{ command: string }>).map((s) => s.command);
    expect(commands).toEqual(["midnight-cast explain 1010", "midnight-cast explain transcript"]);
  });

  it("suggests only commands that run", async () => {
    const suggested = new Set<string>();
    for (const args of [["decode", "1010"], ["decode", "180"], ["decode", "pallet", "5", "3"]]) {
      const { envelope } = await runJson(args);
      for (const step of envelope.next as Array<{ command: string }>) suggested.add(step.command);
    }
    const runnable = [...suggested].filter((c) => !c.includes("<"));
    expect(runnable.length).toBeGreaterThan(0);
    for (const command of runnable) {
      const { envelope, code } = await runJson(command.split(" ").slice(1));
      expect(code, command).toBe(0);
      expect(envelope.ok, command).toBe(true);
    }
  });
});

describe("explain --json catalog", () => {
  it("lists every command, each of which answers --help", async () => {
    const { envelope, code } = await runJson(["explain"]);
    expect(code).toBe(0);
    const catalog = envelope.data as {
      commands: Array<{ name: string; usage: string }>;
      topics: string[];
      exitCodes: Record<string, string>;
      errorKinds: Record<string, string>;
    };
    const names = catalog.commands.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["decode", "decode ledger", "config init", "ping", "tx", "explain"]));
    expect(names).not.toContain("config");
    expect(Object.keys(catalog.exitCodes)).toEqual(["0", "1", "2"]);
    expect(catalog.errorKinds).toHaveProperty("usage");
    for (const name of names) {
      const { stdout } = await execFileAsync("node", [cli, ...name.split(" "), "--help"], { timeout: 15000 });
      expect(stdout, name).toContain("Usage:");
    }
    for (const topic of catalog.topics) {
      expect((await runJson(["explain", topic])).code, topic).toBe(0);
    }
  }, 60000);
});
