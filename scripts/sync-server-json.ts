// Keeps server.json, the MCP Registry entry, at the package's version. npm runs it after
// `npm version` bumps package.json; the registry rejects an entry whose version npm doesn't have.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };
const path = join(root, "server.json");
const server = JSON.parse(readFileSync(path, "utf8")) as { version: string; packages: Array<{ identifier: string; version: string }> };

server.version = pkg.version;
for (const entry of server.packages) if (entry.identifier === pkg.name) entry.version = pkg.version;
writeFileSync(path, `${JSON.stringify(server, null, 2)}\n`);
console.log(`server.json is at ${pkg.version}`);
