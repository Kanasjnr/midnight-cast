import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";
import {
  BUILTIN_NETWORKS,
  NETWORK_NAMES,
  type NetworkEndpoints,
} from "./networks.js";

export interface ConfigFile {
  networks?: Record<string, TomlNetworkSection>;
  defaults?: { network?: string };
}

interface TomlNetworkSection {
  network_id?: string;
  rpc?: string;
  rpc_ws?: string;
  indexer_http?: string;
  indexer_ws?: string;
  proof_server?: string;
}

export interface ResolveFlags {
  network?: string;
  rpc?: string;
  rpcWs?: string;
  indexerHttp?: string;
  indexerWs?: string;
  proofServer?: string;
}

export function configPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "midnight-cast", "config.toml");
}

function sectionToEndpoints(
  section: TomlNetworkSection,
  fallback?: NetworkEndpoints,
): NetworkEndpoints {
  return {
    networkId:
      section.network_id ?? fallback?.networkId ?? "unknown",
    rpc: section.rpc ?? fallback?.rpc ?? "",
    rpcWs: section.rpc_ws ?? fallback?.rpcWs,
    indexerHttp: section.indexer_http ?? fallback?.indexerHttp ?? "",
    indexerWs: section.indexer_ws ?? fallback?.indexerWs ?? "",
    proofServer: section.proof_server ?? fallback?.proofServer,
  };
}

function endpointsToSection(
  endpoints: NetworkEndpoints,
): TomlNetworkSection {
  return {
    network_id: endpoints.networkId,
    rpc: endpoints.rpc,
    ...(endpoints.rpcWs ? { rpc_ws: endpoints.rpcWs } : {}),
    indexer_http: endpoints.indexerHttp,
    indexer_ws: endpoints.indexerWs,
    ...(endpoints.proofServer
      ? { proof_server: endpoints.proofServer }
      : {}),
  };
}

export function loadConfigFile(): ConfigFile {
  const path = configPath();
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8");
  return TOML.parse(raw) as ConfigFile;
}

export function writeConfigFile(config: ConfigFile): void {
  const path = configPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, TOML.stringify(config as TOML.JsonMap));
}

export function resolveNetwork(
  name?: string,
  flags: ResolveFlags = {},
): NetworkEndpoints & { network: string } {
  const file = loadConfigFile();
  const networkName =
    flags.network ??
    name ??
    process.env.MN_NETWORK ??
    file.defaults?.network ??
    "preprod";

  const builtin = BUILTIN_NETWORKS[networkName];
  const fromFile = file.networks?.[networkName];
  const fromFileEndpoints = fromFile
    ? sectionToEndpoints(fromFile, builtin)
    : undefined;

  if (!builtin && !fromFileEndpoints) {
    throw new Error(
      `Unknown network "${networkName}". Known: ${NETWORK_NAMES.join(", ")}`,
    );
  }

  const base = fromFileEndpoints ?? builtin!;

  const merged: NetworkEndpoints = {
    networkId: base.networkId,
    rpc: flags.rpc ?? base.rpc,
    rpcWs: flags.rpcWs ?? base.rpcWs,
    indexerHttp: flags.indexerHttp ?? base.indexerHttp,
    indexerWs: flags.indexerWs ?? base.indexerWs,
    proofServer: flags.proofServer ?? base.proofServer,
  };

  if (!merged.rpc || !merged.indexerHttp || !merged.indexerWs) {
    throw new Error(
      `Network "${networkName}" is missing required endpoints. Run: mn config init`,
    );
  }

  return { ...merged, network: networkName };
}

export function initConfig(options: {
  network: string;
  rpc?: string;
  indexerHttp?: string;
  indexerWs?: string;
  proofServer?: string;
}): string {
  const builtin = BUILTIN_NETWORKS[options.network];
  if (!builtin && !options.rpc) {
    throw new Error(
      `Unknown network "${options.network}". Provide --rpc and indexer URLs, or pick: ${NETWORK_NAMES.join(", ")}`,
    );
  }

  const endpoints: NetworkEndpoints = {
    networkId: options.network,
    rpc: options.rpc ?? builtin!.rpc,
    rpcWs: builtin?.rpcWs,
    indexerHttp: options.indexerHttp ?? builtin!.indexerHttp,
    indexerWs: options.indexerWs ?? builtin!.indexerWs,
    proofServer: options.proofServer ?? builtin?.proofServer,
  };

  const file = loadConfigFile();
  file.defaults = { network: options.network };
  file.networks = file.networks ?? {};
  file.networks[options.network] = endpointsToSection(endpoints);

  writeConfigFile(file);
  return configPath();
}
