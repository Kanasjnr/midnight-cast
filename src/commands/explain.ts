import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

const DUST_HELP = `
DUST on Midnight
================

tDUST vs DUST
  - tDUST: test tokens on preprod/preview (faucet).
  - DUST: fee token on the ledger; registration and spend proofs must match network rules.

Indexer vs node
  - The node applies ledger rules (Custom N errors on bad proofs).
  - The indexer exposes dustLedgerEvents via GraphQL subscription (v4 has no HTTP query).

Debugging sync / version issues
  - mn tip <network>     — RPC height vs indexer height
  - mn dust-event <id>   — event typename, protocolVersion, raw prefix
  - mn decode <code>     — map Custom N to LedgerApiError name + fix

Compatibility matrix:
  https://docs.midnight.network/relnotes/support-matrix

Indexer API:
  https://docs.midnight.network/api-reference/midnight-indexer
`.trim();

export function explainCommand(
  topic: string,
  options: GlobalOptions,
): EmitResult {
  if (topic !== "dust") {
    return fail(`Unknown topic "${topic}". Available: dust`);
  }

  if (options.json) {
    return success({
      topic: "dust",
      text: DUST_HELP,
      matrixUrl: "https://docs.midnight.network/relnotes/support-matrix",
      indexerDocs: "https://docs.midnight.network/api-reference/midnight-indexer",
    });
  }

  return success(DUST_HELP);
}
