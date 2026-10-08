// Builds the standalone binaries: the CLI, its data files and its version, compiled with the Bun
// runtime into one executable that runs without Node.js. Each is packed with the licenses it
// carries into build/release/midnight-cast-<target>.tar.gz, or .zip for Windows.
//
//   tsx scripts/build-binaries.ts [--target <target>]... [--all]
//   tsx scripts/build-binaries.ts --checksums
//
// Without --target it builds for this machine. It needs Bun, at the version in .bun-version, and
// macOS for the macOS targets, which it signs. --checksums only rewrites build/release/SHA256SUMS.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersion } from "../src/lib/data-path.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// x64 builds use Bun's baseline runtime, which doesn't need AVX2: older CPUs and some virtual machines lack it.
export const TARGETS = {
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl-baseline",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "darwin-x64": "bun-darwin-x64-baseline",
  "darwin-arm64": "bun-darwin-arm64",
  "windows-x64": "bun-windows-x64-baseline",
} as const;

export type Target = keyof typeof TARGETS;

export function isTarget(name: string): name is Target {
  return Object.hasOwn(TARGETS, name);
}

export function hostTarget(): Target {
  const os = process.platform === "win32" ? "windows" : process.platform;
  // Node reports no glibc version on musl systems such as Alpine.
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
  const musl = process.platform === "linux" && !header?.glibcVersionRuntime ? "-musl" : "";
  const name = `${os}-${process.arch}${musl}`;
  if (!isTarget(name)) throw new Error(`No binary target for ${name}`);
  return name;
}

export function binaryName(target: Target): string {
  return target.startsWith("windows") ? "midnight-cast.exe" : "midnight-cast";
}

export function archiveName(target: Target): string {
  return `midnight-cast-${target}.${target.startsWith("windows") ? "zip" : "tar.gz"}`;
}

/** The entry point the binary is compiled from: it hands the CLI the data files and version before loading it. */
export function entrySource(version: string, data: Record<string, string>): string {
  return [
    `import { embedPackageFiles } from "../src/lib/data-path.js";`,
    `embedPackageFiles(${JSON.stringify({ version, data })});`,
    // --bytecode compiles to CommonJS, which has no top-level await; the CLI runs once it has loaded.
    `void import("../src/cli.js");`,
    "",
  ].join("\n");
}

/** The licenses of the dependencies compiled into the binary, and of the runtime. */
export function thirdPartyLicenses(): string {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; license?: string; dev?: boolean; devOptional?: boolean; optional?: boolean }>;
  };
  const sections = Object.entries(lock.packages)
    // An optional package for another platform is in the lockfile but not installed, and isn't compiled in.
    .filter(([path, entry]) => path.startsWith("node_modules/") && !entry.dev && !entry.devOptional && !(entry.optional && !existsSync(join(root, path))))
    .map(([path, entry]) => {
      const dir = join(root, path);
      const files = readdirSync(dir).filter((f) => /^(licen[cs]e|notice|copying)/i.test(f)).sort();
      if (!files.some((f) => /^(licen[cs]e|copying)/i.test(f))) throw new Error(`${path} has no license file to ship`);
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const texts = files.map((f) => readFileSync(join(dir, f), "utf8").trim());
      return [`${name}@${entry.version} (${entry.license})`, "", ...texts].join("\n");
    });
  const bun = [
    "Bun runtime",
    "",
    "The binary is compiled with Bun (https://bun.com), which is MIT licensed and links JavaScriptCore",
    "and other libraries under their own licenses, including the LGPL-2 for JavaScriptCore. Bun lists",
    "them, with how to get their source, at https://bun.com/docs/project/license.",
  ].join("\n");
  return `${[...sections, bun].join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
}

function bunVersion(): string {
  try {
    return execFileSync("bun", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Bun isn't installed. Get it from https://bun.com, at the version in .bun-version.");
  }
}

/** The system tar: bsdtar on macOS and Windows, which reads and writes zips too. Git's GNU tar can come first on a Windows PATH. */
export function systemTar(): string {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

function pack(target: Target, dir: string, files: string[], archive: string): void {
  if (!target.startsWith("windows")) {
    execFileSync("tar", ["-czf", archive, "-C", dir, ...files]);
  } else if (process.platform === "linux") {
    execFileSync("zip", ["-q", "-j", archive, ...files.map((f) => join(dir, f))]);
  } else {
    execFileSync(systemTar(), ["-a", "-cf", archive, "-C", dir, ...files]);
  }
}

/** SHA256SUMS lines, in the format install.sh and install.ps1 read: the hash, two spaces, the file name. */
export function sha256sums(paths: string[]): string {
  return paths.map((path) => `${createHash("sha256").update(readFileSync(path)).digest("hex")}  ${basename(path)}\n`).join("");
}

/** SHA256SUMS for every archive in the release directory, which the installers download beside them, and the installers. */
export function writeChecksums(releaseDir: string): void {
  const packed = readdirSync(releaseDir)
    .filter((name) => name.startsWith("midnight-cast-") && (name.endsWith(".tar.gz") || name.endsWith(".zip")))
    .sort();
  writeFileSync(join(releaseDir, "SHA256SUMS"), sha256sums(packed.map((name) => join(releaseDir, name))));
  for (const script of ["install.sh", "install.ps1"]) copyFileSync(join(root, script), join(releaseDir, script));
}

export function build(targets: Target[]): string[] {
  // Bun leaves a macOS binary's signature invalid, and Apple silicon kills a binary whose signature doesn't verify.
  const darwin = targets.filter((t) => t.startsWith("darwin"));
  if (darwin.length && process.platform !== "darwin") {
    throw new Error(`${darwin.join(" and ")} must be built on macOS, where codesign can sign them`);
  }
  const pinned = readFileSync(join(root, ".bun-version"), "utf8").trim();
  const running = bunVersion();
  if (running !== pinned) console.warn(`Bun ${running} is installed; the release builds use ${pinned} (.bun-version).`);

  const version = packageVersion();
  const dataDir = join(root, "src", "data");
  const data = Object.fromEntries(
    readdirSync(dataDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => [f, readFileSync(join(dataDir, f), "utf8")]),
  );
  const buildDir = join(root, "build");
  const releaseDir = join(buildDir, "release");
  mkdirSync(releaseDir, { recursive: true });
  const entry = join(buildDir, "entry.ts");
  writeFileSync(entry, entrySource(version, data));
  writeFileSync(join(buildDir, "THIRD-PARTY-LICENSES"), thirdPartyLicenses());

  const archives = targets.map((target) => {
    const dir = join(buildDir, "bin", target);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const binary = binaryName(target);
    execFileSync(
      "bun",
      ["build", "--compile", "--minify", "--bytecode", `--target=${TARGETS[target]}`, entry, "--outfile", join(dir, binary)],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    if (target.startsWith("darwin")) execFileSync("codesign", ["--force", "--sign", "-", join(dir, binary)], { stdio: "ignore" });
    for (const file of ["LICENSE", "NOTICE", "README.md"]) copyFileSync(join(root, file), join(dir, file));
    copyFileSync(join(buildDir, "THIRD-PARTY-LICENSES"), join(dir, "THIRD-PARTY-LICENSES"));
    const archive = join(releaseDir, archiveName(target));
    if (existsSync(archive)) rmSync(archive);
    pack(target, dir, [binary, "LICENSE", "NOTICE", "README.md", "THIRD-PARTY-LICENSES"], archive);
    console.log(`${target}: ${archive}`);
    return archive;
  });

  writeChecksums(releaseDir);
  return archives;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const named = args.flatMap((arg, i) => (args[i - 1] === "--target" ? [arg] : []));
  const unknown = named.filter((t) => !isTarget(t));
  if (unknown.length) {
    console.error(`Unknown target ${unknown.join(", ")}. Targets: ${Object.keys(TARGETS).join(", ")}`);
    process.exitCode = 2;
  } else {
    try {
      // CI builds macOS and the rest on different runners, then writes one SHA256SUMS over both.
      if (args.includes("--checksums")) {
        const releaseDir = join(root, "build", "release");
        const missing = (Object.keys(TARGETS) as Target[]).map(archiveName).filter((name) => !existsSync(join(releaseDir, name)));
        if (missing.length) throw new Error(`build/release is missing ${missing.join(", ")}`);
        writeChecksums(releaseDir);
      } else build(args.includes("--all") ? (Object.keys(TARGETS) as Target[]) : named.length ? (named as Target[]) : [hostTarget()]);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  }
}
