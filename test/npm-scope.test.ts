import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isMidnightPackage, loadMigratedPackages, packageBaseName } from "../src/lib/npm-scope.js";
import {
  buildLocalPackageChecks,
  buildScopeConflictChecks,
  buildScopeHints,
  checkLocalPackages,
  formatVersionsHuman,
  readInstalledMidnightPackages,
  readLocalMidnightPackages,
  type MatrixNetwork,
  type VersionsReport,
} from "../src/lib/versions.js";

let project: string | undefined;

function makeProject(pkg: object, lock?: object): string {
  project = mkdtempSync(join(tmpdir(), "midnight-cast-scope-"));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify(pkg));
  if (lock) writeFileSync(join(project, "package-lock.json"), JSON.stringify(lock));
  return project;
}

afterEach(() => {
  if (project) rmSync(project, { recursive: true, force: true });
  project = undefined;
});

const row: MatrixNetwork = {
  node: "1.0.300",
  ledger: "8.1.2",
  indexer: "4.3.302",
  indexerApi: "v4",
  proofServer: "8.1.0",
  onChainRuntime: "3.0.0",
  packages: { "@midnight-ntwrk/ledger-v8": "8.1.2", "@midnight-ntwrk/compact-runtime": "0.16.0" },
};

describe("npm scope names", () => {
  it("maps either scope to the same package", () => {
    expect(packageBaseName("@midnight-ntwrk/ledger-v8")).toBe("ledger-v8");
    expect(packageBaseName("@midnightntwrk/ledger-v8")).toBe("ledger-v8");
    expect(packageBaseName("ledger-v8")).toBeUndefined();
    expect(isMidnightPackage("@midnightntwrk/wallet-sdk")).toBe(true);
    expect(isMidnightPackage("@midnight/other")).toBe(false);
  });

  it("lists only packages with a stable release under the new scope", () => {
    const migrated = loadMigratedPackages();
    expect(migrated.has("ledger-v8")).toBe(true);
    expect(migrated.has("wallet-sdk-facade")).toBe(true);
    expect(migrated.has("midnight-js")).toBe(false);
    expect(migrated.has("dapp-connector-api")).toBe(false);
  });
});

describe("reading local packages", () => {
  it("reads both scopes and prefers the version installed in the lockfile", () => {
    const dir = makeProject(
      {
        dependencies: { "@midnightntwrk/ledger-v8": "^8.1.0", "@midnight-ntwrk/compact-runtime": "0.16.0" },
        devDependencies: { vitest: "^3.0.0" },
      },
      {
        packages: {
          "node_modules/@midnightntwrk/ledger-v8": { version: "8.1.2" },
          "node_modules/@midnight-ntwrk/compact-runtime": { version: "0.16.0" },
        },
      },
    );
    expect(readLocalMidnightPackages(dir)).toEqual({
      "@midnight-ntwrk/compact-runtime": "0.16.0",
      "@midnightntwrk/ledger-v8": "8.1.2",
    });
  });

  it("falls back to package.json ranges without a lockfile", () => {
    const dir = makeProject({ dependencies: { "@midnightntwrk/ledger-v8": "^8.1.2" } });
    expect(readLocalMidnightPackages(dir)).toEqual({ "@midnightntwrk/ledger-v8": "^8.1.2" });
    expect(readInstalledMidnightPackages(dir)).toEqual([]);
  });

  it("finds Midnight packages installed under other dependencies", () => {
    const dir = makeProject(
      { dependencies: {} },
      {
        packages: {
          "": {},
          "node_modules/some-sdk/node_modules/@midnight-ntwrk/ledger-v8": { version: "8.0.3" },
          "node_modules/react": { version: "19.0.0" },
        },
      },
    );
    expect(readInstalledMidnightPackages(dir)).toEqual([
      {
        name: "@midnight-ntwrk/ledger-v8",
        version: "8.0.3",
        path: "node_modules/some-sdk/node_modules/@midnight-ntwrk/ledger-v8",
      },
    ]);
  });
});

describe("npm aliases", () => {
  it("uses the real package behind an npm: alias", () => {
    const dir = makeProject(
      { dependencies: { "@midnight-ntwrk/ledger-v8": "npm:@midnightntwrk/ledger-v8@8.1.2" } },
      { packages: { "node_modules/@midnight-ntwrk/ledger-v8": { name: "@midnightntwrk/ledger-v8", version: "8.1.2" } } },
    );
    expect(readLocalMidnightPackages(dir)).toEqual({ "@midnightntwrk/ledger-v8": "8.1.2" });
    expect(readInstalledMidnightPackages(dir)[0]?.name).toBe("@midnightntwrk/ledger-v8");
  });

  it("catches an aliased new-scope package next to a real old-scope copy", () => {
    const dir = makeProject(
      { dependencies: { "@midnight-ntwrk/ledger-v8": "npm:@midnightntwrk/ledger-v8@8.1.2", "sdk-a": "1.0.0" } },
      {
        packages: {
          "node_modules/@midnight-ntwrk/ledger-v8": { name: "@midnightntwrk/ledger-v8", version: "8.1.2" },
          "node_modules/sdk-a/node_modules/@midnight-ntwrk/ledger-v8": { version: "8.0.3" },
        },
      },
    );
    const result = checkLocalPackages(row, dir);
    expect(result.localPackageChecks?.map((c) => c.label)).toContain("scope:ledger-v8");
    expect(result.scopeHints).toBeUndefined();
  });
});

describe("one package declared twice", () => {
  it("fails when an npm: alias and a direct dependency install the same package", () => {
    const dir = makeProject(
      {
        dependencies: {
          "@midnight-ntwrk/ledger-v8": "npm:@midnightntwrk/ledger-v8@8.0.3",
          "@midnightntwrk/ledger-v8": "8.1.2",
        },
      },
      {
        packages: {
          "node_modules/@midnight-ntwrk/ledger-v8": { name: "@midnightntwrk/ledger-v8", version: "8.0.3" },
          "node_modules/@midnightntwrk/ledger-v8": { version: "8.1.2" },
        },
      },
    );
    const check = checkLocalPackages(row, dir).localPackageChecks?.find((c) => c.label.startsWith("twice:"));
    expect(check).toMatchObject({
      label: "twice:@midnightntwrk/ledger-v8",
      ok: false,
      live: "node_modules/@midnight-ntwrk/ledger-v8, node_modules/@midnightntwrk/ledger-v8",
    });
  });

  it("fails a package declared twice even without a lockfile", () => {
    const dir = makeProject({
      dependencies: {
        "@midnight-ntwrk/ledger-v8": "npm:@midnightntwrk/ledger-v8@8.0.3",
        "@midnightntwrk/ledger-v8": "8.1.2",
      },
    });
    const twice = checkLocalPackages(row, dir).localPackageChecks?.filter((c) => c.label.startsWith("twice:"));
    expect(twice).toEqual([
      expect.objectContaining({ label: "twice:@midnightntwrk/ledger-v8", ok: false, live: "@midnight-ntwrk/ledger-v8, @midnightntwrk/ledger-v8" }),
    ]);
  });

  it("doesn't count a workspace's own copy as declared twice", () => {
    const checks = buildScopeConflictChecks({}, [
      { name: "@midnightntwrk/ledger-v8", version: "8.1.2", path: "node_modules/@midnightntwrk/ledger-v8" },
      { name: "@midnightntwrk/ledger-v8", version: "8.1.1", path: "apps/web/node_modules/@midnightntwrk/ledger-v8" },
      { name: "@midnightntwrk/ledger-v8", version: "8.1.0", path: "packages/a/node_modules/@midnightntwrk/ledger-v8" },
    ]);
    expect(checks).toEqual([]);
  });

  it("doesn't count nested copies under dependencies as declared twice", () => {
    const checks = buildScopeConflictChecks({}, [
      { name: "@midnightntwrk/ledger-v8", version: "8.1.2", path: "node_modules/@midnightntwrk/ledger-v8" },
      { name: "@midnightntwrk/ledger-v8", version: "8.1.1", path: "node_modules/sdk-a/node_modules/@midnightntwrk/ledger-v8" },
    ]);
    expect(checks).toEqual([]);
  });
});

describe("unresolved versions", () => {
  it("lists a dependency without a concrete version instead of failing it", () => {
    const dir = makeProject({
      dependencies: { "@midnight-ntwrk/ledger-v8": "npm:@midnightntwrk/ledger-v8", "@midnight-ntwrk/compact-runtime": "latest" },
    });
    const checks = checkLocalPackages(row, dir).localPackageChecks ?? [];
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.label === "pkg:@midnightntwrk/ledger-v8")).toMatchObject({
      live: "npm:@midnightntwrk/ledger-v8",
      note: "version not resolved: no npm lockfile entry",
    });
  });
});

describe("checkLocalPackages", () => {
  it("fails a double install that only comes through dependencies", () => {
    const dir = makeProject(
      { dependencies: { "sdk-a": "1.0.0", "sdk-b": "1.0.0" } },
      {
        packages: {
          "node_modules/sdk-a/node_modules/@midnight-ntwrk/ledger-v8": { version: "8.0.3" },
          "node_modules/sdk-b/node_modules/@midnightntwrk/ledger-v8": { version: "8.1.2" },
        },
      },
    );
    const result = checkLocalPackages(row, dir);
    expect(result.localPackages).toBeUndefined();
    expect(result.localPackageChecks).toEqual([expect.objectContaining({ label: "scope:ledger-v8", ok: false })]);
  });

  it("ignores the project's own root and workspace entries in the lockfile", () => {
    const dir = makeProject(
      { name: "@midnightntwrk/ledger-v8" },
      {
        packages: {
          "": { name: "@midnightntwrk/ledger-v8", version: "8.1.2" },
          "packages/tools": { name: "@midnightntwrk/ledger-v8-tools", version: "0.1.0" },
          "node_modules/sdk-a/node_modules/@midnight-ntwrk/ledger-v8": { version: "8.0.3" },
        },
      },
    );
    expect(readInstalledMidnightPackages(dir).map((p) => p.path)).toEqual([
      "node_modules/sdk-a/node_modules/@midnight-ntwrk/ledger-v8",
    ]);
    expect(checkLocalPackages(row, dir).localPackageChecks).toBeUndefined();
  });

  it("reports nothing for a project without Midnight packages", () => {
    const dir = makeProject({ dependencies: { react: "19.0.0" } }, { packages: { "node_modules/react": { version: "19.0.0" } } });
    expect(checkLocalPackages(row, dir)).toEqual({});
  });
});

describe("matrix pins across scopes", () => {
  it("checks a new-scope package against the pin for the same package", () => {
    const checks = buildLocalPackageChecks(row, { "@midnightntwrk/ledger-v8": "8.1.2" });
    expect(checks).toEqual([{ label: "pkg:@midnightntwrk/ledger-v8", expected: "8.1.2", live: "8.1.2", ok: true }]);
    expect(buildLocalPackageChecks(row, { "@midnightntwrk/ledger-v8": "8.0.3" })[0]?.ok).toBe(false);
  });
});

describe("scope conflicts", () => {
  it("fails when package.json declares the same package under both scopes", () => {
    const checks = buildScopeConflictChecks(
      { "@midnight-ntwrk/ledger-v8": "8.1.2", "@midnightntwrk/ledger-v8": "8.1.2" },
      [],
    );
    expect(checks).toEqual([expect.objectContaining({ label: "scope:ledger-v8", ok: false })]);
  });

  it("fails when a dependency pulls in the other scope", () => {
    const checks = buildScopeConflictChecks({ "@midnightntwrk/ledger-v8": "8.1.2" }, [
      { name: "@midnightntwrk/ledger-v8", version: "8.1.2", path: "node_modules/@midnightntwrk/ledger-v8" },
      {
        name: "@midnight-ntwrk/ledger-v8",
        version: "8.0.3",
        path: "node_modules/some-sdk/node_modules/@midnight-ntwrk/ledger-v8",
      },
    ]);
    expect(checks.map((c) => c.label)).toEqual(["scope:ledger-v8"]);
  });

  it("is quiet when every package uses one scope", () => {
    expect(
      buildScopeConflictChecks({ "@midnightntwrk/ledger-v8": "8.1.2", "@midnight-ntwrk/midnight-js": "4.1.1" }, []),
    ).toEqual([]);
  });
});

describe("scope hints", () => {
  const migrated = new Set(["ledger-v8", "wallet-sdk"]);

  it("points old-scope packages at their new-scope release", () => {
    expect(buildScopeHints({ "@midnight-ntwrk/ledger-v8": "8.1.2", "@midnight-ntwrk/midnight-js": "4.1.1" }, migrated)).toEqual([
      "@midnight-ntwrk/ledger-v8 is also published as @midnightntwrk/ledger-v8 (rename only, same API)",
    ]);
  });

  it("says nothing once the new scope is used", () => {
    expect(buildScopeHints({ "@midnightntwrk/ledger-v8": "8.1.2" }, migrated)).toEqual([]);
    expect(
      buildScopeHints({ "@midnight-ntwrk/wallet-sdk": "1.1.0", "@midnightntwrk/wallet-sdk": "1.2.0" }, migrated),
    ).toEqual([]);
  });

  it("prints hints in the human report", () => {
    const report = {
      network: "preprod",
      matrixUpdated: "2026-10",
      matrixStale: false,
      docUrl: "https://example.com",
      expected: row,
      live: { nodeVersion: "1.0.400", runtimeSpecVersion: 1000300, runtimeImplVersion: 0, indexerProtocolVersion: 1000300, indexerApi: "v4" },
      checks: [],
      allOk: true,
      scopeHints: ["@midnight-ntwrk/ledger-v8 is also published as @midnightntwrk/ledger-v8 (rename only, same API)"],
    } satisfies VersionsReport;
    expect(formatVersionsHuman(report)).toContain("npm scope:\n  @midnight-ntwrk/ledger-v8 is also published as");
  });
});
