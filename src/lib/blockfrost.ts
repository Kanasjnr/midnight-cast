// The token is kept as a project_id URL parameter, since WebSockets can't send
// headers, and the HTTP clients move it into the project_id header.

export const BLOCKFROST_ENV = "BLOCKFROST_PROJECT_ID";

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
      `Set ${BLOCKFROST_ENV} or --project-id. See ${BLOCKFROST_DOCS}`
    );
  }
  if (status === 402 || status === 429) {
    return `${service} rate-limited by Blockfrost (${status}): your project's plan limit was reached. See https://blockfrost.io`;
  }
  return undefined;
}

export function missingProjectIdError(network: string): string {
  return (
    `The ${network} RPC and indexer are served by Blockfrost and need a project token. ` +
    `Create a Midnight Mainnet project at https://blockfrost.io, then set ${BLOCKFROST_ENV}=<project id> ` +
    `(or pass --project-id, or set blockfrost_project_id under [networks.${network}] in the config). ` +
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
