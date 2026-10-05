// One source for the guidance an AI coding agent gets about midnight-cast: the AGENTS.md,
// CLAUDE.md and GEMINI.md snippets and the portable SKILL.md are all rendered from here.

export const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] as const;
export type AgentFile = (typeof AGENT_FILES)[number];

export const START_MARKER = "<!-- midnight-cast:start -->";
export const END_MARKER = "<!-- midnight-cast:end -->";

const MCP_SETUP: Record<AgentFile, string> = {
  "AGENTS.md": "If your agent supports MCP, `midnight-cast mcp` serves the same commands as tools; setup for each client is in https://github.com/Kanasjnr/midnight-cast/blob/main/docs/MCP.md.",
  "CLAUDE.md": "To use it as MCP tools instead of shell commands: `claude mcp add --transport stdio midnight-cast -- npx -y midnight-cast mcp`.",
  "GEMINI.md": "To use it as MCP tools instead of shell commands: `gemini mcp add midnight-cast npx -y midnight-cast mcp`.",
};

const GUIDE = `midnight-cast is a read-only CLI for the Midnight networks (preview, preprod, mainnet, local). It needs no wallet or keys, so its commands are safe to run without asking. Use it instead of guessing when a Midnight error, transaction, contract or network is involved. It needs midnight-cast 0.2.0 or later (\`npx -y midnight-cast@latest\`).

**Always add \`--json\`.** Every command then prints one envelope: \`ok\`, \`data\`, \`error\` (\`message\`, \`kind\`, \`hint\`), \`warnings\` and \`next\`. Read \`error.hint\` before deciding what's wrong, and follow \`next\`: each step is a command an expert would run next. Exit codes are 0 for success, 1 for a failed check or request, and 2 for a usage error.

**Debug ladder**

1. The user has an error message: \`midnight-cast decode --raw "<the whole message>" --json\`, with \`--network <network>\` if known. It recognises 1010 rejections, \`Custom(N)\` ledger codes, pallet errors, JSON-RPC codes and messages from current tooling (old toolkit versions, Blockfrost tokens, Compact builds for ledger 9). Decode before explaining an error; don't rely on memory.
2. The network might be the problem rather than the code: \`midnight-cast health <network> --json\`, then \`ping\` or \`tip\` to narrow it down.
3. Versions might not match: \`midnight-cast versions <network> --project-dir <project> --json\` compares the live network and the project's Midnight packages with the support matrix.
4. Something happened on chain: \`tx <hash>\` for a transaction, \`contract <address>\` for a deployed contract (latest action, circuit, deploy block), \`dust-status <cardano-reward-address>\` when a wallet has no DUST, \`dust-event <id>\` and \`dust-events\` for DUST ledger events.
5. Background on a topic: \`midnight-cast explain dust|1010|versions|transcript\`. \`midnight-cast explain --json\` lists every command, option, exit code and error kind.

Mainnet goes through Blockfrost: set \`BLOCKFROST_PROJECT_ID\` to a Midnight Mainnet project ID. midnight-cast never prints it.`;

export function agentSnippet(file: AgentFile): string {
  return `${START_MARKER}
## Midnight networks and errors: midnight-cast

${GUIDE}

${MCP_SETUP[file]}
${END_MARKER}
`;
}

export const SKILL_NAME = "midnight-cast";

// The Claude Code plugin's copy of the skill, whose tools are already connected.
const IN_PLUGIN = `**In this plugin.** The plugin runs the midnight-cast MCP server, so call its tools instead of the shell. Each command above is a tool of the same name, with \`dust_event\`, \`dust_events\` and \`dust_status\` for the hyphenated ones; they take the same arguments and return the same envelope. For mainnet the user enters a Blockfrost project ID in the plugin's options (\`/plugin\`, then midnight-cast, then Configure options), or exports \`BLOCKFROST_PROJECT_ID\` before starting Claude Code.`;

export function skillFile(forPlugin = false): string {
  return `---
name: ${SKILL_NAME}
description: Diagnose Midnight blockchain problems with the read-only midnight-cast CLI. Decodes Midnight errors (1010 rejections, Custom(N) ledger codes, pallet and JSON-RPC errors, toolkit and Blockfrost messages), checks network health and versions on preview, preprod and mainnet, and looks up transactions, contracts, DUST registration and DUST events. Use when a Midnight error, transaction, contract or network is involved.
license: Apache-2.0
compatibility: Needs Node.js 20 or later and network access; mainnet needs a Blockfrost project ID.
---

# midnight-cast

${GUIDE}
${forPlugin ? `\n${IN_PLUGIN}\n` : ""}`;
}

export type SnippetChange = "created" | "updated" | "appended" | "unchanged";

const lineOf = (marker: string) => new RegExp(`^${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?$`, "gm");

/**
 * Inserts or replaces the marked midnight-cast section, leaving the rest of the file alone.
 * Markers count only on their own line. Anything but one start line followed by one end line
 * is refused, since guessing which part is ours could delete the user's text.
 */
export function withSnippet(
  existing: string | undefined,
  snippet: string,
): { text: string; change: SnippetChange } | { error: string } {
  if (existing === undefined) return { text: snippet, change: "created" };
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const ours = snippet.replace(/\n/g, eol);
  const starts = [...existing.matchAll(lineOf(START_MARKER))];
  const ends = [...existing.matchAll(lineOf(END_MARKER))];

  if (starts.length === 0 && ends.length === 0) {
    const separator = existing.length === 0 || existing.endsWith(eol + eol) ? "" : existing.endsWith(eol) ? eol : eol + eol;
    return { text: existing + separator + ours, change: "appended" };
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0]!.index! < starts[0]!.index!) {
    return { error: `expected one "${START_MARKER}" line followed by one "${END_MARKER}" line` };
  }
  const endLine = ends[0]!;
  const text = existing.slice(0, starts[0]!.index) + ours.trimEnd() + existing.slice(endLine.index! + endLine[0].replace(/\r$/, "").length);
  return { text, change: text === existing ? "unchanged" : "updated" };
}
