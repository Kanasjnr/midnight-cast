import { unshieldedHoldings } from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { getDustStatus } from "../lib/dust-status.js";
import { formatDate, type ExamplesReport } from "../lib/examples-report.js";
import { checkEndpoints } from "../lib/next-steps.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";
import { healthCommand, type HealthReport, type HealthUnreachable } from "./health.js";

/** NIGHT's unshielded token type: `UnshieldedTokenType(HashOutput([0u8; 32]))` in midnight-ledger. */
export const NIGHT_TOKEN_TYPE = "0".repeat(64);
const STARS_PER_NIGHT = 1_000_000n;
const SPECKS_PER_DUST = 1_000_000_000_000_000n;

export interface PreflightCheck {
  name: "network" | "proof-server" | "wallet";
  ok: boolean;
  detail: string;
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
  expectations?: { report: string; date: string; coldSyncMinutes?: number; restoreSeconds?: string; faucet?: string };
}

/** "12.5" from 12500000 STAR. */
export function formatUnits(atomic: bigint, perUnit: bigint, decimals: number): string {
  const whole = atomic / perUnit;
  const fraction = (atomic % perUnit).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

type AddressKind = { kind: "unshielded"; network?: string } | { kind: "cardano" };

/** What kind of address this is, or why it can't be checked. */
export function addressKind(address: string, network: string): AddressKind | { error: string } {
  const unshielded = /^mn_addr(?:_([a-z]+))?1[02-9ac-hj-np-z]+$/.exec(address);
  if (unshielded) {
    const own = unshielded[1];
    if (own && own !== network) return { error: `${address} is a ${own} address, not a ${network} one` };
    return { kind: "unshielded", ...(own ? { network: own } : {}) };
  }
  if (/^stake(_test)?1[02-9ac-hj-np-z]+$/.test(address)) return { kind: "cardano" };
  return { error: "Give a Midnight unshielded address (mn_addr_…) or a Cardano reward address (stake… or stake_test…)" };
}

/** Network and proof-server checks from a health result. */
export function infrastructureChecks(health: HealthReport | HealthUnreachable, proofServer: string | undefined): PreflightCheck[] {
  const row = (service: string) => health.services.find((s) => s.service === service);
  const down = ["rpc", "indexer"].map(row).filter((s) => s && s.status !== "OK");
  const sync = "sync" in health ? health.sync : undefined;
  const network: PreflightCheck = down.length
    ? { name: "network", ok: false, detail: down.map((s) => `${s!.service === "rpc" ? "RPC" : "indexer"}: ${s!.detail ?? "unreachable"}`).join("; ") }
    : sync && !sync.inSync
      ? {
          name: "network",
          ok: false,
          detail:
            sync.delta >= 0
              ? `the indexer is ${sync.delta} blocks behind the node, so wallets sync stale state`
              : `the RPC is ${-sync.delta} blocks behind the indexer`,
        }
      : {
          name: "network",
          ok: true,
          detail: `the RPC and indexer answer${sync ? `, and the indexer is ${Math.abs(sync.delta)} block${Math.abs(sync.delta) === 1 ? "" : "s"} from the node` : ""}`,
        };

  const prover = row("proof-server");
  const check = "versions" in health ? health.versions.checks.find((c) => c.label === "proof-server") : undefined;
  const expected = check?.expected ? `, the version ${health.network} expects` : "";
  const proof: PreflightCheck = !proofServer
    ? { name: "proof-server", ok: false, detail: "no proof server configured. Start one, then pass --proof-server <url> or set proof_server in config.toml" }
    : !prover || prover.status !== "OK"
      ? {
          name: "proof-server",
          ok: false,
          detail: `not reachable at ${proofServer}${prover?.detail ? ` (${prover.detail})` : ""}. Start one${check?.expected ? ` running ${check.expected}${expected}` : ""}`,
        }
      : check && !check.ok
        ? { name: "proof-server", ok: false, detail: `runs ${check.live}, but ${health.network} expects ${check.expected}` }
        : { name: "proof-server", ok: true, detail: `answers at ${proofServer}${check?.live ? ` and runs ${check.live}` : ""}` };
  return [network, proof];
}

/** The wallet check for a Midnight unshielded address, from the UTXOs it holds. */
export function unshieldedWallet(
  address: string,
  holdings: { utxos: Array<{ tokenType: string; value: string; registeredForDustGeneration: boolean }>; transactions: number; complete: boolean },
  faucet: string | undefined,
): { wallet: PreflightWallet; check: PreflightCheck } {
  const night = holdings.utxos.filter((u) => u.tokenType === NIGHT_TOKEN_TYPE);
  const stars = night.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const registered = night.filter((u) => u.registeredForDustGeneration).length;
  const amount = formatUnits(stars, STARS_PER_NIGHT, 6);
  const partial = holdings.complete ? "" : ` (read ${holdings.transactions} transactions before the timeout, so this may be short)`;
  const wallet: PreflightWallet = {
    address,
    kind: "unshielded",
    night: amount,
    nightUtxos: night.length,
    registeredUtxos: registered,
    complete: holdings.complete,
  };
  const check: PreflightCheck =
    stars === 0n
      ? { name: "wallet", ok: false, detail: `no NIGHT at this address${partial}. Fund it${faucet ? ` from the faucet (${faucet})` : " from the network's faucet"}` }
      : registered === 0
        ? {
            name: "wallet",
            ok: false,
            detail: `${amount} NIGHT in ${night.length} UTXO${night.length === 1 ? "" : "s"}, none registered for DUST generation${partial}, so it can't pay fees. Register it for DUST from the wallet`,
          }
        : {
            name: "wallet",
            ok: true,
            detail: `${amount} NIGHT in ${night.length} UTXO${night.length === 1 ? "" : "s"}, ${registered === night.length ? "all" : registered} registered for DUST generation${partial}`,
          };
  return { wallet, check };
}

export async function preflightCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & { address?: string; timeoutMs?: number; offline?: boolean },
  options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }
  const network = endpoints.network;
  const address = flags.address?.trim();
  const kind = address ? addressKind(address, network) : undefined;
  if (kind && "error" in kind) return { ...fail(kind.error), errorKind: "usage", exitCode: 2 };

  const health = await healthCommand(network, { ...flags, offline: flags.offline }, { json: true });
  const data = health.data as HealthReport | HealthUnreachable | undefined;
  if (!data?.services) return health;

  const checks = infrastructureChecks(data, endpoints.proofServer);
  const examples = "examples" in data ? (data as HealthReport).examples : undefined;
  const run: ExamplesReport | undefined = examples?.report?.network === network ? examples.report : undefined;

  let wallet: PreflightWallet | undefined;
  if (address && kind && !("error" in kind)) {
    try {
      if (kind.kind === "unshielded") {
        const holdings = await unshieldedHoldings(endpoints, address, { timeoutMs: flags.timeoutMs });
        const result = unshieldedWallet(address, holdings, run?.faucet);
        wallet = result.wallet;
        checks.push(result.check);
      } else {
        const [status] = await getDustStatus(endpoints.indexerHttp, [address]);
        const night = formatUnits(BigInt(status?.nightBalance ?? "0"), STARS_PER_NIGHT, 6);
        const dust = formatUnits(BigInt(status?.currentCapacity ?? "0"), SPECKS_PER_DUST, 15);
        wallet = { address, kind: "cardano", night, registered: !!status?.registered, dust };
        checks.push(
          status?.registered
            ? { name: "wallet", ok: true, detail: `registered for DUST generation, backed by ${night} NIGHT, with ${dust} DUST generated` }
            : { name: "wallet", ok: false, detail: `not registered for DUST generation${night !== "0" ? ` (${night} NIGHT)` : ""}. Register it to generate DUST for fees` },
        );
      }
    } catch (err) {
      checks.push({ name: "wallet", ok: false, detail: `couldn't read the wallet: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  const failing = checks.filter((c) => !c.ok);
  const report: PreflightReport = {
    network,
    ready: failing.length === 0,
    checks,
    ...(wallet ? { wallet } : {}),
    ...(run
      ? {
          expectations: {
            report: run.url,
            date: run.date,
            ...(run.timings?.coldSyncMinutes !== undefined ? { coldSyncMinutes: run.timings.coldSyncMinutes } : {}),
            ...(run.timings?.restoreSeconds ? { restoreSeconds: run.timings.restoreSeconds } : {}),
            ...(run.faucet ? { faucet: run.faucet } : {}),
          },
        }
      : {}),
  };
  const next = [
    ...(failing.some((c) => c.name === "network") ? checkEndpoints(network, flags) : []),
    ...(failing.some((c) => c.name === "wallet") ? [{ command: "midnight-cast explain dust", reason: "How NIGHT generates DUST, and registering for it" }] : []),
  ];
  return {
    ok: report.ready,
    data: options.json ? report : formatPreflightHuman(report),
    exitCode: report.ready ? 0 : 1,
    ...(report.ready ? {} : { error: `Not ready: ${failing.map((c) => LABEL[c.name]).join(", ")}` }),
    next,
  };
}

const LABEL: Record<PreflightCheck["name"], string> = { network: "network", "proof-server": "proof server", wallet: "wallet" };

export function formatPreflightHuman(report: PreflightReport): string {
  const lines = [`Preflight: ${report.network}`, ""];
  for (const check of report.checks) lines.push(`  ${check.ok ? "OK  " : "FAIL"} ${LABEL[check.name].padEnd(12)} ${check.detail}`);
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
