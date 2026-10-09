// Runs a standalone binary the way a user gets it: unpacks its release archive, runs the
// commands every install must run, and installs it with install.sh or install.ps1 from a local
// server, including a download whose checksum doesn't match, which must install nothing.
//
//   tsx scripts/smoke-binary.ts build/release/midnight-cast-<target>.tar.gz [--offline] [--docker <image>]
//
// --offline skips the commands that need a network. --docker runs a Linux binary in a container.
// A musl image needs libstdc++ and libgcc (a bare Alpine doesn't have them). The image also needs
// wget or curl, because the installer downloads with whichever is there.

import { execFile, execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersion } from "../src/lib/data-path.js";
import { sha256sums, systemTar } from "./build-binaries.js";
import { checker, commandChecks, mcpTools, schemaValidator, showStderr, type Run } from "./smoke-checks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const windows = process.platform === "win32";
const ARCHIVE_FILES = ["LICENSE", "NOTICE", "README.md", "THIRD-PARTY-LICENSES"];

function exec(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; verbatim?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((done) => {
    const settings = { cwd: options.cwd, env: { ...process.env, ...options.env }, maxBuffer: 16 * 1024 * 1024, windowsVerbatimArguments: options.verbatim };
    execFile(command, args, settings, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      done({ stdout, stderr, code });
    });
  });
}

function unpack(archive: string, into: string): void {
  mkdirSync(into, { recursive: true });
  if (archive.endsWith(".zip") && process.platform === "linux") {
    execFileSync("unzip", ["-q", archive, "-d", into]);
    return;
  }
  execFileSync(systemTar(), ["-xf", archive, "-C", into]);
}

/** A server for the files in a directory, as a release's download URL would serve them. */
function serve(dir: string, host: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    const name = basename(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
    const path = join(dir, name);
    if (!name || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(path));
  });
  return new Promise((done) => server.listen(0, host, () => done({ server, port: (server.address() as AddressInfo).port })));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const docker = args.includes("--docker") ? args[args.indexOf("--docker") + 1] : undefined;
  const archive = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--docker");
  if (!archive || !existsSync(archive)) {
    console.error("Usage: tsx scripts/smoke-binary.ts <archive> [--offline] [--docker <image>]");
    return 2;
  }
  const archivePath = resolve(archive);
  const { failures, check } = checker();
  const work = mkdtempSync(join(tmpdir(), "mc-binary-"));
  const unpacked = join(work, "unpacked");
  unpack(archivePath, unpacked);
  const binaryName = archivePath.endsWith(".zip") ? "midnight-cast.exe" : "midnight-cast";
  const present = readdirSync(unpacked);
  const missing = [binaryName, ...ARCHIVE_FILES].filter((f) => !present.includes(f));
  check(!missing.length, `archive: ${missing.length ? `missing ${missing.join(", ")}` : `${present.length} files, nothing missing`}`);
  if (basename(archivePath).includes("-darwin-")) {
    // An Intel Mac runs a binary whose signature doesn't verify; Apple silicon kills it.
    const signature = await exec("codesign", ["--verify", join(unpacked, binaryName)]);
    check(signature.code === 0, `the binary's signature verifies${signature.code ? `: ${signature.stderr.trim().split("\n")[0]}` : ""}`);
  }

  // A scratch directory with no package.json, so versions sees no project.
  const cwd = join(work, "cwd");
  mkdirSync(cwd);
  // MN_OFFLINE keeps versions on the bundled matrix, so the checks don't depend on GitHub; the online ones drop it.
  const env = { MN_OFFLINE: "1" };
  const dockerArgs = (interactive: boolean, bundled = true) => [
    "run", "--rm", "--init", ...(interactive ? ["-i"] : []), ...(bundled ? ["-e", "MN_OFFLINE=1"] : []),
    "-v", `${unpacked}:/smoke:ro`, "-w", "/tmp", docker!, `/smoke/${binaryName}`,
  ];
  const runWith = async (cliArgs: string[], bundled: boolean) => {
    const result = docker
      ? await exec("docker", [...dockerArgs(false, bundled), ...cliArgs])
      : await exec(join(unpacked, binaryName), cliArgs, { cwd, env: bundled ? env : { MN_OFFLINE: "" } });
    return { stdout: result.stdout, code: result.code, stderr: result.stderr };
  };
  const run: Run = (cliArgs) => runWith(cliArgs, true);
  const startMcp = () => {
    const child = docker
      ? spawn("docker", [...dockerArgs(true), "mcp"])
      : spawn(join(unpacked, binaryName), ["mcp"], { cwd, env: { ...process.env, ...env } });
    return mcpTools(child, () => child.kill());
  };

  const valid = schemaValidator(join(root, "schemas"));
  const version = packageVersion();
  const v = await run(["--version"]);
  check(v.code === 0 && v.stdout.trim() === version, `midnight-cast --version prints ${version}`);
  if (v.code !== 0) showStderr(v);

  await commandChecks(run, valid, check, startMcp);

  // Each reads a different bundled data file, which a binary carries inside it.
  for (const cliArgs of [["explain", "sync", "--json"], ["examples", "dust", "sponsorship", "--json"], ["versions", "--json"]]) {
    const result = await run(cliArgs);
    const ok = result.code === 0 && valid(result.stdout);
    check(ok, `midnight-cast ${cliArgs.join(" ")} (bundled data)`);
    if (!ok) showStderr(result);
  }

  if (!offline) {
    // HTTP, then the indexer's WebSocket. The network may be down, so any valid envelope passes, with a warning when it isn't ok.
    for (const cliArgs of [["tip", "preprod", "--json"], ["dust-events", "preprod", "--limit", "1", "--json"]]) {
      const result = await run(cliArgs);
      check(valid(result.stdout), `midnight-cast ${cliArgs.join(" ")} (exit ${result.code})`);
      if (result.code !== 0) console.log(`::warning::midnight-cast ${cliArgs.join(" ")} didn't reach preprod; the binary's network client is unconfirmed`);
    }
    // The published support matrix, fetched from GitHub; versions falls back to the bundled one if the fetch fails.
    const fetched = await runWith(["versions", "--refresh-matrix", "--json"], false);
    check(valid(fetched.stdout), `midnight-cast versions --refresh-matrix --json (exit ${fetched.code})`);
    const source = (() => {
      try {
        return (JSON.parse(fetched.stdout) as { data?: { matrixSource?: { kind?: string } } }).data?.matrixSource?.kind;
      } catch {
        return undefined;
      }
    })();
    if (source !== "upstream") console.log(`::warning::versions used the ${source ?? "unknown"} matrix, not GitHub's; the binary's fetch of it is unconfirmed`);
  }

  await installerChecks(archivePath, work, version, check, docker);

  console.log(failures.length ? `\n${failures.length} check(s) failed` : `\n${basename(archivePath)} works`);
  return failures.length ? 1 : 0;
}

/** Installs from a local release: once as published, once with a checksum that doesn't match. */
async function installerChecks(
  archive: string,
  work: string,
  version: string,
  check: (ok: boolean, what: string) => void,
  docker: string | undefined,
): Promise<void> {
  const good = join(work, "release");
  const bad = join(work, "tampered");
  for (const dir of [good, bad]) {
    mkdirSync(dir);
    copyFileSync(archive, join(dir, basename(archive)));
  }
  writeFileSync(join(good, "SHA256SUMS"), sha256sums([archive]));
  writeFileSync(join(bad, "SHA256SUMS"), `${"0".repeat(64)}  ${basename(archive)}\n`);

  // A container reaches the host's servers through the bridge gateway, which --add-host names host.docker.internal.
  const servers = await Promise.all([serve(good, docker ? "0.0.0.0" : "127.0.0.1"), serve(bad, docker ? "0.0.0.0" : "127.0.0.1")]);
  try {
    const [goodUrl, badUrl] = servers.map(({ port }) => `http://${docker ? "host.docker.internal" : "127.0.0.1"}:${port}`);
    const installed = await install(goodUrl!, join(work, "installed"), docker);
    check(
      installed.code === 0 && installed.versions.length === 2 && installed.versions.every((line) => line === version),
      `${windows ? "install.ps1" : "install.sh"} installs midnight-cast and mn ${version}`,
    );
    if (installed.code !== 0) showStderr({ stderr: installed.output });
    else if (installed.versions.length !== 2) showStderr({ stderr: `installed, but --version printed: ${JSON.stringify(installed.versions)}\n${installed.output}` });
    const tampered = await install(badUrl!, join(work, "not-installed"), docker);
    check(
      tampered.code !== 0 && /doesn't match its checksum/.test(tampered.output) && !tampered.versions.length,
      `${windows ? "install.ps1" : "install.sh"} refuses a download that doesn't match SHA256SUMS`,
    );
  } finally {
    for (const { server } of servers) server.close();
  }
}

async function install(
  url: string,
  dir: string,
  docker: string | undefined,
): Promise<{ code: number; output: string; versions: string[] }> {
  if (docker) {
    // A fresh container, as a minimal CI image would be: busybox wget, no curl.
    const target = "/opt/midnight-cast";
    const script = `sh /install.sh && ${target}/midnight-cast --version && ${target}/mn --version`;
    const result = await exec("docker", [
      "run", "--rm", "--add-host=host.docker.internal:host-gateway",
      "-e", `MIDNIGHT_CAST_DOWNLOAD_URL=${url}`, "-e", `MIDNIGHT_CAST_INSTALL_DIR=${target}`,
      "-v", `${join(root, "install.sh")}:/install.sh:ro`, docker, "sh", "-c", script,
    ]);
    return { code: result.code, output: result.stdout + result.stderr, versions: versionLines(result.stdout) };
  }
  const env = { MIDNIGHT_CAST_DOWNLOAD_URL: url, MIDNIGHT_CAST_INSTALL_DIR: dir };
  const result = windows
    ? // Windows PowerShell, as a user starts it. PowerShell 7's module path, inherited from a CI step, makes
      // built-in commands such as Get-FileHash fail to load in it.
      await exec("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "install.ps1")], { env: { ...env, PSModulePath: undefined } })
    : await exec("sh", [join(root, "install.sh")], { env });
  const output = result.stdout + result.stderr;
  if (result.code !== 0) return { code: result.code, output, versions: [] };
  const binary = join(dir, windows ? "midnight-cast.exe" : "midnight-cast");
  const versions: string[] = [];
  if (existsSync(binary)) versions.push((await exec(binary, ["--version"])).stdout.trim());
  // mn.cmd is a batch file, which only cmd.exe runs. Node would escape the quotes as \", which cmd.exe doesn't read.
  const mn = windows
    ? await exec("cmd.exe", ["/d", "/s", "/c", `""${join(dir, "mn.cmd")}" --version"`], { verbatim: true })
    : await exec(join(dir, "mn"), ["--version"]);
  if (mn.code === 0) versions.push(mn.stdout.trim());
  return { code: result.code, output, versions };
}

const versionLines = (stdout: string) => stdout.split("\n").map((l) => l.trim()).filter((l) => /^\d+\.\d+\.\d+/.test(l));

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    },
  );
}
