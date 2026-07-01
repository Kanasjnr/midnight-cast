import { gqlPost } from "../clients/indexer.js";

export interface TransactionSegment {
  id: number;
  success: boolean;
}

export interface TransactionFees {
  paidFees: string;
  estimatedFees: string;
}

export interface DustEventSummary {
  id: number;
  typename: string;
}

export interface ZswapEventSummary {
  id: number;
  typename: string;
}

export interface ContractActionSummary {
  typename: string;
}

export interface TransactionSummary {
  typename: string;
  id: number;
  hash: string;
  protocolVersion: number;
  blockHeight: number;
  blockHash: string;
  status?: string;
  segments?: TransactionSegment[];
  fees?: TransactionFees;
  dustLedgerEvents: DustEventSummary[];
  zswapLedgerEvents: ZswapEventSummary[];
  contractActions: ContractActionSummary[];
  identifiers?: string[];
  startIndex?: number;
  endIndex?: number;
}

interface GqlTransaction {
  __typename: string;
  id: number;
  hash: string;
  protocolVersion: number;
  transactionResult?: {
    status: string;
    segments?: TransactionSegment[];
  };
  fees?: TransactionFees;
  block: { height: number; hash: string };
  dustLedgerEvents: Array<{ id: number; __typename: string }>;
  zswapLedgerEvents: Array<{ id: number; __typename: string }>;
  contractActions: Array<{ __typename: string }>;
  identifiers?: string[];
  startIndex?: number;
  endIndex?: number;
}

const TX_QUERY = `
  query TransactionLookup($offset: TransactionOffset!) {
    transactions(offset: $offset) {
      __typename
      id
      hash
      protocolVersion
      ... on RegularTransaction {
        transactionResult {
          status
          segments {
            id
            success
          }
        }
        fees {
          paidFees
          estimatedFees
        }
        identifiers
        startIndex
        endIndex
      }
      block {
        height
        hash
      }
      dustLedgerEvents {
        id
        __typename
      }
      zswapLedgerEvents {
        id
        __typename
      }
      contractActions {
        __typename
      }
    }
  }
`;

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.toLowerCase();
  }
  return `0x${trimmed.toLowerCase()}`;
}

function mapTransaction(tx: GqlTransaction): TransactionSummary {
  return {
    typename: tx.__typename,
    id: tx.id,
    hash: tx.hash,
    protocolVersion: tx.protocolVersion,
    blockHeight: tx.block.height,
    blockHash: tx.block.hash,
    status: tx.transactionResult?.status,
    segments: tx.transactionResult?.segments,
    fees: tx.fees,
    dustLedgerEvents: tx.dustLedgerEvents.map((e) => ({
      id: e.id,
      typename: e.__typename,
    })),
    zswapLedgerEvents: tx.zswapLedgerEvents.map((e) => ({
      id: e.id,
      typename: e.__typename,
    })),
    contractActions: tx.contractActions.map((a) => ({
      typename: a.__typename,
    })),
    identifiers: tx.identifiers,
    startIndex: tx.startIndex,
    endIndex: tx.endIndex,
  };
}

export async function getTransaction(
  indexerHttp: string,
  lookup: { hash?: string; identifier?: string },
): Promise<TransactionSummary | null> {
  const offset =
    lookup.hash !== undefined
      ? { hash: normalizeHex(lookup.hash) }
      : lookup.identifier !== undefined
        ? { identifier: normalizeHex(lookup.identifier) }
        : null;

  if (!offset) {
    throw new Error("Transaction hash or identifier required");
  }

  const data = await gqlPost<{ transactions: GqlTransaction[] }>(
    indexerHttp,
    TX_QUERY,
    { offset },
    15000,
  );

  const tx = data.transactions[0];
  return tx ? mapTransaction(tx) : null;
}

export function formatTransactionHuman(tx: TransactionSummary): string {
  const lines = [
    `Type:     ${tx.typename}`,
    `ID:       ${tx.id}`,
    `Hash:     ${tx.hash}`,
    `Block:    ${tx.blockHeight} (${tx.blockHash})`,
    `Protocol: ${tx.protocolVersion}`,
  ];

  if (tx.status) {
    lines.push(`Status:   ${tx.status}`);
  }

  if (tx.fees) {
    lines.push(
      `Fees:     paid=${tx.fees.paidFees} estimated=${tx.fees.estimatedFees}`,
    );
  }

  if (tx.segments?.length) {
    const seg = tx.segments
      .map((s) => `${s.id}:${s.success ? "ok" : "fail"}`)
      .join(", ");
    lines.push(`Segments: ${seg}`);

    const failed = tx.segments.filter((s) => !s.success);
    if (failed.length > 0) {
      lines.push(
        "Failure:  indexer v4 exposes segment success only (no failure reason)",
        `Hint:     paste wallet/node error → mn decode --raw "<error>"`,
      );
    }
  }

  if (tx.contractActions.length) {
    lines.push(
      `Actions:  ${tx.contractActions.map((a) => a.typename).join(", ")}`,
    );
  }

  if (tx.dustLedgerEvents.length) {
    lines.push(
      `DUST:     ${tx.dustLedgerEvents.map((e) => `${e.id}:${e.typename}`).join(", ")}`,
    );
    for (const e of tx.dustLedgerEvents) {
      lines.push(`          → mn dust-event ${e.id}`);
    }
  }

  if (tx.zswapLedgerEvents.length) {
    lines.push(
      `Zswap:    ${tx.zswapLedgerEvents.map((e) => `${e.id}:${e.typename}`).join(", ")}`,
    );
  }

  if (tx.startIndex !== undefined && tx.endIndex !== undefined) {
    lines.push(`ZswapIdx: ${tx.startIndex} → ${tx.endIndex}`);
  }

  return lines.join("\n");
}
