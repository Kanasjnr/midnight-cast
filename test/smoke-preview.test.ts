import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseEnvelope } from "./schema.js";
import { loadSupportMatrix } from "../src/lib/versions.js";

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
  it("midnight-cast ping preview", async () => {
    const { code, stdout } = await runMn(["ping", "preview", "--json"]);
    expect(code).toBe(0);
    const parsed = parseEnvelope(stdout) as {
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

  it("midnight-cast versions preview reports a consistent live stack", async () => {
    const { stdout } = await runMn(["versions", "preview", "--json", "--no-local"]);
    const parsed = parseEnvelope(stdout) as {
      error: { message: string } | null;
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
    expect(parsed.data, parsed.error?.message).toBeDefined();
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.expected.node).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.data.live.nodeVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.data.live.indexerProtocolVersion).toBe(
      parsed.data.live.runtimeSpecVersion,
    );
    expect(parsed.data.checks.find((c) => c.label === "indexer-api")?.ok).toBe(true);
  });

  it("midnight-cast health preview", async () => {
    const { stdout, code } = await runMn(["health", "preview", "--json"]);
    expect(code).toBe(0);
    const parsed = parseEnvelope(stdout) as {
      data: { network: string; healthy: boolean; sync: { rpcHeight: number } };
    };
    expect(parsed.data.network).toBe("preview");
    expect(parsed.data.healthy).toBe(true);
    expect(parsed.data.sync.rpcHeight).toBeGreaterThan(0);
  });

  it("midnight-cast tip preview", async () => {
    const { stdout, code } = await runMn([
      "tip",
      "preview",
      "--json",
      "--threshold",
      "10000",
    ]);
    expect(code).toBe(0);
    const parsed = parseEnvelope(stdout) as {
      data: { rpcHeight: number; indexerHeight: number };
    };
    expect(parsed.data.rpcHeight).toBeGreaterThan(0);
    expect(parsed.data.indexerHeight).toBeGreaterThan(0);
  });

  it("midnight-cast decode 170 with preview ledger stamp", async () => {
    const { stdout, code } = await runMn([
      "decode",
      "170",
      "--network",
      "preview",
      "--json",
    ]);
    expect(code).toBe(0);
    const parsed = parseEnvelope(stdout) as {
      data: { name: string; ledger: string; network: string };
    };
    expect(parsed.data.name).toBe("InvalidDustSpendProof");
    expect(parsed.data.network).toBe("preview");
    // Read from the matrix rather than pinned, so a ledger upgrade doesn't break the smoke run.
    const ledger = loadSupportMatrix().networks.preview!.ledger;
    expect(parsed.data.ledger).toBe(ledger);
    expect(
      (parsed.data as { networkLedger?: string }).networkLedger,
    ).toBe(ledger);
  });
});
