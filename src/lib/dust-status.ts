import { gqlPost } from "../clients/indexer.js";

const DUST_STATUS_QUERY = `
  query DustStatus($addresses: [CardanoRewardAddress!]!) {
    dustGenerationStatus(cardanoRewardAddresses: $addresses) {
      cardanoRewardAddress
      dustAddress
      registered
      nightBalance
      generationRate
      currentCapacity
      maxCapacity
      utxoTxHash
      utxoOutputIndex
    }
  }
`;

interface DustStatusPayload {
  cardanoRewardAddress: string;
  dustAddress: string | null;
  registered: boolean;
  nightBalance: string;
  generationRate: string;
  currentCapacity: string;
  maxCapacity: string;
  utxoTxHash: string | null;
  utxoOutputIndex: number | null;
}

export interface DustStatus {
  cardanoRewardAddress: string;
  registered: boolean;
  dustAddress?: string;
  nightBalance: string;
  generationRate: string;
  currentCapacity: string;
  maxCapacity: string;
  utxo?: { transactionHash: string; outputIndex: number };
}

export async function getDustStatus(indexerHttp: string, addresses: string[]): Promise<DustStatus[]> {
  const data = await gqlPost<{ dustGenerationStatus: DustStatusPayload[] }>(indexerHttp, DUST_STATUS_QUERY, { addresses });
  return data.dustGenerationStatus.map((s) => ({
    cardanoRewardAddress: s.cardanoRewardAddress,
    registered: s.registered,
    ...(s.dustAddress ? { dustAddress: s.dustAddress } : {}),
    nightBalance: s.nightBalance,
    generationRate: s.generationRate,
    currentCapacity: s.currentCapacity,
    maxCapacity: s.maxCapacity,
    ...(s.utxoTxHash && s.utxoOutputIndex !== null ? { utxo: { transactionHash: s.utxoTxHash, outputIndex: s.utxoOutputIndex } } : {}),
  }));
}

export function formatDustStatusHuman(network: string, statuses: DustStatus[]): string {
  const lines = [`Network: ${network}`];
  for (const s of statuses) {
    lines.push(
      "",
      `${s.cardanoRewardAddress}`,
      `  registered:       ${s.registered ? "yes" : "no"}${s.dustAddress ? ` (DUST address ${s.dustAddress})` : ""}`,
      `  NIGHT balance:    ${s.nightBalance}`,
      `  generation rate:  ${s.generationRate}`,
      `  DUST capacity:    ${s.currentCapacity} of ${s.maxCapacity}`,
    );
  }
  return lines.join("\n");
}
