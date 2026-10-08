import type { EmitResult, GlobalOptions } from "../output.js";
import type { Catalog } from "../lib/catalog.js";
import { fail, success } from "../output.js";
import { describeLinks, examplesForTopic } from "../lib/example-links.js";
import { loadExamplesIndex } from "../lib/examples-index.js";
import { formatDate, type BundledReports } from "../lib/examples-report.js";
import { loadDataJson } from "../lib/data-path.js";

export const TOPICS = ["dust", "1010", "versions", "transcript", "sync"] as const;

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

midnight-cast versions compares live node, runtime spec, indexer API,
protocolVersion and optional proof-server against the support matrix.
With a package.json present it also checks local Midnight packages under
either npm scope (@midnight-ntwrk or @midnightntwrk) against the matrix pins,
fails if one package is installed under both scopes, and notes packages that
have moved to @midnightntwrk.

Useful flags:
  --fail-on-mismatch   exit 1 when live checks fail (CI)
  --no-local           skip cwd package.json checks
  --refresh-matrix     fetch Midnight's published matrix now
  --offline            use the matrix bundled with this release

The matrix is Midnight's published one (cached for 6h), with node, proof
server, runtime spec and ledger kept from the bundled copy, since those are
checked against the live network. A support-matrix.json in
~/.config/midnight-cast/ overrides both.

health treats version mismatches as warnings unless --fail-on-mismatch is set.

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

/** Built when asked, from the examples' measurements bundled with this release. */
function syncHelp(): string {
  const index = loadExamplesIndex();
  const reports = Object.values(loadDataJson<BundledReports>("examples-reports.json").reports);
  const latest = reports.filter((r) => r.timings?.coldSyncMinutes !== undefined).sort((a, b) => b.date.localeCompare(a.date))[0];
  const fastSync = `https://github.com/${index.repo}/blob/${index.commit}/FAST-SYNC.md`;
  return [
    "Wallet sync on preview and preprod",
    "==================================",
    "",
    "A new wallet's first sync takes a long time, and that's normal: almost all of it",
    "is building the network-wide DUST generation tree, which grows with the chain.",
    "",
    "What Midnight's examples measured on preprod:",
    "  - Their FAST-SYNC notes: about 78 minutes for a brand-new wallet to reach the",
    "    chain tip, and about 75 seconds for one restored from their pre-seed bundle.",
    ...(latest
      ? [
          `  - Their node ${latest.nodeVersion} run (${formatDate(latest.date)}): ${latest.timings!.coldSyncMinutes} minutes for a first sync from genesis` +
            (latest.timings!.restoreSeconds ? `,` : "."),
          ...(latest.timings!.restoreSeconds ? [`    and ${latest.timings!.restoreSeconds} seconds restoring from the pre-seed bundle.`] : []),
        ]
      : []),
    "",
    "What to do:",
    "  - Let a first sync finish. To rule out the network, run midnight-cast tip <network>:",
    "    an indexer far behind the node makes every wallet look stuck.",
    "  - For tests and demos, start wallets from a pre-seeded bundle, as the examples do:",
    `    ${fastSync}`,
    "  - midnight-cast preflight <network> --address <wallet> checks the wallet holds NIGHT",
    "    registered for DUST, and quotes these timings.",
  ].join("\n");
}

const HELP_BY_TOPIC: Record<(typeof TOPICS)[number], string | (() => string)> = {
  dust: DUST_HELP,
  "1010": HELP_1010,
  versions: VERSIONS_HELP,
  transcript: TRANSCRIPT_HELP,
  sync: syncHelp,
};

export function explainCommand(
  topic: string | undefined,
  options: GlobalOptions,
  catalog?: () => Catalog,
): EmitResult {
  if (topic === undefined) {
    if (options.json && catalog) return success(catalog());
    return success(
      [
        `Topics: ${TOPICS.join(", ")}`,
        "Run midnight-cast explain <topic> for one, or midnight-cast explain --json for every command, option, exit code and error kind.",
      ].join("\n"),
    );
  }

  const key = topic.toLowerCase() as (typeof TOPICS)[number];
  const help = HELP_BY_TOPIC[key];
  if (!help) {
    return fail(`Unknown topic "${topic}". Available: ${TOPICS.join(", ")}`);
  }
  const text = typeof help === "function" ? help() : help;
  const examples = examplesForTopic(key);

  if (options.json) {
    return success({ topic: key, text, ...(examples.length ? { examples } : {}) });
  }

  return success(examples.length ? `${text}\n\nWorking code from Midnight's examples:\n${describeLinks(examples).map((l) => `  ${l}`).join("\n")}` : text);
}
