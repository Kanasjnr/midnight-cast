// Keeps one GitHub issue per network in sync with the latest live check:
// opens it on drift/outage, edits it only when the findings change, and
// closes it once the network is clean again. Used by .github/workflows/live.yml.
//
//   tsx scripts/live-issue.ts <network> <status> <fingerprint> <report.md>
//
// Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY. GITHUB_SERVER_URL
// and GITHUB_RUN_ID are used for the run link in comments.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Status } from "./live-check.js";

export const LABEL = "live-check";

export interface IssueSummary {
  number: number;
  title: string;
  body: string | null;
}

export type IssueAction =
  | { type: "none"; reason: string }
  | { type: "create"; title: string }
  | { type: "update"; number: number }
  | { type: "close"; number: number };

export function issueTitle(network: string): string {
  return `Live check: ${network}`;
}

export function fingerprintOf(body: string | null | undefined): string | undefined {
  return /<!-- live-check fingerprint: ([0-9a-f]+) -->/.exec(body ?? "")?.[1];
}

export function findIssue(issues: IssueSummary[], network: string): IssueSummary | undefined {
  const title = issueTitle(network);
  return issues.find((i) => i.title === title);
}

export function planIssueAction(
  network: string,
  status: Status,
  fingerprint: string,
  existing: IssueSummary | undefined,
): IssueAction {
  if (status === "clean") {
    return existing
      ? { type: "close", number: existing.number }
      : { type: "none", reason: "clean and no open issue" };
  }
  if (!existing) return { type: "create", title: issueTitle(network) };
  if (fingerprintOf(existing.body) === fingerprint) {
    return { type: "none", reason: `findings unchanged (#${existing.number})` };
  }
  return { type: "update", number: existing.number };
}

export function issueBody(network: string, report: string): string {
  return [
    `The scheduled live check found that **${network}** no longer matches what midnight-cast expects.`,
    "This issue is maintained by `.github/workflows/live.yml`: it's edited when the findings change and closed automatically once the network is clean.",
    "",
    "Drift usually means the bundled support matrix (`src/data/support-matrix.json`) needs a refresh. An outage means the public endpoints failed after retries.",
    "",
    report.trim(),
  ].join("\n");
}

// ---------------------------------------------------------------- GitHub ---

class GitHub {
  constructor(
    private readonly token: string,
    private readonly repo: string,
    private readonly api = process.env.GITHUB_API_URL ?? "https://api.github.com",
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.api}/repos/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async openLiveCheckIssues(): Promise<IssueSummary[]> {
    const items = await this.request<Array<IssueSummary & { pull_request?: unknown }>>(
      "GET",
      `/issues?state=open&labels=${encodeURIComponent(LABEL)}&per_page=100`,
    );
    return items.filter((i) => !i.pull_request);
  }
}

async function main(): Promise<number> {
  const [network, status, fingerprint, reportPath] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!network || !status || !fingerprint || !reportPath || !["clean", "drift", "outage"].includes(status)) {
    console.error("usage: tsx scripts/live-issue.ts <network> <clean|drift|outage> <fingerprint> <report.md>");
    return 2;
  }
  if (!token || !repo) {
    console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
    return 2;
  }

  const gh = new GitHub(token, repo);
  const report = readFileSync(reportPath, "utf8");
  const existing = findIssue(await gh.openLiveCheckIssues(), network);
  const action = planIssueAction(network, status as Status, fingerprint, existing);
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "this run";

  switch (action.type) {
    case "none":
      console.log(`no change: ${action.reason}`);
      break;
    case "create": {
      const created = await gh.request<{ number: number; html_url: string }>("POST", "/issues", {
        title: action.title,
        body: issueBody(network, report),
        labels: [LABEL],
      });
      console.log(`opened #${created.number} ${created.html_url}`);
      break;
    }
    case "update":
      await gh.request("PATCH", `/issues/${action.number}`, { body: issueBody(network, report) });
      await gh.request("POST", `/issues/${action.number}/comments`, {
        body: `Findings changed (status: **${status}**). The issue description now shows the latest report from ${runUrl}.`,
      });
      console.log(`updated #${action.number}`);
      break;
    case "close":
      await gh.request("POST", `/issues/${action.number}/comments`, {
        body: `All checks for **${network}** are clean as of ${runUrl}. Closing.`,
      });
      await gh.request("PATCH", `/issues/${action.number}`, { state: "closed", state_reason: "completed" });
      console.log(`closed #${action.number}`);
      break;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    },
  );
}
