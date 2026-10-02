// Live network drift check: compares what a Midnight network is actually
// running against the support matrix bundled in midnight-cast and the matrix
// Midnight publishes upstream.
//
//   tsx scripts/live-check.ts <network> [--out <dir>] [--attempts <n>] [--delay-ms <ms>]
//

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { HealthReport } from "../src/commands/health.js";
import {
  versionMatches,
  type MatrixNetwork,
  type SupportMatrixFile,
  type VersionsReport,
} from "../src/lib/versions.js";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const UPSTREAM_MATRIX_URL =
  "https://raw.githubusercontent.com/midnightntwrk/midnight-docs/main/docs/relnotes/support-matrix.json";

export const EXIT = { clean: 0, drift: 10, outage: 20, error: 2 } as const;

export type Component =
  | "node"
  | "indexer"
  | "proofServer"
  | "onChainRuntime"
  | "compactRuntime";

export type ComponentVersions = Partial<Record<Component, string>>;

export type FindingKind =
  | "outage"
  | "protocol-split"
  | "bundled-drift"
  | "upstream-ahead"
  | "upstream-differs"
  | "upstream-lag"
  | "upstream-unavailable"
  | "indexer-api-undetected";

export type Severity = "outage" | "drift" | "info";
export type Status = "clean" | "drift" | "outage";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  component: string;
  message: string;
  bundled?: string;
  live?: string;
  upstream?: string;
}

export interface UpstreamMatrix {
  versions: ComponentVersions;
  /** Inconsistencies inside the upstream file itself (e.g. tag vs containerTag). */
  notes: string[];
}

export interface LiveSnapshot extends ComponentVersions {
  runtimeSpec?: number;
  indexerProtocol?: number;
}

export interface CheckResult {
  network: string;
  status: Status;
  findings: Finding[];
  live: LiveSnapshot;
  bundled: ComponentVersions;
  upstream?: ComponentVersions;
}

/** The `{ ok, data }` envelope every `--json` command prints. */
export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface UpstreamFile {
  components?: Array<{
    component: string;
    versions?: Record<string, { tag?: string; containerTag?: string }>;
  }>;
}

// Upstream component display names -> our component keys.
const UPSTREAM_COMPONENTS: Record<string, Component> = {
  "Node (Midnight)": "node",
  "Midnight Indexer": "indexer",
  "Proof server": "proofServer",
  "On-chain runtime": "onChainRuntime",
  "Compact runtime": "compactRuntime",
};

const COMPONENTS: Component[] = [
  "node",
  "indexer",
  "proofServer",
  "onChainRuntime",
  "compactRuntime",
];

const SEVERITY: Record<FindingKind, Severity> = {
  outage: "outage",
  "protocol-split": "drift",
  "bundled-drift": "drift",
  "upstream-ahead": "drift",
  "upstream-differs": "info",
  "upstream-lag": "info",
  "upstream-unavailable": "info",
  "indexer-api-undetected": "info",
};

const UPSTREAM_KINDS = new Set<FindingKind>([
  "upstream-ahead",
  "upstream-differs",
  "upstream-lag",
  "upstream-unavailable",
]);

/**
 * Never visible from the public endpoints, whatever a given run manages to
 * reach. For these Midnight's published matrix is the only source of truth;
 * node and proof server are checked against the live network instead.
 */
const UNOBSERVABLE = new Set<Component>(["indexer", "onChainRuntime", "compactRuntime"]);

/** "node-1.0.400" / "midnight-indexer-4.3.302" -> "1.0.400" */
export function versionFromTag(tag: string | undefined): string | undefined {
  const match = /(\d+\.\d+\.\d+)$/.exec((tag ?? "").trim());
  return match?.[1];
}

export function parseUpstreamMatrix(json: unknown, network: string): UpstreamMatrix {
  const versions: ComponentVersions = {};
  const notes: string[] = [];
  for (const component of (json as UpstreamFile)?.components ?? []) {
    const key = UPSTREAM_COMPONENTS[component.component];
    const entry = component.versions?.[network];
    if (!key || !entry) continue;
    const version = versionFromTag(entry.tag);
    if (version) versions[key] = version;
    const container = versionFromTag(entry.containerTag);
    if (version && container && container !== version) {
      notes.push(`${key}: upstream tag ${version} but containerTag ${container}`);
    }
  }
  return { versions, notes };
}

/** Bundled matrix entry for a network, with compact-runtime taken from the package pins. */
export function bundledVersions(
  matrix: SupportMatrixFile,
  network: string,
): ComponentVersions | undefined {
  const net = matrix.networks[network];
  return net ? rowVersions(net) : undefined;
}

/** JSON with object keys sorted at every level, for order-insensitive equality. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Why the CLI's matrix row differs from the shipped one, or undefined if it
 * doesn't. A user override (~/.config/midnight-cast/support-matrix.json) or a
 * stale build would otherwise make the verdict judge a matrix that isn't
 * being shipped.
 */
export function matrixRowMismatch(shipped: MatrixNetwork, used: MatrixNetwork): string | undefined {
  return canonicalJson(shipped) === canonicalJson(used)
    ? undefined
    : "the CLI loaded a different support matrix than src/data/support-matrix.json (user override in the config directory, or a stale build: run npm run build)";
}

/** Component versions from one matrix row. */
export function rowVersions(net: MatrixNetwork): ComponentVersions {
  const compactRuntime = Object.entries(net.packages ?? {}).find(([name]) =>
    name.endsWith("/compact-runtime"),
  )?.[1];
  return {
    node: net.node,
    indexer: net.indexer,
    proofServer: net.proofServer,
    onChainRuntime: net.onChainRuntime,
    ...(compactRuntime ? { compactRuntime } : {}),
  };
}

export interface ClassifyInput {
  network: string;
  /** `midnight-cast health <net> --json`, or undefined if it produced nothing parseable. */
  health?: Envelope<HealthReport>;
  /** `midnight-cast versions <net> --json --no-local`. */
  versions?: Envelope<VersionsReport>;
  upstream?: UpstreamMatrix;
  upstreamError?: string;
  bundled: ComponentVersions;
}

export function classify(input: ClassifyInput): CheckResult {
  const { network, upstream, bundled } = input;
  const findings: Finding[] = [];
  const add = (
    kind: FindingKind,
    component: string,
    message: string,
    values: Pick<Finding, "bundled" | "live" | "upstream"> = {},
  ) => findings.push({ kind, severity: SEVERITY[kind], component, message, ...values });

  const health = input.health?.data;
  if (!health || typeof health.healthy !== "boolean") {
    add("outage", "health", input.health?.error ?? "health check produced no usable output");
  } else {
    for (const s of health.services ?? []) {
      if (!s.optional && s.status !== "OK") add("outage", s.service, `${s.service} is ${s.status}`);
    }
    if (health.sync?.inSync === false) {
      add(
        "outage",
        "sync",
        `indexer is ${health.sync.delta} blocks behind the node (threshold ${health.sync.threshold})`,
      );
    }
  }

  const versions = input.versions?.data;
  const live: LiveSnapshot = {};
  if (versions?.live) {
    live.node = versions.live.nodeVersion;
    live.runtimeSpec = versions.live.runtimeSpecVersion;
    live.indexerProtocol = versions.live.indexerProtocolVersion;
    const proof = versions.checks.find((c) => c.label === "proof-server");
    if (proof && /^\d+\.\d+\.\d+/.test(proof.live)) live.proofServer = proof.live;

    if (live.runtimeSpec !== live.indexerProtocol) {
      add(
        "protocol-split",
        "protocolVersion",
        `node runtime spec ${live.runtimeSpec} but indexer reports ${live.indexerProtocol}`,
      );
    }
    const api = versions.checks.find((c) => c.label === "indexer-api");
    if (api?.live === "unknown") {
      // midnight-cast infers the API from the URL path; providers such as
      // Blockfrost (/api/v0) don't expose it there, so we can't tell.
      add("indexer-api-undetected", "indexer-api", "indexer API version not detectable from the endpoint URL");
    } else if (api && !api.ok) {
      add("bundled-drift", "indexer-api", `indexer API ${api.live}, matrix expects ${api.expected}`, {
        bundled: api.expected,
        live: api.live,
      });
    }
  } else if (health) {
    add("outage", "versions", input.versions?.error ?? "versions check produced no usable output");
  }

  // The CLI's own checks decide whether the live network satisfies the
  // bundled matrix (node minimum, exact runtime spec, proof server), so the
  // checker and `midnight-cast versions` can never disagree.
  const checked = [
    ["node", "node"],
    ["runtimeSpec", "runtimeSpec"],
    ["proof-server", "proofServer"],
  ] as const;
  for (const [label, component] of checked) {
    const check = versions?.checks.find((c) => c.label === label);
    if (!check || check.ok) continue;
    // An unreachable optional proof server is not drift.
    if (component === "proofServer" && !live.proofServer) continue;
    add("bundled-drift", component, `live ${check.live}, bundled matrix ${check.expected}`, {
      bundled: check.expected,
      live: check.live,
      upstream: component === "runtimeSpec" ? undefined : upstream?.versions[component],
    });
  }

  if (!upstream) {
    add(
      "upstream-unavailable",
      "upstream",
      `upstream matrix unavailable (${input.upstreamError ?? "unknown error"})`,
    );
  } else {
    for (const key of COMPONENTS) {
      const up = upstream.versions[key];
      if (!up) continue;
      const mine = bundled[key];
      if (mine && up !== mine) {
        // Drift only where upstream is the sole source of truth; for observed
        // components the live check above is what counts.
        add(
          UNOBSERVABLE.has(key) ? "upstream-ahead" : "upstream-differs",
          key,
          `upstream matrix ${up}, bundled matrix ${mine}`,
          { bundled: mine, upstream: up },
        );
      }
      const seen = live[key];
      if (seen && !versionMatches(up, seen)) {
        add("upstream-lag", key, `live ${seen}, upstream matrix ${up}`, { live: seen, upstream: up });
      }
    }
    for (const note of upstream.notes) add("upstream-lag", "upstream", note);
  }

  const status: Status = findings.some((f) => f.severity === "outage")
    ? "outage"
    : findings.some((f) => f.severity === "drift")
      ? "drift"
      : "clean";

  return { network, status, findings, live, bundled, upstream: upstream?.versions };
}

/**
 * Which service an outage message is about ("RPC unreachable (503)" -> "rpc").
 * The fingerprint keys on what failed, not how: a timeout, a 502 and a 503
 * from the same service are one outage, and the sync message's block delta
 * changes every run.
 */
export function failingService(message: string): string {
  const match = /\b(rpc|indexer|proof[- ]server)\b/i.exec(message);
  return match ? match[1]!.toLowerCase().replace(" ", "-") : "";
}

/**
 * Findings that block a release. The live network is the truth where we can
 * see it: a release must not ship a bundled matrix the network doesn't
 * satisfy, or while node and indexer disagree, or during an outage. For
 * components the endpoints don't reveal, Midnight's matrix being ahead of the
 * bundled one (upstream-ahead) blocks too. For observed components a
 * differing upstream number is only upstream-differs: Midnight can publish a
 * version before a network runs it, or one that has no public release.
 */
const RELEASE_BLOCKING = new Set<FindingKind>([
  "outage",
  "bundled-drift",
  "protocol-split",
  "upstream-ahead",
]);

export function releaseBlockers(result: CheckResult): Finding[] {
  return result.findings.filter((f) => RELEASE_BLOCKING.has(f.kind));
}

/**
 * Exit code for a result. Without upstream data a drift verdict is incomplete
 * (upstream-ahead findings vanish, and they can block a release for components
 * we can't observe), so it must not open, edit or close the issue, or pass a
 * release: report an error instead. An outage is still reported as such.
 */
export function exitCodeFor(result: CheckResult): number {
  if (result.status === "outage") return EXIT.outage;
  if (!result.upstream) return EXIT.error;
  return EXIT[result.status];
}

/** Stable across runs as long as the findings themselves don't change. */
export function fingerprint(result: CheckResult): string {
  // An outage is still synced when the upstream fetch fails, and a failed
  // fetch drops every upstream-derived finding and field. During an outage,
  // leave those out so a flaky fetch can't rewrite an unchanged issue, while
  // drift that doesn't depend on upstream (node upgrade, protocol split) still
  // updates it. Otherwise upstream is always present: the check exits 2
  // without it.
  const outage = result.status === "outage";
  const key = result.findings
    .filter((f) => (outage ? !UPSTREAM_KINDS.has(f.kind) : f.kind !== "upstream-unavailable"))
    .map((f) =>
      [
        f.kind,
        f.component,
        f.bundled,
        f.live,
        outage ? "" : f.upstream,
        f.kind === "outage" ? failingService(f.message) : "",
      ].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(`${result.status}\n${key}`).digest("hex").slice(0, 16);
}

/** Remove anything that could be a credential before output leaves the runner. */
export function redact(text: string, secrets: Array<string | undefined> = []): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out
    .replace(/(project_id=)[^&\s"'<>]+/gi, "$1***")
    .replace(/(project_id["']?\s*[:=]\s*["']?)[^&\s"'<>,}]+/gi, "$1***");
}

export function renderMarkdown(
  result: CheckResult,
  meta: { checkedAt?: string; runUrl?: string } = {},
): string {
  const icon = { clean: "✅", drift: "⚠️", outage: "❌" }[result.status];
  const cell = (x: string | number | undefined) => (x === undefined ? "—" : `\`${x}\``);
  const lines = [
    `### ${icon} ${result.network}: ${result.status}`,
    "",
    "| component | live | bundled matrix | upstream matrix |",
    "|---|---|---|---|",
    ...COMPONENTS.map(
      (k) =>
        `| ${k} | ${cell(result.live[k])} | ${cell(result.bundled[k])} | ${cell(result.upstream?.[k])} |`,
    ),
    "",
    `Runtime spec: ${cell(result.live.runtimeSpec)}, indexer protocol: ${cell(result.live.indexerProtocol)}`,
    "",
  ];
  if (result.findings.length) {
    lines.push("| severity | kind | component | detail |", "|---|---|---|---|");
    for (const f of result.findings) {
      lines.push(`| ${f.severity} | ${f.kind} | ${f.component} | ${f.message} |`);
    }
  } else {
    lines.push("No findings.");
  }
  lines.push("");
  if (meta.checkedAt) lines.push(`Checked at ${meta.checkedAt}.`);
  if (meta.runUrl) lines.push(`Run: ${meta.runUrl}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- CLI ------

async function runCli<T>(args: string[]): Promise<Envelope<T> | undefined> {
  const cli = join(root, "dist", "cli.js");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [cli, ...args], {
      timeout: 90_000,
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (err) {
    // A non-zero exit still prints a JSON envelope (e.g. versions mismatch).
    stdout = (err as { stdout?: string }).stdout ?? "";
  }
  try {
    return JSON.parse(stdout) as Envelope<T>;
  } catch {
    return undefined;
  }
}

async function fetchUpstream(network: string): Promise<UpstreamMatrix> {
  const res = await fetch(UPSTREAM_MATRIX_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseUpstreamMatrix(await res.json(), network);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Options {
  network?: string;
  out: string;
  attempts: number;
  delayMs: number;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { out: "live-check", attempts: 3, delayMs: 20_000 };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") opts.out = argv[++i] ?? opts.out;
    else if (a === "--attempts") opts.attempts = Number(argv[++i]);
    else if (a === "--delay-ms") opts.delayMs = Number(argv[++i]);
    else rest.push(a);
  }
  opts.network = rest[0];
  return opts;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (
    !opts.network ||
    !Number.isInteger(opts.attempts) ||
    opts.attempts < 1 ||
    !Number.isFinite(opts.delayMs) ||
    opts.delayMs < 0
  ) {
    console.error(
      "usage: tsx scripts/live-check.ts <network> [--out dir] [--attempts n] [--delay-ms ms]",
    );
    return EXIT.error;
  }
  const network = opts.network;
  const secrets = [process.env.BLOCKFROST_PROJECT_ID, process.env.BLOCKFROST_MAINNET_PROJECT_ID];

  const matrix = JSON.parse(
    readFileSync(join(root, "src", "data", "support-matrix.json"), "utf8"),
  ) as SupportMatrixFile;
  const bundled = bundledVersions(matrix, network);
  if (!bundled) {
    console.error(`network "${network}" is not in the bundled support matrix`);
    return EXIT.error;
  }

  let upstream: UpstreamMatrix | undefined;
  let upstreamError: string | undefined;
  for (let attempt = 1; attempt <= opts.attempts && !upstream; attempt++) {
    try {
      upstream = await fetchUpstream(network);
      upstreamError = undefined;
    } catch (err) {
      upstreamError = err instanceof Error ? err.message : String(err);
      if (attempt < opts.attempts) await sleep(opts.delayMs);
    }
  }

  // Retry so one slow response isn't reported as an outage.
  let result: CheckResult | undefined;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    const [health, versions] = await Promise.all([
      runCli<HealthReport>(["health", network, "--json"]),
      runCli<VersionsReport>(["versions", network, "--json", "--no-local"]),
    ]);
    // The verdict must be about the matrix that ships. If the CLI judged a
    // different one, its checks don't apply: refuse rather than mislead.
    const used = versions?.data?.expected;
    const mismatch = used ? matrixRowMismatch(matrix.networks[network]!, used) : undefined;
    if (mismatch) {
      console.error(`live-check: ${mismatch}`);
      return EXIT.error;
    }
    result = classify({ network, health, versions, upstream, upstreamError, bundled });
    if (result.status !== "outage" || attempt === opts.attempts) break;
    console.error(
      `attempt ${attempt}/${opts.attempts}: outage, retrying in ${opts.delayMs / 1000}s`,
    );
    await sleep(opts.delayMs);
  }
  if (!result) return EXIT.error;

  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  const fp = fingerprint(result);
  const report = redact(
    `${renderMarkdown(result, { checkedAt: new Date().toISOString(), runUrl })}\n\n<!-- live-check fingerprint: ${fp} -->\n`,
    secrets,
  );

  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.md"), report);
  writeFileSync(
    join(out, "result.json"),
    redact(JSON.stringify({ ...result, fingerprint: fp }, null, 2), secrets),
  );
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (process.env.GITHUB_OUTPUT) {
    const blockers = releaseBlockers(result)
      .map((f) => `${f.kind}: ${f.component}`)
      .join(", ");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `status=${result.status}\nfingerprint=${fp}\nblockers=${redact(blockers, secrets)}\n`,
    );
  }

  console.log(report);
  return exitCodeFor(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(redact(err instanceof Error ? (err.stack ?? err.message) : String(err)));
      process.exitCode = EXIT.error;
    },
  );
}
