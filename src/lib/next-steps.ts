import type { NextStep } from "../output.js";

export const EXPLAIN_VERSIONS: NextStep = {
  command: "midnight-cast explain versions",
  reason: "What a version mismatch means and how to resolve it",
};

export function checkEndpoints(network: string): NextStep {
  return {
    command: `midnight-cast config show --network ${network}`,
    reason: "Check the configured endpoints; a wrong or retired URL is the usual cause",
  };
}
