// Packs midnight-cast the way npm publishes it, installs the tarball into an empty
// project, and runs the installed CLI. Catches what tests against the source tree
// can't: a file left out of the package, a broken bin, or an ESM resolution error.
//
//   tsx scripts/smoke-tarball.ts [--offline]
//
// --offline skips the one command that needs a network (health preview).

import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import { outputSchemaFor } from "../src/lib/catalog.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";

interface PackResult {
  filename: string;
  files: Array<{ path: string }>;
}

/** Files the package must ship, and source directories it must not. */
export function packageProblems(packed: string[], dataFiles: string[], schemaFiles: string[]): string[] {
  const required = [
    "package.json",
    "dist/cli.js",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
    ...dataFiles.map((f) => `dist/data/${f}`),
    ...schemaFiles.map((f) => `schemas/${f}`),
  ];
  const present = new Set(packed);
  return [
    ...required.filter((f) => !present.has(f)).map((f) => `missing ${f}`),
    ...packed.filter((f) => /^(src|test|scripts)\//.test(f)).map((f) => `should not ship ${f}`),
  ];
}

/** Quotes an argument for cmd.exe, which would otherwise split it at spaces. */
export function quoteForCmd(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

async function sh(command: string, args: string[], cwd: string, env = process.env) {
  // npm and npx are .cmd shims on Windows, which execFile only runs through a shell, and the
  // shell joins arguments with plain spaces.
  return run(command, windows ? args.map(quoteForCmd) : args, { cwd, env, shell: windows, maxBuffer: 16 * 1024 * 1024 });
}

async function cli(cwd: string, bin: string, args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await sh("npx", ["--no-install", bin, ...args], cwd, { ...process.env, MN_OFFLINE: "1" });
    return { stdout, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? "", code: typeof e.code === "number" ? e.code : 1 };
  }
}

/** Starts the installed MCP server, initialises a session and lists its tools. */
async function mcpTools(cwd: string): Promise<string[]> {
  const child = spawn("npx", ["--no-install", "midnight-cast", "mcp"], { cwd, shell: windows });
  const messages = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ];
  for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no tools/list answer within 30s")), 30_000);
      let buffered = "";
      child.stdout.on("data", (chunk: Buffer) => {
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
    child.stdin.end();
    // With a shell, child is cmd.exe; the server under it only goes with the whole tree.
    if (windows && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill();
  }
}

async function main(): Promise<number> {
  const offline = process.argv.includes("--offline");
  const work = mkdtempSync(join(tmpdir(), "mc-tarball-"));
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };

  const { stdout: packOut } = await sh("npm", ["pack", "--json", "--pack-destination", work], root);
  const [pack] = JSON.parse(packOut) as PackResult[];
  const problems = packageProblems(
    pack!.files.map((f) => f.path),
    readdirSync(join(root, "src", "data")),
    readdirSync(join(root, "schemas")),
  );
  for (const problem of problems) check(false, `package: ${problem}`);
  if (!problems.length) check(true, `package: ${pack!.files.length} files, nothing missing or extra`);

  const project = join(work, "project");
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  await sh("npm", ["install", "--no-audit", "--no-fund", join(work, pack!.filename)], project);

  const installed = join(project, "node_modules", "midnight-cast");
  const ajv = new Ajv2020({ allErrors: true });
  for (const file of readdirSync(join(installed, "schemas"))) {
    ajv.addSchema(JSON.parse(readFileSync(join(installed, "schemas", file), "utf8")));
  }
  const valid = (stdout: string): boolean => {
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

  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
  for (const bin of ["midnight-cast", "mn"]) {
    const v = await cli(project, bin, ["--version"]);
    check(v.code === 0 && v.stdout.trim() === version, `${bin} --version prints ${version}`);
  }

  const offlineCommands: string[][] = [
    ["decode", "170", "--json"],
    ["decode", "--raw", "1010: Invalid Transaction: Custom error: 171", "--json"],
    ["decode", "--raw", "Error: UnsupportedBlockVersion(1000300)", "--json"],
    ["explain", "--json"],
    ["explain", "dust", "--json"],
  ];
  for (const args of offlineCommands) {
    const result = await cli(project, "midnight-cast", args);
    check(result.code === 0 && valid(result.stdout), `midnight-cast ${args.join(" ")}`);
  }

  const human = await cli(project, "midnight-cast", ["explain"]);
  check(human.code === 0 && human.stdout.includes("Topics:"), "midnight-cast explain (human output)");

  const usage = await cli(project, "midnight-cast", ["no-such-command", "--json"]);
  check(usage.code === 2 && valid(usage.stdout), "a usage error exits 2 with a valid envelope");

  const tools: string[] = await mcpTools(project).catch((err: unknown) => {
    console.log(`     ${err instanceof Error ? err.message : String(err)}`);
    return [];
  });
  check(tools.length === 14 && tools.includes("examples"), `midnight-cast mcp lists its tools (${tools.length})`);

  if (!offline) {
    // The network may be down; the gate is about the package, so any valid envelope passes.
    const health = await cli(project, "midnight-cast", ["health", "preview", "--json"]);
    check(valid(health.stdout), `midnight-cast health preview --json (exit ${health.code})`);
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nThe packed tarball works");
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    },
  );
}
