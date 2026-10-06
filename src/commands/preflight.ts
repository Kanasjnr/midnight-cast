import { getLatestBlockHeight, unshieldedHoldings, type UnshieldedHoldings } from "../clients/indexer.js";
import { chainGetHeader, parseBlockNumber } from "../clients/rpc.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { computeDelta } from "../lib/delta.js";
import { getDustStatus, type DustStatus } from "../lib/dust-status.js";
import { examplesVerdict, formatDate, type ExamplesReport } from "../lib/examples-report.js";
import { NetworkError } from "../lib/network-error.js";
import { checkEndpoints, narrowDown } from "../lib/next-steps.js";
import { settle } from "../lib/settle.js";
import { inMcpCall } from "../lib/surface.js";
import { resolveSupportMatrix } from "../lib/upstream-matrix.js";
import { fetchLiveVersions, isNewerPatch, proofServerMatches } from "../lib/versions.js";
import type { EmitResult, GlobalOptions, NextStep } from "../output.js";
import { fail } from "../output.js";
import { runServiceChecks, type ServiceResult } from "./ping.js";

/** NIGHT's unshielded token type: `UnshieldedTokenType(HashOutput([0u8; 32]))` in midnight-ledger. */
export const NIGHT_TOKEN_TYPE = "0".repeat(64);
const STARS_PER_NIGHT = 1_000_000n;
const SPECKS_PER_DUST = 1_000_000_000_000_000n;
const LAG_THRESHOLD = 100;

export interface PreflightCheck {
  name: "network" | "proof-server" | "wallet";
  ok: boolean;
  detail: string;
  errorKind?: string;
  hint?: string;
}

export interface PreflightWallet {
  address: string;
  kind: "unshielded" | "cardano";
  /** NIGHT held, in NIGHT. */
  night: string;
  /** Unshielded addresses: NIGHT UTXOs held, and how many are registered for DUST generation. */
  nightUtxos?: number;
  registeredUtxos?: number;
  /** Unshielded addresses: false when the history couldn't be read in time, so the totals may be short. */
  complete?: boolean;
  /** Cardano reward addresses: whether they're registered, and the DUST generated so far. */
  registered?: boolean;
  dust?: string;
}

export interface PreflightReport {
  network: string;
  ready: boolean;
  checks: PreflightCheck[];
  wallet?: PreflightWallet;
  /** What Midnight's examples run on this network measured, to set expectations. */
  expectations?: { report: string; date: string; faucet?: string } & NonNullable<ExamplesReport["timings"]>;
}

/** "12.5" from 12500000 STAR. */
export function formatUnits(atomic: bigint, perUnit: bigint, decimals: number): string {
  const whole = atomic / perUnit;
  const fraction = (atomic % perUnit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

// The network part of an address: mn_addr1… on mainnet, mn_addr_undeployed1… on a local devnet,
// mn_addr_<network id>1… elsewhere.
const ADDRESS_NETWORK: Record<string, string> = { mainnet: "", local: "undeployed" };

/** What kind of address this is, or why it can't be checked on this network. */
export function addressKind(address: string, network: { name: string; id: string }): { kind: "unshielded" | "cardano" } | { error: string } {
  const unshielded = /^mn_addr(?:_([a-z0-9]+))?1[02-9ac-hj-np-z]+$/.exec(address);
  if (unshielded) {
    const own = unshielded[1] ?? "";
    const expected = ADDRESS_NETWORK[network.id] ?? network.id;
    if (own === expected) return { kind: "unshielded" };
    const shape = expected ? `mn_addr_${expected}1…` : "mn_addr1…";
    return { error: `${address} is a ${own || "mainnet"} address, but ${network.name} uses ${shape} addresses` };
  }
  const cardano = /^stake(_test)?1[02-9ac-hj-np-z]+$/.exec(address);
  if (cardano) {
    const mainnet = network.id === "mainnet";
    if (mainnet === !cardano[1]) return { kind: "cardano" };
    return {
      error: `${address} is a Cardano ${cardano[1] ? "testnet" : "mainnet"} reward address, but ${network.name} pairs with ${mainnet ? "stake1…" : "stake_test1…"} addresses`,
    };
  }
  return { error: "Give a Midnight unshielded address (mn_addr_…) or a Cardano reward address (stake…)" };
}

const failure = (name: PreflightCheck["name"], detail: string, err?: unknown): PreflightCheck => ({
  name,
  ok: false,
  detail,
  ...(err instanceof NetworkError ? { errorKind: err.kind, ...(err.hint ? { hint: err.hint } : {}) } : {}),
});

/** The network check: both services answer, and the indexer keeps up with the node. */
export function networkCheck(services: ServiceResult[], sync: { delta: number } | { error: unknown } | undefined): PreflightCheck {
  const down = services.filter((s) => (s.service === "rpc" || s.service === "indexer") && s.status !== "OK");
  if (down.length) {
    return {
      name: "network",
      ok: false,
      detail: down.map((s) => `${s.service === "rpc" ? "RPC" : "indexer"}: ${s.detail ?? "unreachable"}`).join("; "),
      ...(down[0]!.errorKind ? { errorKind: down[0]!.errorKind } : {}),
    };
  }
  if (!sync) return { name: "network", ok: true, detail: "the RPC and indexer answer" };
  if ("error" in sync) {
    const message = sync.error instanceof Error ? sync.error.message : String(sync.error);
    return failure("network", `the services answer, but reading their heights failed: ${message}`, sync.error);
  }
  const gap = Math.abs(sync.delta);
  if (gap >= LAG_THRESHOLD) {
    return {
      name: "network",
      ok: false,
      detail: sync.delta > 0 ? `the indexer is ${gap} blocks behind the node, so wallets sync stale state` : `the RPC is ${gap} blocks behind the indexer`,
    };
  }
  return { name: "network", ok: true, detail: `the RPC and indexer answer, and the indexer is ${gap} block${gap === 1 ? "" : "s"} from the node` };
}

/** The proof-server check: it answers, and runs the version the network expects. */
export function proofServerCheck(services: ServiceResult[], url: string | undefined, expected: string | undefined, network: string): PreflightCheck {
  const runs = expected ? ` running ${expected}, the version ${network} expects` : "";
  if (!url) {
    const where = inMcpCall() ? "set proof_server in this network's section of config.toml" : "pass --proof-server <url> or set proof_server in config.toml";
    return { name: "proof-server", ok: false, detail: `no proof server configured. Start one${runs}, then ${where}` };
  }
  const row = services.find((s) => s.service === "proof-server");
  // ping marks a wrong version FAIL as well; a version means it answered.
  if (row?.version && expected && !proofServerMatches(expected, row.version)) {
    return { name: "proof-server", ok: false, detail: `answers at ${url} but runs ${row.version}; ${network} expects ${expected}` };
  }
  if (!row || (row.status !== "OK" && !row.version)) {
    return { name: "proof-server", ok: false, detail: `not reachable at ${url}${row?.detail ? ` (${row.detail})` : ""}. Start one${runs}` };
  }
  const newer = row.version && expected && isNewerPatch(expected, row.version) ? `, a newer patch than the ${expected} ${network} lists` : "";
  return { name: "proof-server", ok: true, detail: `answers at ${url}${row.version ? ` and runs ${row.version}${newer}` : ""}` };
}

/** The wallet check for a Midnight unshielded address, from the UTXOs it holds. */
export function unshieldedWallet(address: string, holdings: UnshieldedHoldings, faucet: string | undefined): { wallet: PreflightWallet; check: PreflightCheck } {
  const night = holdings.utxos.filter((u) => u.tokenType === NIGHT_TOKEN_TYPE);
  const stars = night.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const registered = night.filter((u) => u.registeredForDustGeneration).length;
  const amount = formatUnits(stars, STARS_PER_NIGHT, 6);
  const utxos = `${night.length} UTXO${night.length === 1 ? "" : "s"}`;
  const wallet: PreflightWallet = { address, kind: "unshielded", night: amount, nightUtxos: night.length, registeredUtxos: registered, complete: holdings.complete };
  const longer = inMcpCall() ? "" : "; run it again with a longer --timeout";
  const partial = holdings.complete ? "" : ` (read ${holdings.transactions} transactions before the timeout, so this may be short${longer})`;
  const check = (ok: boolean, detail: string): PreflightCheck => ({ name: "wallet", ok, detail });
  if (stars === 0n && !holdings.complete) {
    return { wallet, check: check(false, `couldn't read the whole history in time: ${holdings.transactions} transactions read, with no NIGHT among them yet${longer}`) };
  }
  if (stars === 0n) {
    return { wallet, check: check(false, `no NIGHT at this address. Fund it${faucet ? ` from the faucet (${faucet})` : " from the network's faucet"}`) };
  }
  if (registered === 0) {
    return { wallet, check: check(false, `${amount} NIGHT in ${utxos}, none registered for DUST generation${partial}, so it can't pay fees. Register it for DUST from the wallet`) };
  }
  const which = registered === night.length ? "all" : `${registered}`;
  return {
    wallet,
    check: check(true, `${amount} NIGHT in ${utxos}, ${which} registered for DUST generation${partial}. DUST builds up after registration, so a wallet registered moments ago may need to wait`),
  };
}

/** The wallet check for a Cardano reward address, from its DUST generation status. */
export function cardanoWallet(address: string, status: DustStatus | undefined): { wallet: PreflightWallet; check: PreflightCheck } {
  const night = formatUnits(BigInt(status?.nightBalance ?? "0"), STARS_PER_NIGHT, 6);
  const specks = BigInt(status?.currentCapacity ?? "0");
  const dust = formatUnits(specks, SPECKS_PER_DUST, 15);
  const wallet: PreflightWallet = { address, kind: "cardano", night, registered: !!status?.registered, dust };
  const check: PreflightCheck = !status?.registered
    ? { name: "wallet", ok: false, detail: `not registered for DUST generation${night !== "0" ? ` (${night} NIGHT)` : ""}. Register it to generate DUST for fees` }
    : specks === 0n
      ? { name: "wallet", ok: false, detail: `registered for DUST generation, backed by ${night} NIGHT, but no DUST generated yet; it builds up over time` }
      : { name: "wallet", ok: true, detail: `registered for DUST generation, backed by ${night} NIGHT, with ${dust} DUST generated` };
  return { wallet, check };
}

export async function preflightCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & { address?: string; timeoutMs?: number; offline?: boolean; refreshMatrix?: boolean },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }
  const network = endpoints.network;
  const usage = (message: string): EmitResult => ({ ...fail(message), errorKind: "usage", exitCode: 2 });
  const address = flags.address?.trim();
  if (flags.address !== undefined && !address) return usage("--address is empty");
  const kind = address ? addressKind(address, { name: network, id: endpoints.networkId }) : undefined;
  if (kind && "error" in kind) return usage(kind.error);

  let expected: string | undefined;
  try {
    // A local devnet or a custom network has no matrix row, and is still worth checking.
    expected = (await resolveSupportMatrix({ offline: flags.offline, refresh: flags.refreshMatrix })).matrix.networks[network]?.proofServer;
  } catch (err) {
    return fail(err);
  }

  // The wallet read can take a while, so it runs alongside the rest; a down indexer cancels it.
  const cancel = new AbortController();
  const walletRead = !address
    ? undefined
    : kind?.kind === "unshielded"
      ? settle(unshieldedHoldings(endpoints, address, { timeoutMs: flags.timeoutMs, signal: cancel.signal }))
      : settle(getDustStatus(endpoints.indexerHttp, [address]));
  const liveRead = settle(fetchLiveVersions(endpoints.rpc, endpoints.indexerHttp));

  const services = await runServiceChecks(endpoints, { proofServerExpected: expected });
  const up = (service: string) => services.some((s) => s.service === service && s.status === "OK");
  if (!up("indexer")) cancel.abort();
  let sync: { delta: number } | { error: unknown } | undefined;
  if (up("rpc") && up("indexer")) {
    try {
      const [header, indexerHeight] = await Promise.all([chainGetHeader(endpoints.rpc), getLatestBlockHeight(endpoints.indexerHttp)]);
      sync = { delta: computeDelta(parseBlockNumber(header.number), indexerHeight) };
    } catch (err) {
      sync = { error: err };
    }
  }
  const checks = [networkCheck(services, sync), proofServerCheck(services, endpoints.proofServer, expected, network)];

  const live = await liveRead;
  const examples = live.ok ? await examplesVerdict(network, live.value, { offline: flags.offline, refresh: flags.refreshMatrix }) : undefined;
  const run = examples?.report?.network === network ? examples.report : undefined;

  let wallet: PreflightWallet | undefined;
  if (walletRead && address) {
    const outcome = await walletRead;
    if (!up("indexer")) {
      checks.push({ name: "wallet", ok: false, detail: "not checked: the indexer is down" });
    } else if (!outcome.ok) {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      checks.push(failure("wallet", `couldn't read the wallet: ${message}`, outcome.error));
    } else {
      const result =
        kind?.kind === "unshielded"
          ? unshieldedWallet(address, outcome.value as UnshieldedHoldings, run?.faucet)
          : cardanoWallet(address, (outcome.value as DustStatus[])[0]);
      wallet = result.wallet;
      checks.push(result.check);
    }
  }

  const failing = checks.filter((c) => !c.ok);
  const report: PreflightReport = {
    network,
    ready: failing.length === 0,
    checks,
    ...(wallet ? { wallet } : {}),
    ...(run ? { expectations: { report: run.url, date: run.date, ...(run.faucet ? { faucet: run.faucet } : {}), ...run.timings } } : {}),
  };

  const networkFailed = !checks[0]!.ok;
  const servicesDown = !up("rpc") || !up("indexer");
  const next: NextStep[] = [
    ...(networkFailed ? narrowDown(network, flags, { services: servicesDown, sync: !servicesDown }) : []),
    ...(networkFailed && servicesDown ? checkEndpoints(network, flags) : []),
    ...(wallet && failing.some((c) => c.name === "wallet")
      ? [{ command: "midnight-cast explain dust", reason: "How NIGHT generates DUST, and registering for it" }]
      : []),
  ];
  const errorKind = failing.find((c) => c.errorKind)?.errorKind;
  return {
    ok: report.ready,
    data: options.json ? report : formatPreflightHuman(report),
    exitCode: report.ready ? 0 : 1,
    ...(report.ready ? {} : { error: `Not ready: ${failing.map((c) => LABEL[c.name]).join(", ")}` }),
    ...(errorKind ? { errorKind } : {}),
    next,
  };
}

const LABEL: Record<PreflightCheck["name"], string> = { network: "network", "proof-server": "proof server", wallet: "wallet" };

export function formatPreflightHuman(report: PreflightReport): string {
  const lines = [`Preflight: ${report.network}`, ""];
  for (const check of report.checks) {
    lines.push(`  ${check.ok ? "OK  " : "FAIL"} ${LABEL[check.name].padEnd(12)} ${check.detail}`);
    if (check.hint) lines.push(`${" ".repeat(20)}${check.hint}`);
  }
  const e = report.expectations;
  if (e && (e.coldSyncMinutes !== undefined || e.restoreSeconds)) {
    const parts = [
      ...(e.coldSyncMinutes !== undefined ? [`a new wallet's first sync took about ${e.coldSyncMinutes} minutes`] : []),
      ...(e.restoreSeconds ? [`restoring one from a pre-seed bundle took ${e.restoreSeconds} seconds`] : []),
    ];
    lines.push("", `Expect, from Midnight's examples run on ${report.network} (${formatDate(e.date)}): ${parts.join("; ")}.`, `  ${e.report}`);
  }
  // When something failed, the error line says so.
  if (report.ready) lines.push("", "Ready.");
  return lines.join("\n");
}
