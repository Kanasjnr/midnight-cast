import type { ResolveFlags } from "../config.js";
import type { NextStep } from "../output.js";

export const EXPLAIN_VERSIONS: NextStep = {
  command: "midnight-cast explain versions",
  reason: "What a version mismatch means and how to resolve it",
};

const ENDPOINT_FLAGS = [
  ["rpc", "--rpc"],
  ["indexerHttp", "--indexer-http"],
  ["indexerWs", "--indexer-ws"],
  ["proofServer", "--proof-server"],
] as const;

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

// The project ID is a secret, so it is never copied into a suggested command.
export function targetArgs(network: string, flags: ResolveFlags): string {
  const overrides = ENDPOINT_FLAGS.flatMap(([key, flag]) => {
    const value = flags[key];
    return value ? [flag, shellQuote(value)] : [];
  });
  return [network, ...overrides].join(" ");
}

function hasOverrides(flags: ResolveFlags): boolean {
  return ENDPOINT_FLAGS.some(([key]) => flags[key]);
}

export function narrowDown(
  network: string,
  flags: ResolveFlags,
  failing: { services: boolean; sync: boolean },
): NextStep[] {
  const target = targetArgs(network, flags);
  return [
    ...(failing.services
      ? [{ command: `midnight-cast ping ${target}`, reason: "Recheck only the services, without the sync and version checks" }]
      : []),
    ...(failing.sync ? [{ command: `midnight-cast tip ${target}`, reason: "Watch whether the indexer catches up" }] : []),
  ];
}

// config show can't see endpoints passed as flags, so it only helps when the config chose them.
export function checkEndpoints(network: string, flags: ResolveFlags): NextStep[] {
  if (hasOverrides(flags)) return [];
  return [
    {
      command: `midnight-cast config show --network ${network}`,
      reason: "Check the configured endpoints; a wrong or retired URL is the usual cause",
    },
  ];
}
