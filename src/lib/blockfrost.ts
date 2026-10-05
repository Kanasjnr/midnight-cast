import { inMcpCall } from "./surface.js";
// The token is kept as a project_id URL parameter, since WebSockets can't send
// headers, and the HTTP clients move it into the project_id header.

export const BLOCKFROST_ENV = "BLOCKFROST_PROJECT_ID";
// The Claude Code plugin passes its Blockfrost option in a variable of its own, so a
// BLOCKFROST_PROJECT_ID the user exported still reaches the server when the option is empty.
export const PLUGIN_PROJECT_ID_ENV = "MIDNIGHT_CAST_PLUGIN_PROJECT_ID";
const PLUGIN_OPTION = "the midnight-cast plugin's Blockfrost option (/plugin, then midnight-cast, then Configure options)";
const fromPlugin = () => PLUGIN_PROJECT_ID_ENV in process.env;

export const BLOCKFROST_DOCS =
  "https://docs.midnight.network/guides/networks-and-environments#blockfrost-the-mainnet-indexer-and-rpc-provider";

const PARAM = "project_id";

export const RETIRED_HOSTS = new Set(["rpc.mainnet.midnight.network", "indexer.mainnet.midnight.network"]);

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

export function usesBlockfrost(endpoints: {
  rpc?: string;
  rpcWs?: string;
  indexerHttp?: string;
  indexerWs?: string;
}): boolean {
  return [endpoints.rpc, endpoints.rpcWs, endpoints.indexerHttp, endpoints.indexerWs].some(isBlockfrostUrl);
}

export const PROJECT_ID_SOURCES =
  "--project-id, the network's config section (blockfrost_project_id, or a project_id in its URLs), or BLOCKFROST_PROJECT_ID, in that order";

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

export function blockfrostHttpError(service: "RPC" | "Indexer", status: number): string | undefined {
  if (status === 403) {
    return (
      `${service} rejected by Blockfrost (403): the project token is missing, invalid, ` +
      `or for a different network. Mainnet needs a Midnight Mainnet project ID (it starts with "nightmainnet"). ` +
      `${inMcpCall() ? `This MCP server reads it from the network's config.toml section, then ${fromPlugin() ? `${PLUGIN_OPTION}, then ` : ""}${BLOCKFROST_ENV} in its environment` : `It is read from ${PROJECT_ID_SOURCES}`}. ` +
      `See ${BLOCKFROST_DOCS}`
    );
  }
  if (status === 402 || status === 429) {
    return `${service} rate-limited by Blockfrost (${status}): your project's plan limit was reached. See https://blockfrost.io`;
  }
  return undefined;
}

export function missingProjectIdError(network: string): string {
  if (inMcpCall()) {
    const fix = fromPlugin()
      ? `enter its project ID in ${PLUGIN_OPTION}, or export ${BLOCKFROST_ENV} before starting Claude Code`
      : `add ${BLOCKFROST_ENV} with its project ID to this server's env in the MCP client's configuration and restart the server`;
    return (
      `The ${network} RPC and indexer are served by Blockfrost and need a project ID, and this MCP server has none. ` +
      `Create a Midnight Mainnet project at https://blockfrost.io, then ${fix}. See ${BLOCKFROST_DOCS}`
    );
  }
  return (
    `The ${network} RPC and indexer are served by Blockfrost and need a project token. ` +
    `Create a Midnight Mainnet project at https://blockfrost.io, then set ${BLOCKFROST_ENV}=<project id>, ` +
    `pass --project-id, or set blockfrost_project_id under [networks.${network}] in the config. ` +
    `See ${BLOCKFROST_DOCS}`
  );
}

export function retiredEndpointWarning(network: string, urls: string[]): string {
  const hosts = [...new Set(urls.map((u) => parse(u)?.hostname ?? u))];
  const list = hosts.join(" and ");
  return (
    `Warning: ${list} ${hosts.length > 1 ? "were" : "was"} retired on 2026-09-30 and can stop answering at any time. ` +
    `The ${network} RPC and indexer are now served by Blockfrost: run "midnight-cast config init --network ${network}" ` +
    `or update your config. See ${BLOCKFROST_DOCS}`
  );
}
