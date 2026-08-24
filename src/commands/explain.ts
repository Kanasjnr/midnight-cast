import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

const TOPICS = ["dust", "1010", "versions", "transcript"] as const;

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
  - midnight-cast tip <network>     — RPC height vs indexer height
  - midnight-cast dust-event <id>   — event typename, protocolVersion, raw prefix
  - midnight-cast decode <code>     — map Custom N to LedgerApiError name + fix

Compatibility matrix:
  https://docs.midnight.network/relnotes/support-matrix

Indexer API:
  https://docs.midnight.network/api-reference/midnight-indexer
`.trim();

const HELP_1010 = `
Substrate 1010 (Invalid Transaction)
====================================

1010 is an envelope from the Substrate tx pool — not a Midnight ledger code.

Next steps:
  1. Find Custom error: N (u8, 0–255) in the full message
  2. midnight-cast decode ledger N
  3. If DispatchError::Module { index, error }: midnight-cast decode pallet <index> <error>
  4. No Custom(N)? Rejection was upstream (nonce, fee, size, etc.)

Commands:
  midnight-cast decode 1010
  midnight-cast decode --raw "<full wallet/node error>"

Guide:
  https://docs.midnight.network/how-to/decode-1010-transaction-rejection-errors
`.trim();

const VERSIONS_HELP = `
Support matrix / versions
=========================

midnight-cast versions compares live node, indexer API, protocolVersion, and
optional proof-server against the bundled support matrix (and local
@midnight-ntwrk package pins when package.json is present).

Useful flags:
  --fail-on-mismatch   exit 1 when live checks fail (CI)
  --no-local           skip cwd package.json checks

health treats version mismatches as warnings unless --fail-on-mismatch is set.
Override the matrix with ~/.config/midnight-cast/support-matrix.json

Docs:
  https://docs.midnight.network/relnotes/support-matrix
`.trim();

const TRANSCRIPT_HELP = `
Transcript / proof version codes (179–181)
==========================================

Related ledger Custom codes:
  179  UnsupportedProofVersion
  180  GuaranteedTranscriptVersion
  181  FallibleTranscriptVersion

Usually means SDK / proof-server / node ledger pins are skewed.

Debug ladder:
  midnight-cast health <network>
  midnight-cast versions <network>
  midnight-cast decode 179
  midnight-cast decode --raw "<error>"

Matrix:
  https://docs.midnight.network/relnotes/support-matrix
`.trim();

const HELP_BY_TOPIC: Record<(typeof TOPICS)[number], string> = {
  dust: DUST_HELP,
  "1010": HELP_1010,
  versions: VERSIONS_HELP,
  transcript: TRANSCRIPT_HELP,
};

export function explainCommand(
  topic: string,
  options: GlobalOptions,
): EmitResult {
  const key = topic.toLowerCase() as (typeof TOPICS)[number];
  const text = HELP_BY_TOPIC[key];
  if (!text) {
    return fail(`Unknown topic "${topic}". Available: ${TOPICS.join(", ")}`);
  }

  if (options.json) {
    return success({ topic: key, text });
  }

  return success(text);
}
