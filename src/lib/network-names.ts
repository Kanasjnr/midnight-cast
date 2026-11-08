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
