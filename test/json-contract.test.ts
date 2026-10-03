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
});
