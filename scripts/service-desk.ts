// Drafts a report for Midnight's service desk (midnightntwrk/servicedesk, bug-report form)
// from a live check that confirmed an outage or a degraded network. It is only a draft:
// Midnight's AI-report policy needs a person to verify the evidence and submit it, and a
// P1 also needs a page that no bot can make. The live-check issue carries it for review.

import { takeProjectId } from "../src/lib/blockfrost.js";

export const START = "<!-- service-desk:start -->";
export const END = "<!-- service-desk:end -->";
const SERVICE_DESK = "https://github.com/midnightntwrk/servicedesk";

export interface Attempt {
  at: string;
  services: Array<{ service: string; status: string; latencyMs: number; detail?: string; errorKind?: string }>;
  sync?: { rpcHeight: number; indexerHeight: number; delta: number; threshold: number; inSync: boolean };
  error?: string;
}

export interface HeadSample {
  at: string;
  ms: number;
  head?: number;
  error?: string;
}

export interface ReportInput {
  network: string;
  attempts: Attempt[];
  heads?: HeadSample[];
  endpoints?: { rpc: string; indexerHttp: string; blockfrost: boolean };
  nodeVersion?: string;
  environment?: string;
  runUrl?: string;
}

/** A head this many blocks below the highest one already seen means a backend is behind. */
export const HEAD_TOLERANCE = 2;

/** The largest step back in a series of heads, or undefined if it never went back past the tolerance. */
export function headRegression(heads: HeadSample[] = []): { from: number; to: number; drop: number } | undefined {
  let highest: number | undefined;
  let worst: { from: number; to: number; drop: number } | undefined;
  for (const { head } of heads) {
    if (head === undefined) continue;
    if (highest !== undefined && highest - head > HEAD_TOLERANCE && highest - head > (worst?.drop ?? 0)) {
      worst = { from: highest, to: head, drop: highest - head };
    }
    highest = Math.max(highest ?? head, head);
  }
  return worst;
}

type Problem =
  | { kind: "unreachable"; services: string[] }
  | { kind: "lag" }
  | { kind: "heads"; from: number; to: number; drop: number };

const REQUIRED = new Set(["rpc", "indexer"]);
const failed = (a: Attempt) => a.services.filter((s) => REQUIRED.has(s.service) && s.status !== "OK");

/** Blockfrost refusing the project ID is a problem with our secret, not with the network. */
export function rejectedCredentials(input: ReportInput): boolean {
  const last = input.attempts.at(-1);
  return !!input.endpoints?.blockfrost && !!last && failed(last).some((s) => s.errorKind === "http_4xx");
}

export function problems(input: ReportInput): Problem[] {
  const found: Problem[] = [];
  const last = input.attempts.at(-1);
  if (last && !rejectedCredentials(input)) {
    const down = failed(last).map((s) => s.service);
    if (down.length) found.push({ kind: "unreachable", services: down });
    else if (last.sync && !last.sync.inSync) found.push({ kind: "lag" });
  }
  const regression = headRegression(input.heads);
  if (regression) found.push({ kind: "heads", ...regression });
  return found;
}

const NETWORK: Record<string, string> = { mainnet: "Mainnet", preprod: "Preprod", preview: "Preview" };
const COMPONENT = {
  node: { option: "Infra — Node (midnight-node)", label: "component:midnight-node" },
  indexer: { option: "Infra — Indexer (midnight-indexer)", label: "component:indexer" },
};
const SEVERITY = {
  P1: { option: "P1 Critical — Network down, consensus failure, active security exploit. Response: 30 min.", label: "priority:p1-critical" },
  P2: { option: "P2 High — Major feature broken, significant user impact, security vulnerability. Response: 4 business hours.", label: "priority:p2-high" },
  P3: { option: "P3 Medium — Feature degraded, workaround available, non-critical bug. Response: 1 business day.", label: "priority:p3-medium" },
};

const ERROR_WORDS: Record<string, string> = {
  timeout: "no response before the client timeout",
  dns: "the hostname didn't resolve",
  refused: "connection refused",
  tls: "the TLS handshake failed",
  network: "the connection failed",
  http_5xx: "a server error",
  http_4xx: "a client error",
  invalid_response: "a response that wasn't valid JSON or had no result",
  rpc_error: "a JSON-RPC error",
  graphql_error: "a GraphQL error",
};

const SERVICE_NAME: Record<string, string> = { rpc: "RPC", indexer: "indexer" };

function displayUrl(url: string): string {
  return takeProjectId(url).url.replace(/\/$/, "");
}

function curl(url: string, body: string, blockfrost: boolean): string {
  return [
    `curl -sS -m 20 -w '\\nHTTP %{http_code} in %{time_total}s\\n' -X POST \\`,
    `  -H 'Content-Type: application/json' \\`,
    ...(blockfrost ? [`  -H "project_id: $BLOCKFROST_PROJECT_ID" \\`] : []),
    `  -d '${body}' \\`,
    `  ${displayUrl(url)}`,
  ].join("\n");
}

const RPC_HEALTH = '{"jsonrpc":"2.0","id":1,"method":"system_health","params":[]}';
const RPC_HEADER = '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}';
const INDEXER_HEIGHT = '{"query":"query { block { height } }"}';

function headLoop(rpc: string, blockfrost: boolean): string {
  return [
    "for i in $(seq 1 15); do",
    "  n=$(curl -sS -m 20 -X POST -H 'Content-Type: application/json' \\",
    ...(blockfrost ? [`    -H "project_id: $BLOCKFROST_PROJECT_ID" \\`] : []),
    `    -d '${RPC_HEADER}' ${displayUrl(rpc)} \\`,
    `    | grep -o '"number":"0x[0-9a-fA-F]*"' | cut -d'"' -f4)`,
    '  echo "$(date -u +%H:%M:%S) ${n:+$((n))}"',
    "  sleep 2",
    "done",
  ].join("\n");
}

const time = (iso: string) => iso.replace(/\.\d+Z$/, "Z");
const clock = (iso: string) => iso.slice(11, 19);

function attemptLines(input: ReportInput): string[] {
  return input.attempts.map((a) => {
    const services = a.services
      .filter((s) => REQUIRED.has(s.service))
      .map((s) =>
        [`${s.service}=${s.status}`, `${s.latencyMs}ms`, s.errorKind, s.detail && `"${s.detail}"`].filter(Boolean).join(" "),
      );
    const sync = a.sync ? ` node=${a.sync.rpcHeight} indexer=${a.sync.indexerHeight} behind=${a.sync.delta}` : "";
    return `${time(a.at)} ${a.error ? `error "${a.error}"` : services.join(" ")}${sync}`;
  });
}

function headLines(heads: HeadSample[]): string[] {
  let highest: number | undefined;
  return heads.map((h) => {
    if (h.head === undefined) return `${clock(h.at)} no response (${h.error ?? "failed"}) ${h.ms}ms`;
    const back = highest !== undefined && h.head < highest ? `   <- ${highest - h.head} below ${highest}` : "";
    highest = Math.max(highest ?? h.head, h.head);
    return `${clock(h.at)} head=${h.head} ${h.ms}ms${back}`;
  });
}

interface Draft {
  title: string;
  component: keyof typeof COMPONENT;
  severity: keyof typeof SEVERITY;
  severityNote?: string;
  description: string;
  expected: string;
  actual: string;
  /** Shell commands only; stepsBefore and stepsAfter are prose around them. */
  steps: string;
  stepsBefore?: string;
  stepsAfter?: string;
  logs: string[];
}

function draft(problem: Problem, input: ReportInput, window: { firstSeen: string; lastSeen: string }): Draft {
  const net = NETWORK[input.network] ?? input.network;
  const rpc = input.endpoints?.rpc ?? "<rpc url>";
  const indexer = input.endpoints?.indexerHttp ?? "<indexer url>";
  const blockfrost = !!input.endpoints?.blockfrost;
  const attempts = input.attempts;
  const span = `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} between ${time(attempts[0]?.at ?? window.lastSeen)} and ${time(attempts.at(-1)?.at ?? window.lastSeen)}`;

  if (problem.kind === "unreachable") {
    const both = problem.services.length > 1;
    const names = problem.services.map((s) => SERVICE_NAME[s] ?? s).join(" and ");
    const last = attempts.at(-1)!;
    const failures = failed(last)
      .map((s) => `${SERVICE_NAME[s.service] ?? s.service}: ${s.detail ?? "failed"} (${ERROR_WORDS[s.errorKind ?? ""] ?? s.errorKind ?? "unknown error"})`)
      .join("; ");
    return {
      title: `[Bug]: ${net} public ${names} unreachable`,
      component: problem.services.includes("rpc") ? "node" : "indexer",
      severity: both ? "P1" : "P2",
      ...(both
        ? {
            severityNote:
              "P1 only if the network is down for everyone. Confirm it from another location with the commands below first, and page Midnight as their P1 process requires: a GitHub issue alone isn't enough. If it isn't down everywhere, file it as P2.",
          }
        : {}),
      description: `The public ${net} ${names} ${both ? "were" : "was"} unreachable from a scheduled check running in GitHub Actions. Every one of ${span} failed.`,
      expected: [
        ...(problem.services.includes("rpc") ? ["`system_health` on the public RPC answers with HTTP 200 and a JSON-RPC result."] : []),
        ...(problem.services.includes("indexer") ? ["The indexer's GraphQL endpoint answers `{ block { height } }` with HTTP 200 and data."] : []),
      ].join(" "),
      actual: `In the last attempt, at ${time(last.at)}: ${failures}.`,
      steps: [
        ...(problem.services.includes("rpc") ? [curl(rpc, RPC_HEALTH, blockfrost)] : []),
        ...(problem.services.includes("indexer") ? [curl(indexer, INDEXER_HEIGHT, blockfrost)] : []),
      ].join("\n\n"),
      logs: attemptLines(input),
    };
  }

  if (problem.kind === "lag") {
    const sync = attempts.at(-1)!.sync!;
    return {
      title: `[Bug]: ${net} indexer ${sync.delta} blocks behind the node`,
      component: "indexer",
      severity: "P3",
      description: `The public ${net} indexer is behind the node it indexes. A scheduled check running in GitHub Actions saw it behind in every one of ${span}, so reads from the indexer (wallet sync, DApp queries) return stale state.`,
      expected: `The indexer stays within ${sync.threshold} blocks of the node.`,
      actual: `At ${time(attempts.at(-1)!.at)} the node was at block ${sync.rpcHeight} and the indexer at ${sync.indexerHeight}: ${sync.delta} blocks behind.`,
      stepsBefore: "Compare the node's head with the indexer's latest block.",
      steps: `${curl(rpc, RPC_HEADER, blockfrost)}\n\n${curl(indexer, INDEXER_HEIGHT, blockfrost)}`,
      stepsAfter: "The node's `number` is hex; `printf '%d\\n' 0x...` converts it.",
      logs: attemptLines(input),
    };
  }

  const heads = input.heads ?? [];
  return {
    title: `[Bug]: ${net} public RPC returns chain heads that go backwards`,
    component: "node",
    severity: "P3",
    description: `Consecutive \`chain_getHeader\` calls to the public ${net} RPC, about two seconds apart, returned block numbers that went backwards and then forward again. The responses are well-formed. This is consistent with a node behind the load balancer that isn't keeping up; we can't see which backend served each response, so that part is an inference.`,
    expected: "Consecutive `chain_getHeader` calls return a non-decreasing block number that tracks the network head.",
    actual: `Between ${clock(heads[0]?.at ?? window.firstSeen)} and ${clock(heads.at(-1)?.at ?? window.lastSeen)} UTC on ${(heads[0]?.at ?? window.firstSeen).slice(0, 10)}, the head went back by up to ${problem.drop} blocks (from ${problem.from} to ${problem.to}). Clients reading the head see a different chain depending on which response they get.`,
    stepsBefore: "While the problem is active, the printed numbers alternate between the current head and a lower one.",
    steps: headLoop(rpc, blockfrost),
    logs: headLines(heads),
  };
}

function render(d: Draft, input: ReportInput, window: { firstSeen: string; lastSeen: string }): string {
  const network = NETWORK[input.network] ?? input.network;
  const body = [
    "### Component",
    "",
    COMPONENT[d.component].option,
    "",
    "### Network",
    "",
    network,
    "",
    "### Severity",
    "",
    SEVERITY[d.severity].option,
    "",
    "### First seen where?",
    "",
    "Other",
    "",
    "### Bug Description",
    "",
    d.description,
    "",
    "### Expected Behavior",
    "",
    d.expected,
    "",
    "### Actual Behavior",
    "",
    d.actual,
    "",
    "### Steps to Reproduce",
    "",
    "These need only `curl`" + (input.endpoints?.blockfrost ? ", and a Midnight Mainnet project ID from blockfrost.io in `BLOCKFROST_PROJECT_ID`." : ".") +
      (d.stepsBefore ? ` ${d.stepsBefore}` : ""),
    "",
    "```bash",
    d.steps,
    "```",
    "",
    ...(d.stepsAfter ? [d.stepsAfter, ""] : []),
    "### Logs and Error Messages",
    "",
    "```shell",
    ...d.logs,
    "```",
    "",
    "### Operating System",
    "",
    input.environment ?? "GitHub Actions runner",
    "",
    ...(input.nodeVersion ? ["### Node Version (if applicable)", "", `midnight-node ${input.nodeVersion} (reported by the network)`, ""] : []),
    "### Additional Context",
    "",
    `First seen ${time(window.firstSeen)}, last seen ${time(window.lastSeen)} (UTC), by a check that runs every six hours.${input.runUrl ? ` Latest run: ${input.runUrl}` : ""}`,
    ...(input.endpoints?.blockfrost
      ? ["", "Mainnet's public RPC and indexer are run by Blockfrost, so Blockfrost may need to hear about this too."]
      : []),
    "",
    "### Pre-submission Checklist",
    "",
    "- [ ] I have searched existing issues to ensure this is not a duplicate",
    "- [ ] I have provided enough information to reproduce the issue",
    "- [ ] This is not a security vulnerability (if it is, please email security@midnight.foundation instead)",
  ].join("\n");

  const labels = [`network:${input.network}`, COMPONENT[d.component].label, SEVERITY[d.severity].label].map((l) => `\`${l}\``);
  return [
    `#### ${d.title.replace("[Bug]: ", "")}`,
    "",
    `Suggested fields: **${COMPONENT[d.component].option}**, **${network}**, **${d.severity}**. The service desk's triage bot turns them into ${labels.join(", ")}.`,
    ...(d.severityNote ? ["", `**${d.severityNote}**`] : []),
    "",
    "<details><summary>Report, in the bug-report form's layout</summary>",
    "",
    `Title: \`${d.title}\``,
    "",
    "````markdown",
    body,
    "````",
    "",
    "</details>",
  ].join("\n");
}

/** The service-desk section of a live-check report, or "" when there is nothing to report. */
export function serviceDeskSection(input: ReportInput, firstSeen?: string): string {
  if (rejectedCredentials(input)) {
    return [
      START,
      "### Service desk",
      "",
      "Blockfrost rejected the project ID, so this is a problem with the `BLOCKFROST_MAINNET_PROJECT_ID` secret, not a Midnight outage. Don't file it with the service desk.",
      END,
    ].join("\n");
  }
  const found = problems(input);
  if (!found.length) return "";
  const times = [...input.attempts.map((a) => a.at), ...(input.heads ?? []).map((h) => h.at)].sort();
  const window = {
    firstSeen: [firstSeen, times[0]].filter((t): t is string => !!t).sort()[0]!,
    lastSeen: times.at(-1)!,
  };
  return [
    START,
    `<!-- service-desk first seen: ${window.firstSeen} -->`,
    "### Service desk",
    "",
    `This is a draft for [Midnight's service desk](${SERVICE_DESK}/issues/new?template=bug-report.yml). Nothing is filed automatically: Midnight's [AI reporting guidelines](${SERVICE_DESK}/blob/main/ai-reports.md) need a person to re-run the commands, check every number against the output and submit the report. After review, file it in the form or with \`gh issue create --repo midnightntwrk/servicedesk --title "<title>" --body-file <report>\`.`,
    "",
    ...found.map((p) => render(draft(p, input, window), input, window)),
    END,
  ].join("\n");
}

export function firstSeenOf(body: string | null | undefined): string | undefined {
  return /<!-- service-desk first seen: (\S+) -->/.exec(body ?? "")?.[1];
}

/** Swaps the service-desk section of a report for a new one. */
export function replaceSection(report: string, section: string): string {
  const start = report.indexOf(START);
  const end = report.indexOf(END);
  if (start === -1 || end === -1) return report;
  return report.slice(0, start) + section + report.slice(end + END.length);
}
