import { inMcpCall } from "./surface.js";
// The token is kept as a project_id URL parameter, since WebSockets can't send
// headers, and the HTTP clients move it into the project_id header.

// Any network's fallback. Tokens are per network, so BLOCKFROST_<NETWORK>_PROJECT_ID comes first.
export const BLOCKFROST_ENV = "BLOCKFROST_PROJECT_ID";

const envName = (network: string) => network.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** The variable that holds one network's project ID, such as BLOCKFROST_PREPROD_PROJECT_ID. */
export const networkProjectIdEnv = (network: string) => `BLOCKFROST_${envName(network)}_PROJECT_ID`;

// The Claude Code plugin passes its Blockfrost options in variables of its own, so a
// BLOCKFROST_* the user exported still reaches the server when an option is empty.
export const pluginProjectIdEnv = (network: string) => `MIDNIGHT_CAST_PLUGIN_${envName(network)}_PROJECT_ID`;
const PLUGIN_OPTION = "the midnight-cast plugin's Blockfrost options (/plugin, then midnight-cast, then Configure options)";
const fromPlugin = (network: string) => pluginProjectIdEnv(network) in process.env;

/** Every environment variable a project ID can come from, for redaction. */
export const isProjectIdEnv = (name: string) => /^(BLOCKFROST_(?:[A-Z0-9_]+_)?PROJECT_ID|MIDNIGHT_CAST_PLUGIN_[A-Z0-9_]+_PROJECT_ID)$/.test(name);

export const BLOCKFROST_DOCS =
  "https://docs.midnight.network/guides/networks-and-environments#blockfrost-the-mainnet-indexer-and-rpc-provider";

const PARAM = "project_id";

/** Midnight's hosted endpoints that Blockfrost replaced, with the network and the day they were retired. */
export const RETIRED: Record<string, { network: string; date: string }> = {
  "rpc.mainnet.midnight.network": { network: "mainnet", date: "2026-09-30" },
  "indexer.mainnet.midnight.network": { network: "mainnet", date: "2026-09-30" },
  "rpc.preprod.midnight.network": { network: "preprod", date: "2026-10-09" },
  "indexer.preprod.midnight.network": { network: "preprod", date: "2026-10-09" },
};
export const RETIRED_HOSTS = new Set(Object.keys(RETIRED));

export const networkTitle = (network: string) => network.charAt(0).toUpperCase() + network.slice(1);
/** Blockfrost's name for a network's project type, such as "Midnight Preprod". */
export const blockfrostProject = (network: string) => `Midnight ${networkTitle(network)}`;

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function isBlockfrostUrl(url: string | undefined): boolean {
  const host = url ? parse(url)?.hostname : undefined;
  return host === "blockfrost.io" || (host?.endsWith(".blockfrost.io") ?? false);
}

/** The Midnight network a Blockfrost host serves: midnight-preprod.blockfrost.io and rpc.midnight-preprod.blockfrost.io are preprod. */
export function blockfrostNetwork(url: string | undefined): string | undefined {
  const host = url ? parse(url)?.hostname : undefined;
  return host ? /(?:^|\.)midnight-([a-z0-9-]+)\.blockfrost\.io$/.exec(host)?.[1] : undefined;
}

/** The network a Midnight project ID was made for, from its prefix: Midnight Mainnet IDs start with "nightmainnet". */
export function projectIdNetwork(projectId: string): string | undefined {
  return /^night(mainnet|preprod|preview)/.exec(projectId.trim())?.[1];
}

export function usesBlockfrost(endpoints: {
  rpc?: string;
  rpcWs?: string;
  indexerHttp?: string;
  indexerWs?: string;
}): boolean {
  return [endpoints.rpc, endpoints.rpcWs, endpoints.indexerHttp, endpoints.indexerWs].some(isBlockfrostUrl);
}

/** Where a network's project ID is read from. `served` is the network Blockfrost serves, when the config names it otherwise. */
export const projectIdSources = (network: string, served = network) =>
  `--project-id, the network's config section (blockfrost_project_id, or a project_id in its URLs), ${networkProjectIdEnv(served)}${served !== network ? ` or ${networkProjectIdEnv(network)}` : ""}, or ${BLOCKFROST_ENV}, in that order`;

export function isRetiredUrl(url: string | undefined): boolean {
  const host = url ? parse(url)?.hostname : undefined;
  return host !== undefined && RETIRED_HOSTS.has(host);
}

export function hasProjectId(url: string): boolean {
  return parse(url)?.searchParams.has(PARAM) ?? false;
}

export function withProjectId(url: string, projectId: string): string {
  const u = parse(url);
  if (!u) return url;
  u.searchParams.set(PARAM, projectId);
  return u.toString();
}

export function takeProjectId(url: string): { url: string; projectId?: string } {
  const u = parse(url);
  const projectId = u?.searchParams.get(PARAM) ?? undefined;
  if (!u || projectId === undefined) return { url };
  u.searchParams.delete(PARAM);
  return { url: u.toString(), projectId };
}

function whereFrom(network: string): string {
  if (!inMcpCall()) return `It is read from ${projectIdSources(network)}`;
  const plugin = fromPlugin(network) ? `${PLUGIN_OPTION}, then ` : "";
  return `This MCP server reads it from the network's config.toml section, then ${plugin}${networkProjectIdEnv(network)}, then ${BLOCKFROST_ENV} in its environment`;
}

export function blockfrostHttpError(service: "RPC" | "Indexer", status: number, url?: string): string | undefined {
  if (status === 403) {
    const network = blockfrostNetwork(url);
    const needs = network
      ? `${networkTitle(network)} needs a ${blockfrostProject(network)} project ID${network === "mainnet" ? ' (it starts with "nightmainnet")' : ""}. `
      : "";
    return (
      `${service} rejected by Blockfrost (403): the project token is missing, invalid, ` +
      `or for a different network; each network needs its own. ${needs}` +
      `${whereFrom(network ?? "<network>")}. See ${BLOCKFROST_DOCS}`
    );
  }
  if (status === 402 || status === 429) {
    return `${service} rate-limited by Blockfrost (${status}): your project's plan limit was reached. See https://blockfrost.io`;
  }
  return undefined;
}

/**
 * The error for a Blockfrost network with no project ID. `network` is the config's name for it, which names
 * its config section; `served` is the network Blockfrost serves, which names the project and the variable.
 * `skipped` names a variable whose ID was made for another network, so it wasn't used.
 */
export function missingProjectIdError(network: string, skipped?: { env: string; network: string }, served = network): string {
  const wrong = skipped
    ? `${skipped.env} holds a ${blockfrostProject(skipped.network)} project ID, and ${network} rejects IDs from other networks. `
    : "";
  if (inMcpCall()) {
    const fix = fromPlugin(served)
      ? `enter its project ID in ${PLUGIN_OPTION}, or export ${networkProjectIdEnv(served)} before starting Claude Code`
      : `add ${networkProjectIdEnv(served)} with its project ID to this server's env in the MCP client's configuration and restart the server`;
    return (
      `The ${network} RPC and indexer are served by Blockfrost and need a project ID, and this MCP server has none for ${network}. ${wrong}` +
      `Create a ${blockfrostProject(served)} project at https://blockfrost.io, then ${fix}. See ${BLOCKFROST_DOCS}`
    );
  }
  return (
    `The ${network} RPC and indexer are served by Blockfrost and need a project token. ${wrong}` +
    `Create a ${blockfrostProject(served)} project at https://blockfrost.io, then set ${networkProjectIdEnv(served)}=<project id>, ` +
    `pass --project-id, or set blockfrost_project_id under [networks.${network}] in the config. ` +
    `See ${BLOCKFROST_DOCS}`
  );
}

export function retiredEndpointWarning(network: string, urls: string[]): string {
  const hosts = [...new Set(urls.map((u) => parse(u)?.hostname ?? u))];
  const dates = [...new Set(hosts.map((h) => RETIRED[h]?.date).filter(Boolean))];
  const list = hosts.join(" and ");
  return (
    `Warning: ${list} ${hosts.length > 1 ? "were" : "was"} retired on ${dates.join(" and ")} and no longer answers, or can stop at any time. ` +
    `The ${network} RPC and indexer are now served by Blockfrost: run "midnight-cast config init --network ${network}" ` +
    `or update your config. See ${BLOCKFROST_DOCS}`
  );
}
