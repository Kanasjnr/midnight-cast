// Keeps one GitHub issue per network in sync with the latest live check:
// opens it on drift, a degraded network or an outage, edits it only when the
// findings change, and closes it once the network is clean again (for a
// degraded network, once a day has passed without the problem). While it
// carries a service-desk draft, the draft's last-seen time is refreshed every
// run and its first-seen time is kept from the issue. Used by .github/workflows/live.yml.
//
//   tsx scripts/live-issue.ts <network> <status> <fingerprint> <report.md>
//
// result.json, written next to report.md by live-check, holds what the draft is built from.
//
// Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY. GITHUB_SERVER_URL
// and GITHUB_RUN_ID are used for the run link in comments.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { redact, reportInput, type CheckResult, type Status } from "./live-check.js";
import { START, firstSeenOf, lastSeenOf, replaceSection, serviceDeskSection } from "./service-desk.js";

export const LABEL = "live-check";
/** Marks an issue for a degraded network, which doesn't block publishing. */
export const DEGRADED_LABEL = "live-check: degraded";
/** A degraded network can come and go between runs; keep its issue open until it's been clean this long. */
export const DEGRADED_QUIET_MS = 24 * 60 * 60 * 1000;

export interface IssueSummary {
  number: number;
  title: string;
  body: string | null;
  labels?: Array<{ name: string }>;
}

export type IssueAction =
  | { type: "none"; reason: string }
  | { type: "create"; title: string }
  | { type: "update"; number: number }
  | { type: "refresh"; number: number }
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
  { hasServiceDesk = false, now = new Date() }: { hasServiceDesk?: boolean; now?: Date } = {},
): IssueAction {
  if (status === "clean") {
    if (!existing) return { type: "none", reason: "clean and no open issue" };
    const lastSeen = lastSeenOf(existing.body);
    if (statusOf(existing.body) === "degraded" && lastSeen && now.getTime() - Date.parse(lastSeen) < DEGRADED_QUIET_MS) {
      return { type: "none", reason: `degraded at ${lastSeen}; closing after a day without it (#${existing.number})` };
    }
    return { type: "close", number: existing.number };
  }
  if (!existing) return { type: "create", title: issueTitle(network) };
  if (fingerprintOf(existing.body) === fingerprint) {
    // The findings are the same, but the service-desk draft's last-seen time moves on.
    return hasServiceDesk
      ? { type: "refresh", number: existing.number }
      : { type: "none", reason: `findings unchanged (#${existing.number})` };
  }
  return { type: "update", number: existing.number };
}

export function statusOf(body: string | null | undefined): string | undefined {
  return /<!-- live-check status: (\w+) -->/.exec(body ?? "")?.[1];
}

export function issueBody(network: string, report: string, status: Status): string {
  return [
    `<!-- live-check status: ${status} -->`,
    `The scheduled live check found that **${network}** no longer matches what midnight-cast expects.`,
    "This issue is maintained by `.github/workflows/live.yml`: it's edited when the findings change and closed automatically once the network is clean, or for a degraded network once a day has passed without the problem.",
    "",
    "Drift usually means the bundled support matrix (`src/data/support-matrix.json`) needs a refresh. An outage means the public endpoints failed after retries. Degraded means the network answers but misbehaves, such as an RPC whose head goes backwards. When the check confirms an outage or sees the RPC's head go backwards, the report ends with a draft for Midnight's service desk, to review and file by hand.",
    "",
    report.trim(),
  ].join("\n");
}

/** The report with its service-desk draft dated from when the issue first saw the problem. */
export function withIssueHistory(report: string, result: CheckResult, existingBody: string | null | undefined): string {
  if (!report.includes(START)) return report;
  return replaceSection(report, redact(serviceDeskSection(reportInput(result), firstSeenOf(existingBody))));
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

  /** Adds or removes the degraded label without touching labels people added. */
  async markDegraded(issue: Pick<IssueSummary, "number" | "labels">, degraded: boolean): Promise<void> {
    const number = issue.number;
    if (issue.labels?.some((l) => l.name === DEGRADED_LABEL) === degraded) return;
    if (degraded) {
      await this.request("POST", `/issues/${number}/labels`, { labels: [DEGRADED_LABEL] });
      return;
    }
    try {
      await this.request("DELETE", `/issues/${number}/labels/${encodeURIComponent(DEGRADED_LABEL)}`);
    } catch (err) {
      if (!String(err).includes("HTTP 404")) throw err;
    }
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
  if (!network || !status || !fingerprint || !reportPath || !["clean", "drift", "degraded", "outage"].includes(status)) {
    console.error("usage: tsx scripts/live-issue.ts <network> <clean|drift|degraded|outage> <fingerprint> <report.md>");
    return 2;
  }
  if (!token || !repo) {
    console.error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
    return 2;
  }

  const gh = new GitHub(token, repo);
  const existing = findIssue(await gh.openLiveCheckIssues(), network);
  const resultPath = join(dirname(reportPath), "result.json");
  let report = readFileSync(reportPath, "utf8");
  if (existsSync(resultPath)) {
    report = withIssueHistory(report, JSON.parse(readFileSync(resultPath, "utf8")) as CheckResult, existing?.body);
  }
  const action = planIssueAction(network, status as Status, fingerprint, existing, { hasServiceDesk: report.includes(START) });
  const degraded = status === "degraded";
  const body = issueBody(network, report, status as Status);
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
        body,
        labels: degraded ? [LABEL, DEGRADED_LABEL] : [LABEL],
      });
      console.log(`opened #${created.number} ${created.html_url}`);
      break;
    }
    case "update":
      // The label first: if the body update then fails, the publish gate still sees a mismatch and blocks.
      await gh.markDegraded(existing!, degraded);
      await gh.request("PATCH", `/issues/${action.number}`, { body });
      await gh.request("POST", `/issues/${action.number}/comments`, {
        body: `Findings changed (status: **${status}**). The issue description now shows the latest report from ${runUrl}.`,
      });
      console.log(`updated #${action.number}`);
      break;
    case "refresh":
      // Same findings, so no comment: only the draft's last-seen time and evidence change.
      await gh.markDegraded(existing!, degraded);
      await gh.request("PATCH", `/issues/${action.number}`, { body });
      console.log(`refreshed #${action.number}`);
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
