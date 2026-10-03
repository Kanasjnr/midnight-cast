import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "cli.js");
// Unit tests stay off the network: endpoints that fail fast, locally.
const CLOSED_PORT = "http://127.0.0.1:9";

async function runMn(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cli, ...args], {
      timeout: 15000,
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: e.code ?? 1,
    };
  }
}

describe("cli positional network", () => {
  it("tx accepts network as second positional arg", async () => {
    const hash = "0x" + "00".repeat(32);
    const { stdout, stderr } = await runMn([
      "tx",
      hash,
      "preprod",
      "--json",
      "--indexer-http",
      CLOSED_PORT,
    ]);
    expect(stderr).not.toContain("too many arguments");
    // Parsing succeeded and the command ran; the closed port keeps it offline.
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: "Indexer unreachable" } });
  });

  it("decode accepts network as second positional arg", async () => {
    const { stdout, code } = await runMn([
      "decode",
      "170",
      "preview",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { network: string; ledger: string };
    };
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.ledger).toBe("8.1.2");
  });

  it("rpc accepts network when params omitted", async () => {
    const { stdout, stderr } = await runMn([
      "rpc",
      "chain_getHeader",
      "preprod",
      "--json",
      "--rpc",
      CLOSED_PORT,
    ]);
    expect(stderr).not.toContain("too many arguments");
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: "RPC unreachable" } });
  });
});
