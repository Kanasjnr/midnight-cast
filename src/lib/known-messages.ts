import { RETIRED, RETIRED_HOSTS, blockfrostProject } from "./blockfrost.js";
import type { NextStep } from "../output.js";
import { loadSupportMatrix } from "./versions.js";

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
  describe: (match: RegExpMatchArray, network?: string) => KnownMessage;
}

const PUBLIC_NETWORKS = ["preview", "preprod", "mainnet"];

const title = (network: string) => network[0]!.toUpperCase() + network.slice(1);

function names(networks: string[]): string {
  const titled = networks.map(title);
  return titled.length > 1 ? `${titled.slice(0, -1).join(", ")} and ${titled.at(-1)}` : (titled[0] ?? "");
}

const runs = (networks: string[]) => `${names(networks)} ${networks.length > 1 ? "run" : "runs"}`;

const ledgerMajor = (ledger: string | undefined) => Number(ledger?.split(".")[0] ?? 0);

const PATTERNS: Pattern[] = [
  {
    test: /UnsupportedBlockVersion\((\d+)\)|unsupported node version (\d+)/i,
    describe: (match) => {
      const spec = Number(match[1] ?? match[2]);
      const matrix = loadSupportMatrix().networks;
      const on = PUBLIC_NETWORKS.filter((network) => matrix[network]?.runtimeSpec === spec);
      const node = on.length ? matrix[on[0]!]!.node : undefined;
      return {
        id: "unsupported-block-version",
        name: "UnsupportedBlockVersion",
        description: node
          ? `The tool reading the chain doesn't know runtime spec_version ${spec}, which ${runs(on)}. A node or toolkit built for an older runtime can't read its blocks.`
          : `The tool reading the chain doesn't know runtime spec_version ${spec}.`,
        fix: node
          ? `Upgrade the node and toolkit to ${node} or later, which ${runs(on)} on this runtime.`
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
    test: /--feature-zkir-v3|\bZKIR 3\.1\b|ContractModuleProvider|ModuleThunk|declaredInterfaces|circuitSignatures|\bledger-v9\b|compact-runtime["']?\s*[:@]?\s*["']?[\^~]?0\.2\d\./i,
    describe: (_match, network) => {
      const matrix = loadSupportMatrix().networks;
      const runtime = (name: string) => matrix[name]?.packages?.["@midnight-ntwrk/compact-runtime"];
      const pin = (name: string) => (runtime(name) ? ` to ${runtime(name)}` : "");
      const onNine = PUBLIC_NETWORKS.filter((name) => ledgerMajor(matrix[name]?.ledger) >= 9);
      const onEight = PUBLIC_NETWORKS.filter((name) => !onNine.includes(name));
      const intro = "This looks like output from Compact toolchain 0.35 or later, or Compact runtime 0.20 or later, which target Ledger 9.";
      const next: NextStep[] = [{ command: "midnight-cast versions <network>", reason: "Which ledger and versions the network runs" }];
      if (network && PUBLIC_NETWORKS.includes(network)) {
        const ledger = matrix[network]?.ledger;
        return onNine.includes(network)
          ? {
              id: "compact-ledger-9",
              name: "Contract built for Ledger 9",
              description: `${intro} ${title(network)} runs Ledger 9 (ledger ${ledger}), so a build for Ledger 9 is the right one there.`,
              fix: `Keep the Ledger 9 toolchain, and pin the Compact runtime${pin(network)} as the support matrix lists for ${title(network)}. If the build still fails, the ledger it targets isn't the cause.`,
              next,
            }
          : {
              id: "compact-ledger-9",
              name: "Contract built for Ledger 9",
              description: `${intro} ${title(network)} still runs Ledger 8 (ledger ${ledger}), so a contract built for Ledger 9 doesn't run there.`,
              fix: `For ${title(network)}, run compact update 0.31 and pin the Compact runtime${pin(network)} from the support matrix, then rebuild.`,
              next,
            };
      }
      if (!onNine.length) {
        return {
          id: "compact-ledger-9",
          name: "Contract built for Ledger 9",
          description: `${intro} Ledger 9 isn't deployed on ${names(PUBLIC_NETWORKS)}.`,
          fix: "Run compact update 0.31 and pin the Compact runtime version from the support matrix, then rebuild.",
          next,
        };
      }
      return {
        id: "compact-ledger-9",
        name: "Contract built for Ledger 9",
        description: `${intro} ${runs(onNine)} Ledger 9${onEight.length ? `; ${names(onEight)} still ${onEight.length > 1 ? "run" : "runs"} Ledger 8` : ""}.`,
        fix: onEight.length
          ? `On ${names(onNine)}, keep this build and pin the Compact runtime from the support matrix. On ${names(onEight)}, run compact update 0.31 and pin its Compact runtime instead, then rebuild.`
          : "Keep this build, and pin the Compact runtime from the support matrix.",
        next: [{ command: 'midnight-cast decode --raw "<the message>" --network <network>', reason: "Advice for the network you deploy to" }, ...next],
      };
    },
  },
];

export function matchKnownMessages(raw: string, network?: string): KnownMessage[] {
  return PATTERNS.flatMap((pattern) => {
    const match = raw.match(pattern.test);
    return match ? [pattern.describe(match, network)] : [];
  });
}
