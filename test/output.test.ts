import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "../src/output.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args) => void err.push(args.join(" ")));
  return { out, err };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("emit in human mode", () => {
  it("prints the report of a command that failed", () => {
    const { out } = capture();
    const code = emit(
      {
        ok: false,
        data: { table: [{ service: "rpc", status: "FAIL", detail: "RPC unreachable" }] },
        exitCode: 1,
      },
      {},
    );
    expect(code).toBe(1);
    expect(out).toEqual(["service=rpc  status=FAIL  detail=RPC unreachable"]);
  });

  it("prints a failed command's report and its error", () => {
    const { out, err } = capture();
    emit({ ok: false, data: "Healthy: no", error: "indexer lagging" }, {});
    expect(out).toEqual(["Healthy: no"]);
    expect(err).toEqual(["indexer lagging"]);
  });

  it("still prints only the error when there is no report", () => {
    const { out, err } = capture();
    expect(emit({ ok: false, error: "Unknown network" }, {})).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["Unknown network"]);
  });
});

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "cli.js");

describe("ping with a dead stack", () => {
  it("shows which services failed instead of printing nothing", async () => {
    const result = await execFileAsync(
      "node",
      [cli, "ping", "preprod", "--rpc", "http://127.0.0.1:9", "--indexer-http", "http://127.0.0.1:9/api/v4/graphql"],
      { timeout: 15000 },
    ).catch((err: { stdout?: string; code?: number }) => err);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("service=rpc  status=FAIL");
    expect(result.stdout).toContain("RPC unreachable");
    expect(result.stdout).toContain("service=indexer  status=FAIL");
  });
});
