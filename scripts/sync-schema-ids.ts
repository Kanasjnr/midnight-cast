// Points each schema's $id at the release tag for the package's version, matching the links `explain --json`
// gives. npm runs it after `npm version` bumps package.json. A link to main would change under an installed
// release whenever main's schemas do, such as when schemaVersion moves on.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaBase } from "../src/lib/catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const dir = join(root, "schemas");

for (const file of readdirSync(dir).filter((f) => f.endsWith(".schema.json"))) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");
  const updated = text.replace(/("\$id": ")[^"]*(")/, `$1${schemaBase(pkg.version)}${file}$2`);
  if (updated !== text) writeFileSync(path, updated);
}
console.log(`schemas/ point at ${schemaBase(pkg.version)}`);
