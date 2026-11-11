import { RETIRED, RETIRED_HOSTS, blockfrostProject, networkTitle as title } from "./blockfrost.js";
import type { NextStep } from "../output.js";
import { loadSupportMatrix } from "./versions.js";
import { PUBLIC_NETWORKS, ledgerMajor, names, publicNetworks, runs } from "./network-names.js";

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
  /** undefined when the text matches but isn't a problem on this network. */
  describe: (match: RegExpMatchArray, network?: string) => KnownMessage | undefined;
}

/** Each version with the networks that run it, so networks that differ aren't given one network's version. */
/** How to upgrade, per network, so networks that differ aren't given one network's version. */
function upgradeAdvice(component: string, networks: string[], versionOf: (network: string) => string | undefined): string | undefined {
  const groups = new Map<string, string[]>();
  const unknown: string[] = [];
  for (const network of networks) {
    const version = versionOf(network);
    if (version) groups.set(version, [...(groups.get(version) ?? []), network]);
    else unknown.push(network);
  }
  if (!groups.size) return undefined;
  const advice =
    groups.size === 1
      ? `Upgrade the ${component} to ${[...groups.keys()][0]} or later, which ${runs([...groups.values()][0]!)} on this runtime.`
      : `Upgrade the ${component} to the version the network runs on this runtime: ${[...groups].map(([version, on]) => `${version} or later for ${names(on)}`).join(", ")}.`;
  return unknown.length ? `${advice} The support matrix gives no version for ${names(unknown)}.` : advice;
}

function compactRuntimePin(packages: Record<string, string> | undefined): string | undefined {
  const name = Object.keys(packages ?? {}).find((key) => key.endsWith("/compact-runtime"));
  return name ? packages![name] : undefined;
}

const COMPACT_LEDGER_9 = /--feature-zkir-v3|\bZKIR 3\.1\b|ContractModuleProvider|ModuleThunk|declaredInterfaces|circuitSignatures|\bledger-v9\b|compact-runtime["']?\s*[:@]?\s*["']?[\^~]?(?:0\.[2-9]\d|[1-9]\d*\.\d+)\./i;

const PATTERNS: Pattern[] = [
  {
    test: /UnsupportedBlockVersion\((\d+)\)|unsupported node version (\d+)/i,
    describe: (match) => {
      const spec = Number(match[1] ?? match[2]);
      const fromIndexer = match[2] !== undefined;
      const matrix = loadSupportMatrix().networks;
      const on = publicNetworks(matrix).filter((network) => matrix[network]?.runtimeSpec === spec);
      // A runtime no network runs any more, but older than all of theirs, is still in each chain's history: a tool
      // syncing from genesis reads those blocks, and the release each network runs today reads them too.
      const withSpec = publicNetworks(matrix).filter((network) => matrix[network]?.runtimeSpec !== undefined);
      const earlier = !on.length && withSpec.length > 0 && withSpec.every((network) => matrix[network]!.runtimeSpec! > spec);
      const component = fromIndexer ? "indexer" : "node and toolkit";
      const advice = upgradeAdvice(component, earlier ? withSpec : on, (network) => (fromIndexer ? matrix[network]?.indexer : (matrix[network]?.minNode ?? matrix[network]?.node)));
      const reader = fromIndexer ? "indexer" : "tool reading the chain";
      return {
        id: "unsupported-block-version",
        name: "UnsupportedBlockVersion",
        description: on.length
          ? `The ${reader} doesn't know runtime spec_version ${spec}, which ${runs(on)}. ${fromIndexer ? "An indexer" : "A node or toolkit"} built for an older runtime can't read its blocks.`
          : earlier
            ? `The ${reader} doesn't know runtime spec_version ${spec}, an earlier runtime than the ${[...new Set(withSpec.map((n) => matrix[n]!.runtimeSpec))].join(" or ")} ${runs(withSpec)} now. Its blocks are still in the chain's history, so ${fromIndexer ? "an indexer" : "a node or toolkit"} syncing from genesis reads them and needs a release that knows both.`
            : `The ${reader} doesn't know runtime spec_version ${spec}.`,
        fix: (earlier ? advice?.replaceAll(" on this runtime", " now") : advice) ?? "Upgrade the node, toolkit or indexer to a release that supports this runtime.",
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
    test: COMPACT_LEDGER_9,
    describe: (_match, network) => {
      const matrix = loadSupportMatrix().networks;
      const pin = (name: string) => {
        const version = compactRuntimePin(matrix[name]?.packages);
        return version ? ` to ${version}` : "";
      };
      const known = publicNetworks(matrix).filter((name) => ledgerMajor(matrix[name]?.ledger) !== undefined);
      const onNine = known.filter((name) => ledgerMajor(matrix[name]?.ledger)! >= 9);
      const onEight = known.filter((name) => !onNine.includes(name));
      const message = (description: string, fix: string): KnownMessage => ({
        id: "compact-ledger-9",
        name: "Contract built for Ledger 9",
        description: `This looks like output from Compact toolchain 0.35 or later, or Compact runtime 0.20 or later, which target Ledger 9. ${description}`,
        fix,
        next: [{ command: "midnight-cast versions <network>", reason: "Which ledger and versions the network runs" }],
      });
      if (network && ledgerMajor(matrix[network]?.ledger) !== undefined) {
        // These are the normal packages on a Ledger 9 network, so the real error is something else.
        // Whether the project's pins match the network is what versions --project-dir checks.
        if (ledgerMajor(matrix[network]?.ledger)! >= 9) return undefined;
        return message(
          `${title(network)} still runs Ledger 8 (ledger ${matrix[network]!.ledger}), so a contract built for Ledger 9 doesn't run there.`,
          `For ${title(network)}, run compact update 0.31 and pin the Compact runtime${pin(network)} from the support matrix, then rebuild.`,
        );
      }
      if (network) {
        return message(
          `The support matrix doesn't say which ledger ${title(network)} runs.`,
          `Check it with midnight-cast versions ${network} before changing the Compact toolchain: keep a Ledger 9 build for a network on Ledger 9, and run compact update 0.31 for one on Ledger 8.`,
        );
      }
      if (!onNine.length) {
        return message(
          `Ledger 9 isn't deployed on ${names(known.length ? known : PUBLIC_NETWORKS)}.`,
          "Run compact update 0.31 and pin the Compact runtime version from the support matrix, then rebuild.",
        );
      }
      if (!onEight.length) {
        return message(`${runs(onNine)} Ledger 9.`, "Keep this build, and pin the Compact runtime from the support matrix.");
      }
      return message(
        `${runs(onNine)} Ledger 9; ${names(onEight)} still ${onEight.length > 1 ? "run" : "runs"} Ledger 8.`,
        `On ${names(onNine)}, keep this build and pin the Compact runtime from the support matrix; if it still fails there, the ledger it targets isn't the cause. On ${names(onEight)}, run compact update 0.31 and pin its Compact runtime instead, then rebuild. Pass --network for advice about one network.`,
      );
    },
  },
];

export function matchKnownMessages(raw: string, network?: string): KnownMessage[] {
  return PATTERNS.flatMap((pattern) => {
    const match = raw.match(pattern.test);
    const message = match ? pattern.describe(match, network) : undefined;
    return message ? [message] : [];
  });
}

/** Why text that only names Ledger 9 packages isn't an error on a network that runs Ledger 9. */
export function normalOnNetwork(raw: string, network?: string): string | undefined {
  if (!network || !COMPACT_LEDGER_9.test(raw)) return undefined;
  const ledger = loadSupportMatrix().networks[network]?.ledger;
  const major = ledgerMajor(ledger);
  if (major === undefined || major < 9) return undefined;
  return (
    `This names Ledger 9 packages or Compact output, which are normal on ${title(network)}: it runs Ledger 9 (ledger ${ledger}). ` +
    `Paste the error message itself, or run midnight-cast versions ${network} --project-dir <project> to check the project's pins.`
  );
}
