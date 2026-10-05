import {
  chainGetBlockHash,
  chainGetHeadBlockHash,
  chainGetHeader,
  parseBlockNumber,
} from "../clients/rpc.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

async function blockHeaderAtHeight(
  rpcUrl: string,
  height: number,
): Promise<{
  height: number;
  hash: string;
  parentHash: string;
  stateRoot: string;
  extrinsicsRoot: string;
}> {
  const hash = await chainGetBlockHash(rpcUrl, height);
  // The node answers null for a height it hasn't reached, and chain_getHeader(null) is the latest header.
  if (!hash) {
    const latest = parseBlockNumber((await chainGetHeader(rpcUrl)).number);
    throw new Error(`Block ${height} doesn't exist yet; the latest is ${latest}`);
  }
  const header = await chainGetHeader(rpcUrl, hash);
  return {
    height: parseBlockNumber(header.number),
    hash,
    parentHash: header.parentHash,
    stateRoot: header.stateRoot,
    extrinsicsRoot: header.extrinsicsRoot,
  };
}

export async function blockLatestCommand(
  networkArg: string | undefined,
  flags: ResolveFlags,
  _options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  try {
    const [header, hash] = await Promise.all([
      chainGetHeader(endpoints.rpc),
      chainGetHeadBlockHash(endpoints.rpc),
    ]);

    return {
      ok: true,
      data: {
        network: endpoints.network,
        height: parseBlockNumber(header.number),
        hash,
        parentHash: header.parentHash,
        stateRoot: header.stateRoot,
        extrinsicsRoot: header.extrinsicsRoot,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function blockAtHeightCommand(
  heightArg: string,
  networkArg: string | undefined,
  flags: ResolveFlags,
  _options: GlobalOptions,
): Promise<EmitResult> {
  const height = Number.parseInt(heightArg, 10);
  if (!Number.isInteger(height) || height < 0) {
    return fail(`Invalid block height: ${heightArg}`);
  }

  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  try {
    const block = await blockHeaderAtHeight(endpoints.rpc, height);

    return {
      ok: true,
      data: {
        network: endpoints.network,
        height: block.height,
        hash: block.hash,
        parentHash: block.parentHash,
        stateRoot: block.stateRoot,
        extrinsicsRoot: block.extrinsicsRoot,
      },
    };
  } catch (err) {
    return fail(err);
  }
}
