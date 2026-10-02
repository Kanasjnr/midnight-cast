import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const integration = process.env.INTEGRATION === "1";
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

describe.skipIf(!integration)("smoke (live preview)", () => {
  it("mn ping preview", async () => {
    const { code, stdout } = await runMn(["ping", "preview", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      ok: boolean;
      data: {
        network: string;
        table: Array<{ service: string; status: string }>;
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.table.find((r) => r.service === "rpc")?.status).toBe("OK");
    expect(parsed.data.table.find((r) => r.service === "indexer")?.status).toBe(
      "OK",
    );
  });

  it("mn versions preview reports a consistent live stack", async () => {
    const { stdout } = await runMn(["versions", "preview", "--json", "--no-local"]);
    const parsed = JSON.parse(stdout) as {
      error?: string;
      data: {
        network: string;
        live: {
          nodeVersion: string;
          runtimeSpecVersion: number;
          indexerProtocolVersion: number;
        };
        expected: { node: string };
        checks: Array<{ label: string; ok: boolean }>;
      };
    };
    expect(parsed.data, parsed.error).toBeDefined();
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.expected.node).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.data.live.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.data.live.indexerProtocolVersion).toBe(
      parsed.data.live.runtimeSpecVersion,
    );
    expect(parsed.data.checks.find((c) => c.label === "indexer-api")?.ok).toBe(true);
  });

  it("mn health preview", async () => {
    const { stdout, code } = await runMn(["health", "preview", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { network: string; healthy: boolean; sync: { rpcHeight: number } };
    };
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.healthy).toBe(true);
    expect(parsed.data.sync.rpcHeight).toBeGreaterThan(0);
  });

  it("mn tip preview", async () => {
    const { stdout, code } = await runMn([
      "tip",
      "preview",
      "--json",
      "--threshold",
      "10000",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { rpcHeight: number; indexerHeight: number };
    };
    expect(parsed.data.rpcHeight).toBeGreaterThan(0);
    expect(parsed.data.indexerHeight).toBeGreaterThan(0);
  });

  it("mn decode 170 with preview ledger stamp", async () => {
    const { stdout, code } = await runMn([
      "decode",
      "170",
      "--network",
      "preview",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      data: { name: string; ledger: string; network: string };
    };
    expect(parsed.data.name).toBe("InvalidDustSpendProof");
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.ledger).toBe("8.1.2");
    expect(
      (parsed.data as { networkLedger?: string }).networkLedger,
    ).toBe("8.1.2");
  });
});
