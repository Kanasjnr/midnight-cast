import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TARGETS, archiveName, binaryName, canBuild, entrySource, hostTarget, isTarget, thirdPartyLicenses, writeChecksums } from "../scripts/build-binaries.js";

describe("standalone binaries", () => {
  it("builds every platform the installers detect, with the baseline runtime on x64", () => {
    expect(Object.keys(TARGETS).sort()).toEqual([
      "darwin-arm64", "darwin-x64", "linux-arm64", "linux-arm64-musl", "linux-x64", "linux-x64-musl", "windows-x64",
    ]);
    for (const [target, bun] of Object.entries(TARGETS)) {
      if (target.includes("x64")) expect(bun, target).toMatch(/-baseline$/);
    }
    expect(isTarget(hostTarget())).toBe(true);
    expect(isTarget("constructor")).toBe(false);
  });

  it("builds macOS binaries on macOS and the Windows one on Windows, and the Linux ones anywhere", () => {
    expect(canBuild("darwin-arm64", "linux")).toBe(false);
    expect(canBuild("darwin-x64", "darwin")).toBe(true);
    expect(canBuild("windows-x64", "linux")).toBe(false);
    expect(canBuild("windows-x64", "win32")).toBe(true);
    expect(canBuild("linux-arm64-musl", "darwin")).toBe(true);
  });

  it("names archives the way install.sh and install.ps1 ask for them", () => {
    const sh = readFileSync(join(process.cwd(), "install.sh"), "utf8");
    const ps1 = readFileSync(join(process.cwd(), "install.ps1"), "utf8");
    expect(archiveName("linux-arm64-musl")).toBe("midnight-cast-linux-arm64-musl.tar.gz");
    expect(sh).toContain('archive="midnight-cast-$os-$arch$libc.tar.gz"');
    expect(archiveName("windows-x64")).toBe("midnight-cast-windows-x64.zip");
    expect(ps1).toContain("$archive = 'midnight-cast-windows-x64.zip'");
    expect(binaryName("windows-x64")).toBe("midnight-cast.exe");
    expect(binaryName("darwin-arm64")).toBe("midnight-cast");
  });

  it("hands the CLI its data files and version before loading it", () => {
    const source = entrySource("9.9.9", { "a.json": '{"x":1}' });
    expect(source.indexOf("embedPackageFiles(")).toBeLessThan(source.indexOf('import("../src/cli.js")'));
    expect(source).toContain('"version":"9.9.9"');
    expect(source).toContain('"a.json":"{\\"x\\":1}"');
  });

  it("ships the license of every dependency it compiles in, and the runtime's", () => {
    const text = thirdPartyLicenses();
    const dependencies = Object.keys((JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies);
    for (const name of dependencies) expect(text, name).toMatch(new RegExp(`^${name.replace(/[/.]/g, "\\$&")}@\\d`, "m"));
    expect(text).toContain("Bun runtime");
  });

  it("writes SHA256SUMS in the format the installers read", () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-sums-"));
    writeFileSync(join(dir, "midnight-cast-linux-x64.tar.gz"), "archive");
    writeFileSync(join(dir, "notes.txt"), "not an archive");
    writeChecksums(dir);
    const sums = readFileSync(join(dir, "SHA256SUMS"), "utf8");
    expect(sums).toMatch(/^[0-9a-f]{64} {2}midnight-cast-linux-x64\.tar\.gz\n$/);
    expect(readFileSync(join(dir, "install.sh"), "utf8")).toBe(readFileSync(join(process.cwd(), "install.sh"), "utf8"));
  });

  it("reads bundled files instead of the package directory once they're embedded", async () => {
    vi.resetModules();
    const dataPath = await import("../src/lib/data-path.js");
    expect(dataPath.loadDataJson<{ updated: string }>("support-matrix.json").updated).toBeTruthy();
    dataPath.embedPackageFiles({ version: "9.9.9", data: { "support-matrix.json": '{"updated":"embedded"}' } });
    expect(dataPath.packageVersion()).toBe("9.9.9");
    expect(dataPath.loadDataJson<{ updated: string }>("support-matrix.json").updated).toBe("embedded");
    expect(() => dataPath.loadDataJson("error-codes.json")).toThrow("isn't bundled");
    vi.resetModules();
  });
});
