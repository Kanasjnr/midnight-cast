import { createHash } from "node:crypto";
import { gqlPost } from "../clients/indexer.js";

const CONTRACT_QUERY = `
  query ContractLookup($address: HexEncoded!) {
    contractAction(address: $address) {
      __typename
      address
      state
      transaction {
        hash
        block { height timestamp }
      }
      unshieldedBalances { tokenType amount }
      ... on ContractCall {
        entryPoint
        deploy {
          transaction {
            hash
            block { height timestamp }
          }
        }
      }
    }
  }
`;

interface TransactionRef {
  hash: string;
  block: { height: number; timestamp: number };
}

interface ContractActionPayload {
  __typename: "ContractDeploy" | "ContractCall" | "ContractUpdate";
  address: string;
  state: string;
  transaction: TransactionRef;
  unshieldedBalances: Array<{ tokenType: string; amount: string }>;
  entryPoint?: string;
  deploy?: { transaction: TransactionRef };
}

export interface ContractSummary {
  address: string;
  latestAction: {
    kind: "deploy" | "call" | "update";
    entryPoint?: string;
    transactionHash: string;
    blockHeight: number;
    time: string;
  };
  deployed?: { transactionHash: string; blockHeight: number; time: string };
  unshieldedBalances: Array<{ tokenType: string; amount: string }>;
  state: { bytes: number; sha256: string; hex?: string };
}

const KINDS = { ContractDeploy: "deploy", ContractCall: "call", ContractUpdate: "update" } as const;

/** Hex as the indexer's HexEncoded wants it: no 0x, an even number of digits. */
export function normalizeContractAddress(address: string): string | undefined {
  const hex = address.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]+$/.test(hex) && hex.length % 2 === 0 ? hex : undefined;
}

function ref(tx: TransactionRef) {
  return { transactionHash: tx.hash, blockHeight: tx.block.height, time: new Date(tx.block.timestamp).toISOString() };
}

export async function getContract(
  indexerHttp: string,
  address: string,
  includeState = false,
): Promise<ContractSummary | null> {
  const data = await gqlPost<{ contractAction: ContractActionPayload | null }>(indexerHttp, CONTRACT_QUERY, { address });
  const action = data.contractAction;
  if (!action) return null;
  const stateHex = action.state.replace(/^0x/, "");
  const deployTx = action.__typename === "ContractDeploy" ? action.transaction : action.deploy?.transaction;
  return {
    address: action.address,
    latestAction: {
      kind: KINDS[action.__typename],
      ...(action.entryPoint ? { entryPoint: action.entryPoint } : {}),
      ...ref(action.transaction),
    },
    ...(deployTx ? { deployed: ref(deployTx) } : {}),
    unshieldedBalances: action.unshieldedBalances,
    state: {
      bytes: stateHex.length / 2,
      sha256: createHash("sha256").update(Buffer.from(stateHex, "hex")).digest("hex"),
      ...(includeState ? { hex: action.state } : {}),
    },
  };
}

export function formatContractHuman(network: string, contract: ContractSummary): string {
  const { latestAction: last } = contract;
  const lines = [
    `Network:  ${network}`,
    `Address:  ${contract.address}`,
    `Latest:   ${last.kind}${last.entryPoint ? ` (${last.entryPoint})` : ""} in block ${last.blockHeight} at ${last.time}`,
    `          tx ${last.transactionHash}`,
  ];
  if (contract.deployed && last.kind !== "deploy") {
    lines.push(`Deployed: block ${contract.deployed.blockHeight} at ${contract.deployed.time}`, `          tx ${contract.deployed.transactionHash}`);
  } else if (last.kind === "update") {
    lines.push("Deployed: not reported after an update (the indexer links the deploy only from calls)");
  }
  lines.push(
    `State:    ${contract.state.bytes} bytes, sha256 ${contract.state.sha256}`,
    `Balances: ${contract.unshieldedBalances.length ? contract.unshieldedBalances.map((b) => `${b.amount} of ${b.tokenType}`).join(", ") : "none unshielded"}`,
  );
  if (contract.state.hex) lines.push("", contract.state.hex);
  return lines.join("\n");
}
