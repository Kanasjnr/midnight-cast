import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const integration = process.env.INTEGRATION === "1";
const cli = join(process.cwd(), "dist", "cli.js");

async function runMn(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cli, ...args], {
      timeout: 30000,
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

describe.skipIf(!integration)("integration (live preprod)", () => {
  it("mn ping preprod", async () => {
    const { code, stdout } = await runMn(["ping", "preprod", "--json"]);
    expect(stdout).toContain('"ok"');
    expect(code).toBe(0);
  });

  it("mn tip preprod", async () => {
    const { stdout } = await runMn(["tip", "preprod", "--json", "--threshold", "10000"]);
    const parsed = JSON.parse(stdout) as { ok: boolean; data: { rpcHeight: number } };
    expect(parsed.data.rpcHeight).toBeGreaterThan(0);
  });

  it("mn decode 170", async () => {
    const { stdout } = await runMn(["decode", "170", "--json"]);
    const parsed = JSON.parse(stdout) as { data: { name: string } };
    expect(parsed.data.name).toBe("InvalidDustSpendProof");
  });

  it("mn tx by hash on preprod", async () => {
    const hash =
      "e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c";
    const { stdout, code } = await runMn([
      "tx",
      hash,
      "--network",
      "preprod",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { id: number; status: string };
    };
    expect(parsed.data.id).toBe(232830);
    expect(parsed.data.status).toBeDefined();
  });
});

describe("integration placeholder", () => {
  it("skipped unless INTEGRATION=1", () => {
    expect(integration || true).toBe(true);
  });
});
