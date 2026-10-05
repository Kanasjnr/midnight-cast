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
  /** `health --json`'s services: every service, with the error kind when it failed. */
  services: Array<{ service: string; status: string; latencyMs: number; detail?: string; errorKind?: string }>;
  /** Only there when both RPC and indexer answered. */
  sync?: { rpcHeight: number; indexerHeight: number; delta: number; threshold: number; inSync: boolean };
  error?: string;
}

export interface HeadSample {
  at: string;
  ms: number;
  head?: number;
  error?: string;
}

/** What a live check saw, kept so a draft can quote it. */
export interface Evidence {
  attempts: Attempt[];
  heads?: HeadSample[];
  endpoints?: { rpc: string; indexerHttp: string; blockfrost: boolean };
  environment?: string;
  /** The GitHub Actions event that started the check, such as `schedule`; absent for a run by hand. */
  trigger?: string;
  runUrl?: string;
}

export interface ReportInput extends Evidence {
  network: string;
  nodeVersion?: string;
}

/** A head this many blocks below the highest one already seen means a backend is behind. */
export const HEAD_TOLERANCE = 2;

/** Each sample with how far it fell below the highest head before it, when that's past the tolerance. */
export function stepsBack(heads: HeadSample[] = []): Array<{ sample: HeadSample; highest?: number; drop?: number }> {
  let highest: number | undefined;
  return heads.map((sample) => {
    const { head } = sample;
    if (head === undefined || !Number.isFinite(head)) return { sample };
    const drop = highest !== undefined && highest - head > HEAD_TOLERANCE ? highest - head : undefined;
    const step = drop === undefined ? { sample } : { sample, highest, drop };
    highest = Math.max(highest ?? head, head);
    return step;
  });
}

/** The largest step back in a series of heads, or undefined if it never went back past the tolerance. */
export function headRegression(heads: HeadSample[] = []): { from: number; to: number; drop: number } | undefined {
  let worst: { from: number; to: number; drop: number } | undefined;
  for (const { sample, highest, drop } of stepsBack(heads)) {
    if (drop !== undefined && drop > (worst?.drop ?? 0)) worst = { from: highest!, to: sample.head!, drop };
  }
  return worst;
}

/** Each problem keeps a first-seen time per key, so a change in which services fail keeps the history. */
type Problem =
  | { keys: string[]; kind: "unreachable"; services: string[] }
  | { keys: string[]; kind: "lag"; behind: "indexer" | "rpc" }
  | { keys: string[]; kind: "heads"; from: number; to: number; drop: number };

type Service = Attempt["services"][number];
const REQUIRED = new Set(["rpc", "indexer"]);
const failed = (a: Attempt) => a.services.filter((s) => REQUIRED.has(s.service) && s.status !== "OK");

/**
 * Blockfrost refusing our project ID, or our plan's limit, is our problem, not Midnight's.
 * Elsewhere a 4xx comes from Midnight's own endpoint and is drafted like any failure.
 */
function ours(s: Service, input: ReportInput): boolean {
  return !!input.endpoints?.blockfrost && s.errorKind === "http_4xx" && /\((401|402|403|429)\)/.test(s.detail ?? "");
}

/** The services that are down for reasons that are Midnight's, and those down for reasons that are ours. */
function split(input: ReportInput): { theirs: Service[]; mine: Service[] } {
  const last = input.attempts.at(-1);
  const down = last ? failed(last) : [];
  return { theirs: down.filter((s) => !ours(s, input)), mine: down.filter((s) => ours(s, input)) };
}

export function problems(input: ReportInput): Problem[] {
  const found: Problem[] = [];
  const last = input.attempts.at(-1);
  const { theirs, mine } = split(input);
  if (theirs.length) {
    const services = theirs.map((s) => s.service);
    found.push({ keys: services.map((s) => `unreachable:${s}`), kind: "unreachable", services });
  } else if (!mine.length && last?.sync && !last.sync.inSync) {
    const behind = last.sync.delta > 0 ? "indexer" : "rpc";
    found.push({ keys: [`lag:${behind}`], kind: "lag", behind });
  }
  const regression = headRegression(input.heads);
  if (regression) found.push({ keys: ["heads"], kind: "heads", ...regression });
  return found;
}

/** When one key of a problem showed: the attempts, or the head samples, that had it. */
function sightings(key: string, input: ReportInput): string[] {
  if (key === "heads") return stepsBack(input.heads).filter((s) => s.drop !== undefined).map((s) => s.sample.at);
  const [kind, which] = key.split(":");
  return input.attempts
    .filter((a) =>
      kind === "unreachable"
        ? failed(a).some((s) => s.service === which && !ours(s, input))
        : !!a.sync && !a.sync.inSync && a.sync.delta > 0 === (which === "indexer"),
    )
    .map((a) => a.at);
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
/** Who ran the check, in words a report can stand behind. */
function checker(input: ReportInput): { who: string; cadence: string } {
  if (input.trigger === "schedule") return { who: "a scheduled check running in GitHub Actions", cadence: "a check that runs every six hours" };
  if (input.trigger) return { who: `a check running in GitHub Actions (started by ${input.trigger})`, cadence: "a check in GitHub Actions" };
  return { who: "a check run by hand", cadence: "a check run by hand" };
}
const clock = (iso: string) => iso.slice(11, 19);

function attemptLines(input: ReportInput): string[] {
  return input.attempts.map((a) => {
    const services = a.services
      .filter((s) => REQUIRED.has(s.service))
      .map((s) =>
        [`${s.service}=${s.status}`, `${s.latencyMs}ms`, s.errorKind, s.detail && `"${s.detail}"`].filter(Boolean).join(" "),
      );
    const sync = a.sync ? ` node=${a.sync.rpcHeight} indexer=${a.sync.indexerHeight} delta=${a.sync.delta}` : "";
    return `${time(a.at)} ${a.error ? `error "${a.error}"` : services.join(" ")}${sync}`;
  });
}

function headLines(heads: HeadSample[]): string[] {
  return stepsBack(heads).map(({ sample, highest, drop }) =>
    sample.head === undefined
      ? `${clock(sample.at)} no response (${sample.error ?? "failed"}) ${sample.ms}ms`
      : `${clock(sample.at)} head=${sample.head} ${sample.ms}ms${drop === undefined ? "" : `   <- ${drop} below ${highest}`}`,
  );
}

/** "all 3 attempts between A and B", "2 of 3 attempts between A and B" or "the check's one attempt, at A". */
function attemptsPhrase(seen: string[], total: number): string {
  if (total === 1) return `the check's one attempt, at ${time(seen[0]!)}`;
  const when = seen.length === 1 ? `at ${time(seen[0]!)}` : `between ${time(seen[0]!)} and ${time(seen.at(-1)!)}`;
  return `${seen.length === total ? `all ${total}` : `${seen.length} of ${total}`} attempts, ${when}`;
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

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function draft(problem: Problem, input: ReportInput, seen: string[]): Draft {
  const net = NETWORK[input.network] ?? input.network;
  const rpc = input.endpoints?.rpc ?? "<rpc url>";
  const indexer = input.endpoints?.indexerHttp ?? "<indexer url>";
  const blockfrost = !!input.endpoints?.blockfrost;
  const attempts = input.attempts;

  if (problem.kind === "unreachable") {
    const both = problem.services.length > 1;
    const names = problem.services.map((s) => SERVICE_NAME[s] ?? s).join(" and ");
    const last = attempts.at(-1)!;
    const failures = failed(last)
      .filter((s) => problem.services.includes(s.service))
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
      description: `The public ${net} ${names} ${both ? "were" : "was"} unreachable from ${checker(input).who}, in ${attemptsPhrase(seen, attempts.length)}.`,
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
    const last = attempts.at(-1)!;
    const sync = last.sync!;
    const gap = Math.abs(sync.delta);
    const compare = {
      stepsBefore: "Compare the node's head with the indexer's latest block.",
      steps: `${curl(rpc, RPC_HEADER, blockfrost)}\n\n${curl(indexer, INDEXER_HEIGHT, blockfrost)}`,
      stepsAfter: "The node's `number` is hex; `printf '%d\\n' 0x...` converts it.",
      logs: attemptLines(input),
    };
    if (problem.behind === "indexer") {
      return {
        title: `[Bug]: ${net} indexer ${gap} blocks behind the node`,
        component: "indexer",
        severity: "P3",
        description: `The public ${net} indexer is behind the node it indexes. ${capitalize(checker(input).who)} saw it behind in ${attemptsPhrase(seen, attempts.length)}. Reads from the indexer (wallet sync, DApp queries) return stale state.`,
        expected: `The indexer stays within ${sync.threshold} blocks of the node.`,
        actual: `At ${time(last.at)} the node was at block ${sync.rpcHeight} and the indexer at ${sync.indexerHeight}: ${gap} blocks behind.`,
        ...compare,
      };
    }
    return {
      title: `[Bug]: ${net} public RPC ${gap} blocks behind the indexer`,
      component: "node",
      severity: "P3",
      description: `The public ${net} RPC reports a head behind the indexer's latest block. ${capitalize(checker(input).who)} saw it in ${attemptsPhrase(seen, attempts.length)}. The node answering RPC calls isn't keeping up; on a load-balanced RPC that is usually one lagging backend, though we can't see which backend served each response.`,
      expected: "The RPC's head is at or ahead of the indexer's latest block.",
      actual: `At ${time(last.at)} the RPC's head was block ${sync.rpcHeight} and the indexer's latest block ${sync.indexerHeight}: the RPC was ${gap} blocks behind.`,
      ...compare,
    };
  }

  const heads = input.heads ?? [];
  return {
    title: `[Bug]: ${net} public RPC returns chain heads that go backwards`,
    component: "node",
    severity: "P3",
    description: `Consecutive \`chain_getHeader\` calls to the public ${net} RPC, about two seconds apart, returned block numbers that went backwards and then forward again. The responses are well-formed. This is consistent with a node behind the load balancer that isn't keeping up; we can't see which backend served each response, so that part is an inference.`,
    expected: "Consecutive `chain_getHeader` calls return a non-decreasing block number that tracks the network head.",
    actual: `Between ${clock(heads[0]!.at)} and ${clock(heads.at(-1)!.at)} UTC on ${heads[0]!.at.slice(0, 10)}, the head went back by up to ${problem.drop} blocks (from ${problem.from} to ${problem.to}). Clients reading the head see a different chain depending on which response they get.`,
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
    `First seen ${time(window.firstSeen)}, last seen ${time(window.lastSeen)} (UTC), by ${checker(input).cadence}.${input.runUrl ? ` Latest run: ${input.runUrl}` : ""}`,
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

/**
 * The service-desk section of a live-check report, or "" when there is nothing to report.
 * `history` maps each problem to when the live-check issue first saw it.
 */
export function serviceDeskSection(input: ReportInput, history: Record<string, string> = {}): string {
  const { mine } = split(input);
  const ourNote = mine.length
    ? `Blockfrost refused ${mine.map((s) => SERVICE_NAME[s.service] ?? s.service).join(" and ")} because of our project ID or our plan's limit (${mine.map((s) => s.detail).join("; ")}). That's a problem with the \`BLOCKFROST_MAINNET_PROJECT_ID\` secret or the Blockfrost plan, not Midnight's, so it isn't drafted.`
    : "";
  const found = problems(input);
  if (!found.length) return ourNote ? [START, "### Service desk", "", ourNote, END].join("\n") : "";

  const firstSeenOfKey = new Map<string, string>();
  const drafts = found.map((problem) => {
    for (const key of problem.keys) {
      const first = [history[key], sightings(key, input)[0]].filter((t): t is string => !!t).sort()[0];
      if (first) firstSeenOfKey.set(key, first);
    }
    // The attempts in which every part of the problem showed, e.g. both services down.
    const [firstKey, ...otherKeys] = problem.keys.map((key) => sightings(key, input));
    const seen = firstKey!.filter((at) => otherKeys.every((times) => times.includes(at)));
    const firstSeen = [...problem.keys.map((key) => firstSeenOfKey.get(key)), seen[0]].filter((t): t is string => !!t).sort()[0]!;
    return { problem, seen, window: { firstSeen, lastSeen: seen.at(-1)! } };
  });
  const lastSeen = drafts.map((d) => d.window.lastSeen).sort().at(-1)!;
  return [
    START,
    ...[...firstSeenOfKey].map(([key, at]) => `<!-- service-desk first seen: ${key} ${at} -->`),
    `<!-- service-desk last seen: ${lastSeen} -->`,
    "### Service desk",
    "",
    ...(ourNote ? [ourNote, ""] : []),
    `This is a draft for [Midnight's service desk](${SERVICE_DESK}/issues/new?template=bug-report.yml). Nothing is filed automatically: Midnight's [AI reporting guidelines](${SERVICE_DESK}/blob/main/ai-reports.md) need a person to re-run the commands, check every number against the output and submit the report. After review, file it in the form or with \`gh issue create --repo midnightntwrk/servicedesk --title "<title>" --body-file <report>\`.`,
    "",
    ...drafts.map((d) => render(draft(d.problem, input, d.seen), input, d.window)),
    END,
  ].join("\n");
}

/** When the issue first saw each problem, from the markers in its body. */
export function firstSeenOf(body: string | null | undefined): Record<string, string> {
  return Object.fromEntries([...(body ?? "").matchAll(/<!-- service-desk first seen: (\S+) (\S+) -->/g)].map((m) => [m[1]!, m[2]!]));
}

export function lastSeenOf(body: string | null | undefined): string | undefined {
  return /<!-- service-desk last seen: (\S+) -->/.exec(body ?? "")?.[1];
}

/** Swaps the service-desk section of a report for a new one. */
export function replaceSection(report: string, section: string): string {
  const start = report.indexOf(START);
  const end = report.indexOf(END);
  if (start === -1 || end === -1) return report;
  return report.slice(0, start) + section + report.slice(end + END.length);
}
