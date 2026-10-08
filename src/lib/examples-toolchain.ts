// How a project compares with the toolchain Midnight's official examples are pinned to: a set
// that's known to compile and pass its tests together. It's advice next to the support-matrix
// checks, not part of them, since a project can be right on other versions.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NEW_SCOPE, OLD_SCOPE } from "./npm-scope.js";
import type { VersionCheck } from "./versions.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "managed", ".yarn", "coverage"]);

/** Every `pragma language_version …` in the project's .compact files, by file, skipping build output. */
export function findPragmas(dir: string, depth = 6): Array<{ file: string; constraint: string }> {
  const found: Array<{ file: string; constraint: string }> = [];
  const walk = (current: string, level: number) => {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(join(current, entry.name), level + 1);
      } else if (entry.name.endsWith(".compact")) {
        const path = join(current, entry.name);
        const match = /^\s*pragma\s+language_version\s+([^;]+);/m.exec(readFileSync(path, "utf8"));
        if (match) found.push({ file: path, constraint: match[1]!.trim() });
      }
    }
  };
  walk(dir, 0);
  return found;
}

const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));

/**
 * Whether a pragma constraint admits a language version: `0.23` (that version, any patch),
 * `>= 0.25.0`, or terms joined by `&&`. Undefined when it can't be read.
 */
export function pragmaAdmits(constraint: string, version: string): boolean | undefined {
  const want = parts(version);
  const results = constraint.split("&&").map((term) => {
    const m = /^\s*(>=|<=|>|<|==|=)?\s*(\d+(?:\.\d+)*)\s*$/.exec(term);
    if (!m) return undefined;
    const bound = parts(m[2]!);
    const op = m[1] ?? "prefix";
    if (op === "prefix") return bound.every((n, i) => want[i] === n);
    let cmp = 0;
    for (let i = 0; i < Math.max(bound.length, want.length) && cmp === 0; i++) cmp = Math.sign((want[i] ?? 0) - (bound[i] ?? 0));
    return { ">=": cmp >= 0, "<=": cmp <= 0, ">": cmp > 0, "<": cmp < 0, "=": cmp === 0, "==": cmp === 0 }[op];
  });
  return results.some((r) => r === undefined) ? undefined : results.every(Boolean);
}

const core = (v: string) => /(\d+\.\d+\.\d+)/.exec(v)?.[1];
const base = (name: string) => (name.startsWith(OLD_SCOPE) ? name.slice(OLD_SCOPE.length) : name.startsWith(NEW_SCOPE) ? name.slice(NEW_SCOPE.length) : undefined);

function packageCheck(label: string, expected: string, versions: string[]): VersionCheck | undefined {
  const found = [...new Set(versions.map((v) => core(v) ?? v))];
  if (!found.length) return undefined;
  const ok = found.every((v) => v === expected);
  return { label, expected, live: found.join(", "), ok, note: ok ? "as the examples" : `the official examples run ${expected}` };
}

/** The Node.js major a project declares, from .nvmrc or package.json engines. */
function declaredNode(dir: string): string | undefined {
  try {
    if (existsSync(join(dir, ".nvmrc"))) return readFileSync(join(dir, ".nvmrc"), "utf8").trim().replace(/^v/, "");
    const engines = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node;
    return engines?.trim();
  } catch {
    return undefined;
  }
}

/** Whether a declared Node.js version or range admits a major: `22`, `v22.3.0`, `>=20`, `^22`, `22.x`. */
export function nodeAdmits(declared: string, major: string): boolean | undefined {
  const m = /^(>=|\^|~)?\s*v?(\d+)(?:\.(?:\d+|x|\*))*(?:\s.*)?$/.exec(declared.trim());
  if (!m) return undefined;
  const n = Number(m[2]);
  return m[1] === ">=" ? Number(major) >= n : Number(major) === n;
}

/**
 * The project against the examples' toolchain: Midnight.js, testkit and the wallet SDK from its
 * packages, the language from its pragmas, and Node.js from .nvmrc or engines. Only what the
 * project declares is checked.
 */
export function examplesToolchainChecks(
  toolchain: Record<string, string>,
  project: { dir: string; packages?: Record<string, string> },
): VersionCheck[] {
  const entries = Object.entries(project.packages ?? {});
  const versionsOf = (match: (name: string) => boolean) => entries.filter(([name]) => match(base(name) ?? "")).map(([, v]) => v);
  const checks: Array<VersionCheck | undefined> = [];
  const js = toolchain["@midnight-ntwrk/midnight-js-*"];
  if (js) checks.push(packageCheck("midnight-js", js, versionsOf((b) => b.startsWith("midnight-js-"))));
  const testkit = toolchain["@midnight-ntwrk/testkit-js"];
  if (testkit) checks.push(packageCheck("testkit-js", testkit, versionsOf((b) => b === "testkit-js")));
  const wallet = toolchain["wallet SDK"];
  if (wallet) checks.push(packageCheck("wallet-sdk", wallet, versionsOf((b) => b === "wallet-sdk")));

  const language = toolchain["Compact language (pragma)"];
  if (language) {
    const pragmas = findPragmas(project.dir);
    const constraints = [...new Set(pragmas.map((p) => p.constraint))];
    if (constraints.length) {
      const admitted = constraints.map((c) => pragmaAdmits(c, language));
      const ok = admitted.every((a) => a === true);
      checks.push({
        label: "pragma language_version",
        expected: language,
        live: constraints.join(", "),
        ok,
        note: ok ? "admits the examples' language" : admitted.includes(undefined) ? "couldn't read every pragma" : `the official examples use ${language}`,
      });
    }
  }

  const node = toolchain["Node.js"];
  const declared = declaredNode(project.dir);
  if (node && declared) {
    const ok = nodeAdmits(declared, node);
    if (ok !== undefined) checks.push({ label: "node.js", expected: node, live: declared, ok, note: ok ? "admits the examples' Node.js" : `the official examples run Node.js ${node}` });
  }
  return checks.filter((c): c is VersionCheck => !!c);
}
