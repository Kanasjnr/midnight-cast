import { networkTitle as title } from "./blockfrost.js";

// The public networks the general advice speaks about; a network named with --network may also come from a user's override.
export const PUBLIC_NETWORKS = ["preview", "preprod", "mainnet"];
export const publicNetworks = (matrix: Record<string, unknown>) => PUBLIC_NETWORKS.filter((name) => name in matrix);

export function names(networks: string[]): string {
  const titled = networks.map(title);
  return titled.length > 1 ? `${titled.slice(0, -1).join(", ")} and ${titled.at(-1)}` : (titled[0] ?? "");
}

export const runs = (networks: string[]) => `${names(networks)} ${networks.length > 1 ? "run" : "runs"}`;

/** The ledger's major version, or undefined when the matrix doesn't say. */
export const ledgerMajor = (ledger: string | undefined) => {
  const major = Number(ledger?.split(".")[0]);
  return ledger && Number.isInteger(major) ? major : undefined;
};

/**
 * The ledger major a network runs: the matrix's ledger for the runtime spec its node reports, so an upgrade
 * the network's own row hasn't caught up with still counts, and that row's ledger when no row has the spec or
 * the node couldn't be read.
 */
export function networkLedgerMajor(
  networks: Record<string, { ledger?: string; runtimeSpec?: number }>,
  network: string,
  liveSpec: number | undefined,
): number | undefined {
  const live = liveSpec === undefined ? undefined : Object.values(networks).find((n) => n.runtimeSpec === liveSpec)?.ledger;
  return ledgerMajor(live ?? networks[network]?.ledger);
}

/** The first runtime spec on Ledger 9: mainnet's block 3346138 runs 1000300 and the fork block after it 2001100. */
export const LEDGER_9_FIRST_SPEC = 2001100;

/** The last runtime spec before the Ledger 9 fork: the block before it runs it on mainnet (3346138) and preprod (3348433). */
export const LEDGER_8_LAST_SPEC = 1000300;

/** The networks that forked to Ledger 9 in place, so their history holds blocks on LEDGER_8_LAST_SPEC. Preview was reset instead. */
export const FORKED_IN_PLACE = ["preprod", "mainnet"];
