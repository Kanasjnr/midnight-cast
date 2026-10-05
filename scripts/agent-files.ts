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

// The Claude Code plugin ships the same skill, and its manifest follows the package version.
function pluginManifest(): string {
  const { version, license } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
    license: string;
  };
  const manifest = {
    name: "midnight-cast",
    displayName: "midnight-cast",
    version,
    description:
      "Diagnose Midnight networks, transactions, contracts, DUST and errors with the read-only midnight-cast CLI and MCP server",
    author: { name: "Kanasjnr", url: "https://github.com/Kanasjnr" },
    homepage: "https://github.com/Kanasjnr/midnight-cast",
    repository: "https://github.com/Kanasjnr/midnight-cast",
    license,
    keywords: ["midnight", "blockchain", "indexer", "dust", "errors", "mcp"],
    userConfig: {
      blockfrost_project_id: {
        type: "string",
        title: "Blockfrost project ID (mainnet)",
        description: "A Midnight Mainnet project ID from blockfrost.io, needed only for mainnet. Leave empty for preview and preprod.",
        sensitive: true,
        default: "",
      },
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function agentFiles(): Array<{ path: string; content: string }> {
  return [
    ...AGENT_FILES.map((file) => ({ path: posix.join("docs", "agents", file), content: agentSnippet(file) })),
    { path: posix.join("skills", SKILL_NAME, "SKILL.md"), content: skillFile() },
    { path: posix.join("plugins", "midnight-cast", "skills", SKILL_NAME, "SKILL.md"), content: skillFile() },
    { path: posix.join("plugins", "midnight-cast", ".claude-plugin", "plugin.json"), content: pluginManifest() },
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
