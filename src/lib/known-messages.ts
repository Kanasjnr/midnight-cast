import { RETIRED, RETIRED_HOSTS, blockfrostProject } from "./blockfrost.js";
import type { NextStep } from "../output.js";

export interface KnownMessage {
  id: string;
  name: string;
  description: string;
  fix: string;
  next: NextStep[];
  /** Declarations in Midnight's examples that show working code for this. */
  examples?: Array<{ example: string; symbol: string }>;
}

interface Pattern {
  test: RegExp;
  describe: (match: RegExpMatchArray) => KnownMessage;
}

const CURRENT_SPEC_VERSION = 1_000_300;

const PATTERNS: Pattern[] = [
  {
    test: /UnsupportedBlockVersion\((\d+)\)|unsupported node version (\d+)/i,
    describe: (match) => {
      const spec = Number(match[1] ?? match[2]);
      return {
        id: "unsupported-block-version",
        name: "UnsupportedBlockVersion",
        description:
          spec === CURRENT_SPEC_VERSION
            ? "The tool reading the chain doesn't know runtime 1.0.300 (spec_version 1000300), which Preview, Preprod and Mainnet run. Toolkit 1.0.0 and node 1.0.2 can't read its blocks."
            : `The tool reading the chain doesn't know runtime spec_version ${spec}.`,
        fix:
          spec === CURRENT_SPEC_VERSION
            ? "Upgrade the node and toolkit to 1.0.400, which Preview, Preprod and Mainnet run on runtime 1.0.300."
            : "Upgrade the node, toolkit or indexer to a release that supports this runtime.",
        next: [{ command: "midnight-cast versions <network>", reason: "See which versions the network expects" }],
      };
    },
  },
  {
    test: /Missing project token/i,
    describe: () => ({
      id: "blockfrost-missing-token",
      name: "Blockfrost: missing project token",
      description: "Blockfrost served the request but no project ID was sent with it.",
      fix: "Send the Blockfrost project ID with every request: as the project_id header over HTTP, or the project_id URL parameter for WebSockets. Each network needs its own. midnight-cast itself reads it from --project-id, the network's config section, BLOCKFROST_<NETWORK>_PROJECT_ID (such as BLOCKFROST_PREPROD_PROJECT_ID) or BLOCKFROST_PROJECT_ID.",
      next: [{ command: "midnight-cast config show --network <network>", reason: "See whether a project ID is configured and where it comes from" }],
    }),
  },
  {
    test: /Invalid project token/i,
    describe: () => ({
      id: "blockfrost-invalid-token",
      name: "Blockfrost: invalid project token",
      description: "Blockfrost rejected the project ID: it is wrong, revoked, or for a different network.",
      fix: 'Use a project ID created for the same network: a Midnight Preprod project for preprod, a Midnight Mainnet one (its ID starts with "nightmainnet") for mainnet. Copy it again from the Blockfrost dashboard.',
      next: [{ command: "midnight-cast config show --network <network>", reason: "See which project ID is used and where it comes from" }],
    }),
  },
  {
    // The decommissioned preprod indexer names its host in a 410 ENDPOINT_DECOMMISSIONED answer, so it matches here too.
    test: new RegExp([...RETIRED_HOSTS].map((host) => `\\b${host.replaceAll(".", "\\.")}\\b`).join("|"), "i"),
    describe: (match) => {
      const { network, date } = RETIRED[match[0].toLowerCase()]!;
      const project = blockfrostProject(network);
      return {
        id: "retired-midnight-host",
        name: `Retired ${network} endpoint`,
        description: `rpc.${network}.midnight.network and indexer.${network}.midnight.network were retired on ${date}. The ${network} RPC and indexer are now served by Blockfrost.`,
        fix: `Point the app and tools at Blockfrost's ${network} endpoints with a ${project} project ID.`,
        next: [{ command: `midnight-cast config init --network ${network}`, reason: `Write a config with the Blockfrost ${network} endpoints` }],
      };
    },
  },
  {
    // The wording Midnight's examples handle in their UI (ui/src/lib/errors.ts).
    test: /Insufficient Funds:?\s*could not balance dust|Wallet\.InsufficientFunds[^\n]*dust/i,
    describe: () => ({
      id: "wallet-insufficient-dust",
      name: "Wallet.InsufficientFunds: could not balance dust",
      description:
        "The wallet couldn't pay the transaction's fee in DUST: it doesn't hold enough, or its DUST state is too stale to balance against the chain.",
      fix:
        "Hold NIGHT registered for DUST generation and wait for DUST to accrue, as Midnight's examples advise. Sync the wallet first, since a stale DUST state fails the same way. Another wallet can also pay the fee (DUST sponsorship).",
      next: [
        { command: "midnight-cast preflight <network> --address <wallet address>", reason: "Check the wallet holds NIGHT registered for DUST" },
        { command: "midnight-cast explain dust", reason: "How NIGHT generates DUST" },
      ],
      examples: [
        { example: "hello-world", symbol: "function withHint" },
        { example: "private-party", symbol: "export async function sponsorAndSubmit" },
        { example: "hello-world", symbol: "export async function syncWallet" },
      ],
    }),
  },
  {
    test: /--feature-zkir-v3|\bZKIR 3\.1\b|ContractModuleProvider|ModuleThunk|declaredInterfaces|circuitSignatures|\bledger-v9\b|compact-runtime["']?\s*[:@]?\s*["']?[\^~]?0\.20\./i,
    describe: () => ({
      id: "compact-ledger-9",
      name: "Contract built for ledger 9",
      description:
        "This looks like output from Compact toolchain 0.35 or Compact runtime 0.20, which target ledger 9. Ledger 9 isn't deployed on Preview, Preprod or Mainnet.",
      fix: "Run compact update 0.31 and pin the Compact runtime version from the support matrix, then rebuild.",
      next: [{ command: "midnight-cast explain versions", reason: "Which versions the public networks support" }],
    }),
  },
];

export function matchKnownMessages(raw: string): KnownMessage[] {
  return PATTERNS.flatMap((pattern) => {
    const match = raw.match(pattern.test);
    return match ? [pattern.describe(match)] : [];
  });
}
