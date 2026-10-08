import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A standalone binary has no package directory, so it carries the data files and the version in.
let embedded: { version: string; data: Record<string, string> } | undefined;

export function embedPackageFiles(files: { version: string; data: Record<string, string> }): void {
  embedded = files;
}

// This file is dist/lib/data-path.js in the package, and src/lib/data-path.ts in tests.
const here = () => dirname(fileURLToPath(import.meta.url));

export function loadDataJson<T>(filename: string): T {
  const text = embedded ? embedded.data[filename] : readFileSync(join(here(), "..", "data", filename), "utf8");
  if (text === undefined) throw new Error(`${filename} isn't bundled into this binary`);
  return JSON.parse(text) as T;
}

export function packageVersion(): string {
  return embedded?.version ?? (JSON.parse(readFileSync(join(here(), "..", "..", "package.json"), "utf8")) as { version: string }).version;
}
