// The checks both smoke tests run against an installed midnight-cast: the npm tarball
// (smoke-tarball.ts) and the standalone binaries (smoke-binary.ts).

import type { ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { outputSchemaFor } from "../src/lib/catalog.js";

export type Run = (args: string[]) => Promise<{ stdout: string; code: number }>;

export function checker() {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  return { failures, check };
}

/** Whether a command's stdout is an envelope, and its data, that the schemas in a directory accept. */
export function schemaValidator(schemaDir: string): (stdout: string) => boolean {
  const ajv = new Ajv2020({ allErrors: true });
  for (const file of readdirSync(schemaDir)) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, file), "utf8")));
  return (stdout) => {
    try {
      const envelope = JSON.parse(stdout) as { command: string | null; data: unknown };
      const envelopeOk = ajv.getSchema(outputSchemaFor("envelope"))!(envelope);
      const dataOk =
        !envelope.command || envelope.data === null || ajv.getSchema(outputSchemaFor(envelope.command))!(envelope.data);
      return Boolean(envelopeOk && dataOk);
    } catch {
      return false;
    }
  };
}

/** Initialises a session with a started MCP server, lists its tools, then stops it. */
export async function mcpTools(child: ChildProcess, stop: () => void): Promise<string[]> {
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  for (const message of messages) child.stdin!.write(`${JSON.stringify(message)}\n`);
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no tools/list answer within 30s")), 30_000);
      let buffered = "";
      child.stdout!.on("data", (chunk: Buffer) => {
        buffered += chunk.toString();
        for (const line of buffered.split("\n").slice(0, -1)) {
          let reply: { id?: number; result?: { tools: Array<{ name: string }> } };
          try {
            reply = JSON.parse(line);
          } catch {
            // Anything but protocol messages on stdout breaks MCP clients, so it fails the check.
            clearTimeout(timer);
            reject(new Error(`non-JSON line on the server's stdout: ${line.slice(0, 80)}`));
            return;
          }
          if (reply.id === 2 && reply.result) {
            clearTimeout(timer);
            resolve(reply.result.tools.map((t) => t.name));
          }
        }
        buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
      });
      child.on("exit", (code) => reject(new Error(`mcp exited with ${code}`)));
      child.on("error", reject);
    });
  } finally {
    child.stdin!.end();
    stop();
  }
}

/** The commands every install must run: offline decoding and help, a usage error, and the MCP server's tools. */
export async function commandChecks(
  run: Run,
  valid: (stdout: string) => boolean,
  check: (ok: boolean, what: string) => void,
  startMcp: () => Promise<string[]>,
): Promise<void> {
  const offlineCommands: string[][] = [
    ["decode", "170", "--json"],
    ["decode", "--raw", "1010: Invalid Transaction: Custom error: 171", "--json"],
    ["decode", "--raw", "Error: UnsupportedBlockVersion(1000300)", "--json"],
    ["explain", "--json"],
    ["explain", "dust", "--json"],
  ];
  for (const args of offlineCommands) {
    const result = await run(args);
    check(result.code === 0 && valid(result.stdout), `midnight-cast ${args.join(" ")}`);
  }

  const human = await run(["explain"]);
  check(human.code === 0 && human.stdout.includes("Topics:"), "midnight-cast explain (human output)");

  const usage = await run(["no-such-command", "--json"]);
  check(usage.code === 2 && valid(usage.stdout), "a usage error exits 2 with a valid envelope");

  const tools = await startMcp().catch((err: unknown) => {
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
    return [] as string[];
  });
  check(tools.length === 14 && tools.includes("examples"), `midnight-cast mcp lists its tools (${tools.length})`);
}
