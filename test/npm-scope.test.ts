import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isMidnightPackage, loadMigratedPackages, packageBaseName } from "../src/lib/npm-scope.js";
import {
  buildLocalPackageChecks,
  buildScopeConflictChecks,
  buildScopeHints,
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
