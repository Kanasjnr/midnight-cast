import type { ResolveFlags } from "../config.js";
import type { NextStep, ToolCall } from "../output.js";

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

const NETWORK_TOOLS = new Set(["health", "ping", "tip", "versions"]);

/**
 * The MCP tool call for a suggested command, so agents without a shell can follow it.
 * Commands with a placeholder (<N>), a quoted argument or an endpoint flag have none:
 * the model would have to fill something in, or the MCP server can't target those endpoints.
 */
export function toolCallFor(command: string): ToolCall | undefined {
  if (/[<"']|\s--/.test(command)) return undefined;
  const [bin, name, ...args] = command.trim().split(/\s+/);
  if (bin !== "midnight-cast" || !name) return undefined;
  if (name === "explain" && args.length === 1) return { name, arguments: { topic: args[0] } };
  if (NETWORK_TOOLS.has(name) && args.length === 1) return { name, arguments: { network: args[0] } };
  if (name === "dust-event" && args.length === 2 && /^\d+$/.test(args[0]!)) {
    return { name: "dust_event", arguments: { id: Number(args[0]), network: args[1] } };
  }
  if (name === "tx" && args.length === 2) return { name, arguments: { hash: args[0], network: args[1] } };
  if (name === "block" && args.length === 2) {
    if (args[0] === "latest") return { name, arguments: { network: args[1] } };
    if (/^\d+$/.test(args[0]!)) return { name, arguments: { height: Number(args[0]), network: args[1] } };
  }
  if (name === "decode" && args.length === 1 && /^\d+$/.test(args[0]!)) return { name, arguments: { message: args[0] } };
  return undefined;
}
