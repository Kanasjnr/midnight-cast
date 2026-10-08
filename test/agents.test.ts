import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { END_MARKER, START_MARKER, agentSnippet, skillFile, withSnippet } from "../src/agents/guide.js";
import { agentsInitCommand } from "../src/commands/agents.js";
import { agentFiles, sameText } from "../scripts/agent-files.js";
import { schemaErrors } from "./schema.js";

describe("agent guidance", () => {
  it("is committed exactly as the source renders it", async () => {
    for (const { path, content } of await agentFiles()) {
      expect(sameText(readFileSync(join(process.cwd(), path), "utf8"), content), `${path}: run npm run agent-files`).toBe(true);
    }
  });

  it("only mentions commands that exist", () => {
    const catalog = JSON.parse(execFileSync("node", ["dist/cli.js", "explain", "--json"], { encoding: "utf8" })).data;
    const names = new Set(catalog.commands.map((c: { name: string }) => c.name.split(" ")[0]));
    const mentioned = [...skillFile().matchAll(/`(?:midnight-cast )?([a-z][a-z-]+) [<\-"a-z]/g)].map((m) => m[1]!);
    const commands = mentioned.filter((m) => !["npx", "claude", "gemini"].includes(m));
    expect(commands.length).toBeGreaterThan(5);
    for (const command of commands) expect(names.has(command), command).toBe(true);
  });

  it("follows the Agent Skills naming rules", async () => {
    const [, frontmatter] = skillFile().split("---\n");
    const name = /^name: (.+)$/m.exec(frontmatter!)![1]!;
    const description = /^description: (.+)$/m.exec(frontmatter!)![1]!;
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(description.length).toBeLessThanOrEqual(1024);
    for (const { path } of (await agentFiles()).filter((f) => f.path.endsWith("SKILL.md"))) expect(path).toContain(`skills/${name}/`);
  });
});

describe("the Claude Code plugin", () => {
  const plugin = join(process.cwd(), "plugins", "midnight-cast");
  // A Windows checkout can have CRLF line endings.
  const text = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const json = (path: string) => JSON.parse(text(path));
  const manifest = json(join(plugin, ".claude-plugin", "plugin.json"));
  const evals = join(plugin, "evals");

  it("is listed in the repository's marketplace under its own name", () => {
    const marketplace = json(join(process.cwd(), ".claude-plugin", "marketplace.json"));
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === manifest.name);
    expect(entry).toBeDefined();
    expect(existsSync(join(process.cwd(), entry.source, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("starts the MCP server with only the options it declares", () => {
    const server = json(join(plugin, ".mcp.json")).mcpServers["midnight-cast"];
    expect(server.args.at(-1)).toBe("mcp");
    const referenced = [...JSON.stringify(server).matchAll(/\$\{user_config\.(\w+)\}/g)].map((m) => m[1]!);
    expect(referenced.length).toBeGreaterThan(0);
    for (const key of referenced) expect(manifest.userConfig, key).toHaveProperty(key);
  });

  it("evaluates against mocks of real tools that return valid envelopes", () => {
    // _tools.json is generated from the server, so the drift test keeps it current.
    const tools = new Set(json(join(evals, "mocks", "midnight-cast", "_tools.json")).tools.map((t: { name: string }) => t.name));
    const cases = readdirSync(evals).filter((name) => existsSync(join(evals, name, "prompt.md")));
    expect(cases.length).toBe(5);
    for (const name of cases) {
      const mocks = join(evals, name, "mocks", "midnight-cast");
      for (const file of readdirSync(mocks).filter((f) => f.endsWith(".md") && !f.startsWith("_"))) {
        expect(tools.has(file.replace(/\.md$/, "")), `${name}/${file}`).toBe(true);
        const body = text(join(mocks, file)).replace(/^---\n[\s\S]*?\n---\n/, "");
        expect(schemaErrors(JSON.parse(body)), `${name}/${file}`).toEqual([]);
      }
      for (const file of readdirSync(join(evals, name, "graders"))) {
        const tool = /^tool: mcp__plugin_midnight-cast_midnight-cast__(\w+)$/m.exec(text(join(evals, name, "graders", file)));
        if (tool) expect(tools.has(tool[1]!), `${name}/graders/${file}`).toBe(true);
      }
    }
  });
});

describe("adding the snippet to a file", () => {
  const snippet = agentSnippet("AGENTS.md");

  it("creates, appends, updates in place and leaves the rest of the file alone", () => {
    expect(withSnippet(undefined, snippet)).toEqual({ text: snippet, change: "created" });
    const appended = withSnippet("# My project\n", snippet) as { text: string; change: string };
    expect(appended.change).toBe("appended");
    expect(appended.text.startsWith("# My project\n\n")).toBe(true);
    const old = `# My project\n\n${START_MARKER}\nold guidance\n${END_MARKER}\n\n## Build\nnpm test\n`;
    const updated = withSnippet(old, snippet) as { text: string; change: string };
    expect(updated.change).toBe("updated");
    expect(updated.text).toContain("## Build\nnpm test\n");
    expect(updated.text).not.toContain("old guidance");
    expect(withSnippet((updated as { text: string }).text, snippet)).toMatchObject({ change: "unchanged" });
  });

  it("refuses broken markers instead of guessing, and ignores markers mentioned in prose", () => {
    const missingEnd = `# Proj\n${START_MARKER}\nold\n\n## Build\nnpm test\n`;
    expect(withSnippet(missingEnd, snippet)).toHaveProperty("error");
    expect(withSnippet(`${END_MARKER}\nx\n${START_MARKER}\n`, snippet)).toHaveProperty("error");
    const twice = `${START_MARKER}\na\n${END_MARKER}\n${START_MARKER}\nb\n${END_MARKER}\n`;
    expect(withSnippet(twice, snippet)).toHaveProperty("error");
    const prose = `Our section sits between \`${START_MARKER}\` and \`${END_MARKER}\`.\n`;
    expect(withSnippet(prose, snippet)).toMatchObject({ change: "appended" });
  });

  it("keeps a CRLF file's line endings", () => {
    const result = withSnippet("# P\r\n\r\n", snippet) as { text: string };
    expect(result.text.startsWith(`# P\r\n\r\n${START_MARKER}`)).toBe(true);
    expect(result.text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(withSnippet(result.text, snippet)).toMatchObject({ change: "unchanged" });
  });

  it("prints by default, writes a new file, and won't change an existing one without --yes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-agents-"));
    const printed = await agentsInitCommand({}, { json: true });
    expect(printed.data).toMatchObject({ file: "AGENTS.md", action: "printed" });

    expect((await agentsInitCommand({ write: true, dir, file: "CLAUDE.md" }, { json: true })).data).toMatchObject({ action: "created" });
    writeFileSync(join(dir, "AGENTS.md"), "# Mine\n");
    const refused = await agentsInitCommand({ write: true, dir }, { json: true });
    expect(refused.ok).toBe(false);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe("# Mine\n");
    expect((await agentsInitCommand({ write: true, dir, yes: true }, { json: true })).data).toMatchObject({ action: "appended" });
    expect((await agentsInitCommand({ write: true, dir, yes: true }, { json: true })).data).toMatchObject({ action: "unchanged" });
    expect(await agentsInitCommand({ file: "README.md" }, { json: true })).toMatchObject({ ok: false, errorKind: "usage", exitCode: 2 });
  });
});
