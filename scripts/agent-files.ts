// Writes the committed agent guidance files from src/agents/guide.ts.
//
//   tsx scripts/agent-files.ts [--check]
//
// --check exits 1 if a committed file differs from what the source renders.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AGENT_FILES, SKILL_NAME, agentSnippet, skillFile } from "../src/agents/guide.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// A Windows checkout can turn LF into CRLF; that isn't drift.
export function sameText(a: string | undefined, b: string): boolean {
  return a !== undefined && a.replace(/\r\n/g, "\n") === b;
}

export function agentFiles(): Array<{ path: string; content: string }> {
  return [
    ...AGENT_FILES.map((file) => ({ path: posix.join("docs", "agents", file), content: agentSnippet(file) })),
    { path: posix.join("skills", SKILL_NAME, "SKILL.md"), content: skillFile() },
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { path, content } of agentFiles()) {
    const full = join(root, path);
    const current = existsSync(full) ? readFileSync(full, "utf8") : undefined;
    if (sameText(current, content)) continue;
    if (check) {
      console.log(`out of date: ${path}`);
      stale++;
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      console.log(`wrote ${path}`);
    }
  }
  if (check && stale) console.log("Run npm run agent-files to regenerate them.");
  process.exitCode = stale ? 1 : 0;
}
