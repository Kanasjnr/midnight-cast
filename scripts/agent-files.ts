// Writes the committed agent guidance and Claude Code plugin files from src/agents/guide.ts,
// package.json and the MCP server.
//
//   tsx scripts/agent-files.ts [--check]
//
// --check exits 1 if a committed file differs from what the source renders.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AGENT_FILES, SKILL_NAME, agentSnippet, skillFile } from "../src/agents/guide.js";
import { pluginProjectIdEnv } from "../src/lib/blockfrost.js";
import { createMcpServer } from "../src/mcp/server.js";
import { NETWORK_NAMES } from "../src/networks.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = posix.join("plugins", "midnight-cast");
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const DESCRIPTION =
  "Diagnose Midnight networks, transactions, contracts, DUST and errors with the read-only midnight-cast CLI and MCP server";
const AUTHOR = { name: "Kanasjnr", url: "https://github.com/Kanasjnr" };
const REPOSITORY = "https://github.com/Kanasjnr/midnight-cast";

// A Windows checkout can turn LF into CRLF; that isn't drift.
export function sameText(a: string | undefined, b: string): boolean {
  return a !== undefined && a.replace(/\r\n/g, "\n") === b;
}

// The plugin's version and the server it starts both follow package.json, so an installed
// plugin runs the server it was written for and updates when the package does.
function pluginFiles(): Array<{ path: string; content: string }> {
  const { version, license } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
    license: string;
  };
  const manifest = {
    name: "midnight-cast",
    displayName: "midnight-cast",
    version,
    description: DESCRIPTION,
    author: AUTHOR,
    homepage: REPOSITORY,
    repository: REPOSITORY,
    license,
    keywords: ["midnight", "blockchain", "indexer", "dust", "errors", "mcp"],
    // The mainnet option keeps its original key, so an ID users already saved still applies.
    userConfig: {
      blockfrost_preprod_project_id: {
        type: "string",
        title: "Blockfrost project ID (preprod)",
        description: "A Midnight Preprod project ID from blockfrost.io, needed only for preprod. Leave empty for preview.",
        sensitive: true,
        default: "",
      },
      blockfrost_project_id: {
        type: "string",
        title: "Blockfrost project ID (mainnet)",
        description: "A Midnight Mainnet project ID from blockfrost.io, needed only for mainnet. Leave empty for preview.",
        sensitive: true,
        default: "",
      },
    },
  };
  const mcp = {
    mcpServers: {
      "midnight-cast": {
        command: "npx",
        args: ["-y", `midnight-cast@${version}`, "mcp"],
        env: {
          [pluginProjectIdEnv("preprod")]: "${user_config.blockfrost_preprod_project_id}",
          [pluginProjectIdEnv("mainnet")]: "${user_config.blockfrost_project_id}",
        },
      },
    },
  };
  const marketplace = {
    name: "midnight-cast",
    description: "midnight-cast: read-only tools for the live Midnight networks",
    owner: AUTHOR,
    plugins: [{ name: "midnight-cast", source: `./${plugin}`, description: DESCRIPTION }],
  };
  return [
    { path: posix.join(plugin, ".claude-plugin", "plugin.json"), content: json(manifest) },
    { path: posix.join(plugin, ".mcp.json"), content: json(mcp) },
    { path: posix.join(plugin, "skills", SKILL_NAME, "SKILL.md"), content: skillFile(true) },
    { path: posix.join(".claude-plugin", "marketplace.json"), content: json(marketplace) },
  ];
}

// The evals' mocked tools carry the real descriptions and input schemas from this list.
async function evalToolList(): Promise<{ path: string; content: string }> {
  const server = createMcpServer({ version: "0", catalog: () => ({}) as never, networks: [...NETWORK_NAMES], callsPerMinute: 30 });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent-files", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return { path: posix.join(plugin, "evals", "mocks", "midnight-cast", "_tools.json"), content: json({ tools }) };
}

export async function agentFiles(): Promise<Array<{ path: string; content: string }>> {
  return [
    ...AGENT_FILES.map((file) => ({ path: posix.join("docs", "agents", file), content: agentSnippet(file) })),
    { path: posix.join("skills", SKILL_NAME, "SKILL.md"), content: skillFile() },
    ...pluginFiles(),
    await evalToolList(),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { path, content } of await agentFiles()) {
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
