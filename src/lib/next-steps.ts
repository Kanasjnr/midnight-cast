import type { NextStep } from "../output.js";

export const EXPLAIN_VERSIONS: NextStep = {
  command: "midnight-cast explain versions",
  reason: "What a version mismatch means and how to resolve it",
};

export function narrowDown(network: string, failing: { services: boolean; sync: boolean }): NextStep[] {
  return [
    ...(failing.services
      ? [{ command: `midnight-cast ping ${network}`, reason: "Recheck only the services, without the sync and version checks" }]
      : []),
    ...(failing.sync ? [{ command: `midnight-cast tip ${network}`, reason: "Watch whether the indexer catches up" }] : []),
  ];
}

export function checkEndpoints(network: string): NextStep {
  return {
    command: `midnight-cast config show --network ${network}`,
    reason: "Check the configured endpoints; a wrong or retired URL is the usual cause",
  };
}
