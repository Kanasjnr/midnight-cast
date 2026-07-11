import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "cli.js");

async function runMn(args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync("node", [cli, ...args], {
      timeout: 10000,
    });
    return { stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? "", code: e.code ?? 1 };
  }
}

describe("cli decode jsonrpc", () => {
  it("accepts negative JSON-RPC code on the command line", async () => {
    const { stdout, code } = await runMn([
      "decode",
      "jsonrpc",
      "-32602",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      data: { code: number; name: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.code).toBe(-32602);
    expect(parsed.data.name).toBe("INVALID_PARAMS");
  });
});
