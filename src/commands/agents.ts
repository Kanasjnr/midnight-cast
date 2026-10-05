import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { AGENT_FILES, agentSnippet, withSnippet, type AgentFile } from "../agents/guide.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function agentsInitCommand(
  flags: { file?: string; write?: boolean; yes?: boolean; dir?: string },
  options: GlobalOptions,
): Promise<EmitResult> {
  const file = (flags.file ?? "AGENTS.md") as AgentFile;
  if (!AGENT_FILES.includes(file)) return fail(`--file must be one of ${AGENT_FILES.join(", ")}`, 2);
  const snippet = agentSnippet(file);

  if (!flags.write) {
    return { ok: true, data: options.json ? { file, action: "printed", snippet } : snippet.trimEnd() };
  }

  const path = join(resolve(flags.dir ?? process.cwd()), file);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  const { text, change } = withSnippet(existing, snippet);
  if (change !== "unchanged" && existing !== undefined && !flags.yes) {
    const verb = change === "updated" ? "Update the midnight-cast section of" : "Add a midnight-cast section to the end of";
    // Never change a file someone wrote without their say-so; agents and CI pass --yes.
    if (!process.stdin.isTTY || options.json) return fail(`${path} exists. Pass --yes to ${verb.toLowerCase()} it.`);
    if (!(await confirm(`${verb} ${path}?`))) return fail(`Left ${path} as it was`);
  }
  if (change !== "unchanged") writeFileSync(path, text);
  const action = change === "created" ? "Created" : change === "updated" ? "Updated" : change === "appended" ? "Added a section to" : "Already up to date:";
  return { ok: true, data: options.json ? { file: path, action: change } : `${action} ${path}` };
}
