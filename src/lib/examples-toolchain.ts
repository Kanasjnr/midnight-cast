// How a project compares with the toolchain Midnight's official examples are pinned to: a set
// that's known to compile and pass its tests together. It's advice next to the support-matrix
// checks, not part of them, since a project can be right on other versions.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packageBaseName } from "./npm-scope.js";
import { compareVersions, type VersionCheck } from "./versions.js";

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "managed", "coverage", "target", "out"]);
const MAX_DEPTH = 4;
const MAX_DIRS = 500;

/** Every `pragma language_version …` in the project's .compact files, skipping build output and anything unreadable. */
export function findPragmas(dir: string): Array<{ file: string; constraint: string }> {
  const found: Array<{ file: string; constraint: string }> = [];
  let visited = 0;
  const walk = (current: string, level: number) => {
    if (level > MAX_DEPTH || ++visited > MAX_DIRS) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(path, level + 1);
      } else if (entry.isFile() && entry.name.endsWith(".compact")) {
        try {
          const match = /^\s*pragma\s+language_version\s+([^;]+);/m.exec(readFileSync(path, "utf8"));
          if (match) found.push({ file: path, constraint: match[1]!.trim() });
        } catch {
          // An unreadable file is left out; this check is advice and mustn't fail versions.
        }
      }
    }
  };
  walk(dir, 0);
  return found;
}

/** Whether two versions agree on every component the shorter one names: "0.23" and "0.23.0" do. */
function samePrefix(a: string, b: string): boolean {
  const pa = a.split(".");
  const pb = b.split(".");
  return pa.slice(0, Math.min(pa.length, pb.length)).every((n, i) => Number(n) === Number(pb[i]));
}

/**
 * Whether a version satisfies a range, in the forms package.json, .nvmrc and Compact pragmas use:
 * `||` alternatives of space- or `&&`-joined comparators (`>=`, `>`, `<=`, `<`, `=`), caret and
 * tilde ranges, x-ranges (`22.x`, `22`) and bare versions. Undefined when the range has anything
 * else, such as a dist-tag or a workspace link.
 */
export function satisfies(range: string, version: string): boolean | undefined {
  const alternatives = range.split("||").map((alternative) => {
    // Compact writes ">= 0.16", with a space after the operator.
    const terms = alternative.replace(/&&/g, " ").replace(/(>=|<=|==|>|<|=|\^|~)\s+/g, "$1").trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return undefined;
    const results = terms.map((term) => {
      const m = /^(>=|<=|>|<|==|=|\^|~)?v?(\d+(?:\.(?:\d+|x|\*))*)$/.exec(term);
      if (!m) return undefined;
      const bound = m[2]!.replace(/\.(x|\*)$/g, "").replace(/\.(x|\*)/g, "");
      const cmp = compareVersions(version, bound);
      const [major, minor] = bound.split(".").map(Number);
      switch (m[1]) {
        case ">=": return cmp >= 0;
        case ">": return cmp > 0;
        case "<=": return cmp <= 0 || samePrefix(bound, version);
        case "<": return cmp < 0;
        case "^": return cmp >= 0 && (major === 0 ? samePrefix(`${major}.${minor ?? 0}`, version) : samePrefix(`${major}`, version));
        case "~": return cmp >= 0 && samePrefix(`${major}.${minor ?? 0}`, version);
        default: return samePrefix(bound, version);
      }
    });
    return results.some((r) => r === undefined) ? undefined : results.every(Boolean);
  });
  if (alternatives.some((a) => a === true)) return true;
  return alternatives.some((a) => a === undefined) ? undefined : false;
}

/** A package check against the examples' version: exact pins and installed versions compared, ranges asked whether they admit it, anything else left out. */
function packageCheck(label: string, expected: string, specs: string[]): VersionCheck | undefined {
  const verdicts = specs.map((spec) => satisfies(spec, expected));
  if (!verdicts.length || verdicts.every((v) => v === undefined)) return undefined;
  const ok = verdicts.every((v) => v !== false);
  const live = [...new Set(specs)].join(", ");
  return { label, expected, live, ok, note: ok ? "admits the examples' version" : `the official examples run ${expected}` };
}

/** The Node.js version a project declares, from .nvmrc or package.json engines. */
function declaredNode(dir: string): string | undefined {
  try {
    if (existsSync(join(dir, ".nvmrc"))) return readFileSync(join(dir, ".nvmrc"), "utf8").trim();
    return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { engines?: { node?: string } }).engines?.node?.trim();
  } catch {
    return undefined;
  }
}

/** Whether a declared Node.js version or range admits some release of a major. */
export function nodeAdmits(declared: string, major: string): boolean | undefined {
  // An exact version, as .nvmrc usually holds, admits its own major.
  const exact = /^v?(\d+)(?:\.\d+){0,2}$/.exec(declared.trim());
  if (exact) return exact[1] === major;
  const tries = [`${major}.0.0`, `${major}.99.99`].map((v) => satisfies(declared, v));
  if (tries.includes(true)) return true;
  return tries.includes(undefined) ? undefined : false;
}

/**
 * The project against the examples' toolchain: Midnight.js, testkit and the wallet SDK from its
 * packages, the language from its pragmas, and Node.js from .nvmrc or engines. Only what the
 * project declares, in forms that can be read, is checked.
 */
export function examplesToolchainChecks(
  toolchain: Record<string, string>,
  project: { dir: string; packages?: Record<string, string> },
): VersionCheck[] {
  const entries = Object.entries(project.packages ?? {});
  const specsOf = (match: (base: string) => boolean) =>
    entries.filter(([name]) => match(packageBaseName(name) ?? "")).map(([, spec]) => spec);
  const checks: Array<VersionCheck | undefined> = [];
  const js = toolchain["@midnight-ntwrk/midnight-js-*"];
  if (js) checks.push(packageCheck("midnight-js", js, specsOf((b) => b.startsWith("midnight-js-"))));
  const testkit = toolchain["@midnight-ntwrk/testkit-js"];
  if (testkit) checks.push(packageCheck("testkit-js", testkit, specsOf((b) => b === "testkit-js")));
  const wallet = toolchain["wallet SDK"];
  if (wallet) checks.push(packageCheck("wallet-sdk", wallet, specsOf((b) => b === "wallet-sdk")));

  const language = toolchain["Compact language (pragma)"];
  // Only a directory that is a project gets walked: the MCP server's default may be / or a home directory.
  if (language && existsSync(join(project.dir, "package.json"))) {
    const readable = [...new Set(findPragmas(project.dir).map((p) => p.constraint))]
      .map((constraint) => ({ constraint, admits: satisfies(constraint, language) }))
      .filter((p) => p.admits !== undefined);
    if (readable.length) {
      const ok = readable.every((p) => p.admits);
      checks.push({
        label: "pragma language_version",
        expected: language,
        live: readable.map((p) => p.constraint).join(", "),
        ok,
        note: ok ? "admits the examples' language" : `the official examples use ${language}`,
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
