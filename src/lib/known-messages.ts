import type { NextStep } from "../output.js";

export interface KnownMessage {
  id: string;
  name: string;
  description: string;
  fix: string;
  next: NextStep[];
}

interface Pattern {
  test: RegExp;
  describe: (match: RegExpMatchArray) => KnownMessage;
}

const CURRENT_SPEC_VERSION = 1_000_300;

const PATTERNS: Pattern[] = [
  {
    test: /UnsupportedBlockVersion\((\d+)\)|unsupported node version (\d+)/,
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
            ? "Upgrade the node and toolkit to 1.0.300 or newer."
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
      fix: "Set BLOCKFROST_PROJECT_ID, pass --project-id, or add blockfrost_project_id to the network's config section.",
      next: [{ command: "midnight-cast config show --network mainnet", reason: "See whether a project ID is configured and where it comes from" }],
    }),
  },
  {
    test: /Invalid project token/i,
    describe: () => ({
      id: "blockfrost-invalid-token",
      name: "Blockfrost: invalid project token",
      description: "Blockfrost rejected the project ID: it is wrong, revoked, or for a different network.",
      fix: 'Mainnet needs a Midnight Mainnet project ID, which starts with "nightmainnet". Copy it again from the Blockfrost dashboard.',
      next: [{ command: "midnight-cast config show --network mainnet", reason: "See which project ID is used and where it comes from" }],
    }),
  },
  {
    test: /\b(?:rpc|indexer)\.mainnet\.midnight\.network\b/i,
    describe: () => ({
      id: "retired-mainnet-host",
      name: "Retired mainnet endpoint",
      description:
        "rpc.mainnet.midnight.network and indexer.mainnet.midnight.network were retired on 2026-09-30 and can stop answering at any time. Mainnet RPC and indexer are now served by Blockfrost.",
      fix: "Point the app and tools at Blockfrost's mainnet endpoints with a Midnight Mainnet project ID.",
      next: [{ command: "midnight-cast config init --network mainnet", reason: "Write a config with the Blockfrost mainnet endpoints" }],
    }),
  },
  {
    test: /--feature-zkir-v3|\bZKIR 3\.1\b|ContractModuleProvider|ModuleThunk|declaredInterfaces|circuitSignatures|\bledger-v9\b|compact-runtime@?\s*\^?0\.20\./i,
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
