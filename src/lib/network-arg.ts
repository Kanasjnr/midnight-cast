import { NETWORK_NAMES } from "../networks.js";

export function isNetworkName(value: string | undefined): value is string {
  return value !== undefined && NETWORK_NAMES.includes(value);
}

export function splitRpcPositionalArgs(
  params: string | undefined,
  network: string | undefined,
): { params: string | undefined; network: string | undefined } {
  if (network !== undefined) {
    return { params, network };
  }
  if (params !== undefined && isNetworkName(params)) {
    return { params: undefined, network: params };
  }
  return { params, network };
}
