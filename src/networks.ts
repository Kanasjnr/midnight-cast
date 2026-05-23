export interface NetworkEndpoints {
  networkId: string;
  rpc: string;
  rpcWs?: string;
  indexerHttp: string;
  indexerWs: string;
  proofServer?: string;
}

const indexerHttp = (host: string) =>
  `https://indexer.${host}.midnight.network/api/v4/graphql`;
const indexerWs = (host: string) =>
  `wss://indexer.${host}.midnight.network/api/v4/graphql/ws`;

export const BUILTIN_NETWORKS: Record<string, NetworkEndpoints> = {
  preview: {
    networkId: "preview",
    rpc: "https://rpc.preview.midnight.network",
    rpcWs: "wss://rpc.preview.midnight.network",
    indexerHttp: indexerHttp("preview"),
    indexerWs: indexerWs("preview"),
    proofServer: "https://lace-proof-pub.preview.midnight.network",
  },
  preprod: {
    networkId: "preprod",
    rpc: "https://rpc.preprod.midnight.network",
    rpcWs: "wss://rpc.preprod.midnight.network",
    indexerHttp: indexerHttp("preprod"),
    indexerWs: indexerWs("preprod"),
    proofServer: "https://lace-proof-pub.preprod.midnight.network",
  },
  mainnet: {
    networkId: "mainnet",
    rpc: "https://rpc.mainnet.midnight.network",
    rpcWs: "wss://rpc.mainnet.midnight.network",
    indexerHttp: indexerHttp("mainnet"),
    indexerWs: indexerWs("mainnet"),
    proofServer: "https://lace-proof-pub.mainnet.midnight.network",
  },
  local: {
    networkId: "local",
    rpc: "http://127.0.0.1:9944",
    rpcWs: "ws://127.0.0.1:9944",
    indexerHttp: "http://127.0.0.1:8088/api/v4/graphql",
    indexerWs: "ws://127.0.0.1:8088/api/v4/graphql/ws",
  },
};

export const NETWORK_NAMES = Object.keys(BUILTIN_NETWORKS);
