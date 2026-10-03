import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const enabled = process.env.INTEGRATION === "1" && Boolean(process.env.BLOCKFROST_PROJECT_ID);
const cli = join(process.cwd(), "dist", "cli.js");

async function runMn(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cli, ...args], {
      timeout: 45000,
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

describe.skipIf(!enabled)("smoke (live mainnet via Blockfrost)", () => {
  it("mn ping mainnet", async () => {
    const { code, stdout } = await runMn(["ping", "mainnet", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { network: string; table: Array<{ service: string; status: string }> };
    };
    expect(parsed.data.network).toBe("mainnet");
    expect(parsed.data.table.find((r) => r.service === "rpc")?.status).toBe("OK");
    expect(parsed.data.table.find((r) => r.service === "indexer")?.status).toBe("OK");
  });

  it("mn tip mainnet", async () => {
    const { stdout, code } = await runMn(["tip", "mainnet", "--json", "--threshold", "10000"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { rpcHeight: number; indexerHeight: number };
    };
    expect(parsed.data.rpcHeight).toBeGreaterThan(0);
    expect(parsed.data.indexerHeight).toBeGreaterThan(0);
  });

  it("mn versions mainnet reports a consistent live stack", async () => {
    const { stdout } = await runMn(["versions", "mainnet", "--json", "--no-local"]);
    const parsed = JSON.parse(stdout) as {
      error: { message: string } | null;
      data: {
        network: string;
        live: { nodeVersion: string; runtimeSpecVersion: number; indexerProtocolVersion: number };
        checks: Array<{ label: string; ok: boolean }>;
      };
    };
    expect(parsed.data, parsed.error?.message).toBeDefined();
    expect(parsed.data.network).toBe("mainnet");
    expect(parsed.data.live.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.data.live.indexerProtocolVersion).toBe(parsed.data.live.runtimeSpecVersion);
    expect(parsed.data.checks.find((c) => c.label === "indexer-api")?.ok).toBe(true);
  });
});
