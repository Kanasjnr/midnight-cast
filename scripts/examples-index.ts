// Writes src/data/examples-index.json: which of Midnight's official examples shows which
// pattern, with the files, line ranges and short excerpts that show it, all at one pinned
// commit of midnightntwrk/midnight-examples so the links never move under a reader.
//
//   tsx scripts/examples-index.ts [--check]
//
// The topics and code locations are chosen by hand below; the script finds each location by
// its symbol at the pinned commit and fills in the lines, link and excerpt. --check exits 1 if
// the committed index differs from what the pinned commit renders, and notes when the
// repository's main branch has moved past the pin, so the pin gets reviewed. To move the pin,
// change COMMIT, run the script, and review the diff.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExampleFile, ExamplesIndex } from "../src/lib/examples-index.js";
import { fetchGitHub, notice } from "./github.js";

const REPO = "midnightntwrk/midnight-examples";
export const COMMIT = "95d4f5006f042db08cef301df68ca260a9e6be7b";
const MAX_EXCERPT_LINES = 24;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "src", "data", "examples-index.json");

interface Source {
  name: string;
  summary: string;
  topics: string[];
  files: Array<{ path: string; symbol: string; about: string }>;
}

// What each example demonstrates, and where. Paths are relative to the example's directory.
const EXAMPLES: Source[] = [
  {
    name: "hello-world",
    summary: "The smallest working DApp: a contract that stores a message, its tests against a local network, and a browser UI",
    topics: ["getting started", "first contract", "deploy a contract", "store state", "providers", "network config", "wallet sync", "wallet errors"],
    files: [
      { path: "contract/hello-world.compact", symbol: "export circuit storeMessage", about: "A circuit that writes a public ledger value" },
      { path: "src/test/hw.test.ts", symbol: "it('Deploys the contract'", about: "Deploying a contract with deployContract" },
      { path: "src/providers.ts", symbol: "export function buildProviders", about: "Wiring up the midnight-js providers a contract needs" },
      { path: "src/config.ts", symbol: "export function getConfig", about: "Choosing the network's endpoints (local, preview, preprod)" },
      { path: "src/wallet.ts", symbol: "export async function syncWallet", about: "Syncing a wallet and reporting its progress" },
      { path: "ui/src/lib/errors.ts", symbol: "function withHint", about: "Explaining a wallet's InsufficientFunds error (no DUST for fees) to a user" },
    ],
  },
  {
    name: "calculator",
    summary: "A public ledger value, arithmetic circuits, and a witness that computes off-chain what the circuit only checks",
    topics: ["witness", "arithmetic", "division", "public ledger", "uint", "off-chain computation"],
    files: [
      { path: "contract/calculator.compact", symbol: "witness divMod", about: "A witness declared in Compact, computed in TypeScript" },
      { path: "contract/calculator.compact", symbol: "export circuit divide", about: "Checking a witness's answer inside the circuit" },
    ],
  },
  {
    name: "private-party",
    summary: "Private on-chain data, access control, and DUST sponsorship: one wallet pays the fees for another's transaction",
    topics: ["dust sponsorship", "sponsor fees", "pay fees for another user", "access control", "commitment", "hashed set membership", "private guest list"],
    files: [
      { path: "src/sponsor.ts", symbol: "export async function sponsorAndSubmit", about: "Having a sponsor wallet pay the DUST fee and submit" },
      { path: "src/sponsor.ts", symbol: "export async function prepareSponsoredCall", about: "Building a call that another wallet will pay for" },
      { path: "contract/private-party.compact", symbol: "export circuit rsvp", about: "Adding a member to a hashed set without revealing them" },
      { path: "contract/private-party.compact", symbol: "export circuit checkIn", about: "Proving membership of the hashed set" },
      { path: "contract/private-party.compact", symbol: "circuit commitAddress", about: "Committing to an address with a secret" },
    ],
  },
  {
    name: "token-transfers",
    summary: "Minting, sending and receiving unshielded tokens, NIGHT and shielded tokens from a contract",
    topics: ["mint token", "unshielded token", "send tokens", "receive tokens", "night", "shielded transfer", "shielded mint", "send to user"],
    files: [
      { path: "contract/token-transfers.compact", symbol: "export circuit mintAndReceive", about: "Minting an unshielded token to the contract" },
      { path: "contract/token-transfers.compact", symbol: "export circuit sendToUser", about: "Sending unshielded tokens to a user" },
      { path: "contract/token-transfers.compact", symbol: "export circuit receiveNightTokens", about: "Receiving NIGHT into a contract" },
      { path: "contract/token-transfers.compact", symbol: "export circuit sendNightTokensToUser", about: "Sending NIGHT from a contract to a user" },
      { path: "contract/token-transfers.compact", symbol: "export circuit receiveShieldedTokens", about: "Receiving a shielded coin into a contract, which claims it" },
      { path: "contract/token-transfers.compact", symbol: "export circuit sendShieldedToUser", about: "Sending shielded tokens to a user" },
      { path: "contract/token-transfers.compact", symbol: "export circuit mintAndSendShielded", about: "Minting a shielded token and sending it in one call" },
    ],
  },
  {
    name: "silent-auction",
    summary: "A sealed reserve price with commit-reveal, and an NFT auction run as a state machine",
    topics: ["commit-reveal", "sealed bid", "auction", "salt", "state machine", "nft", "reserve price"],
    files: [
      { path: "contract/silent-auction.compact", symbol: "circuit commitPrice", about: "Committing to a value with a salt" },
      { path: "contract/silent-auction.compact", symbol: "export circuit revealWin", about: "Revealing the committed value and checking it" },
      { path: "contract/silent-auction.compact", symbol: "export circuit bid", about: "Accepting bids while the auction is open" },
    ],
  },
  {
    name: "election",
    summary: "A vote with registration, votes committed in secret and revealed later, and counting",
    topics: ["voting", "election", "commit-reveal", "register voters", "counter", "secret ballot"],
    files: [
      { path: "contract/election.compact", symbol: "export circuit commitVote", about: "Committing to a vote without revealing it" },
      { path: "contract/election.compact", symbol: "export circuit revealVote", about: "Revealing a committed vote and counting it" },
      { path: "contract/election.compact", symbol: "circuit commitWithSk", about: "A commitment keyed by the voter's secret" },
    ],
  },
  {
    name: "secret-message",
    summary: "Publishing a hash commitment of a private message instead of the message itself",
    topics: ["hash commitment", "persistent hash", "domain separator", "private message", "ownership", "public key from secret"],
    files: [
      { path: "contract/secret-message.compact", symbol: "export circuit hashMessageWithSeparator", about: "Hashing with a domain separator" },
      { path: "contract/secret-message.compact", symbol: "export circuit publishMessageHashWithOwner", about: "Publishing a hash and recording its owner" },
      { path: "contract/secret-message.compact", symbol: "export circuit getDappPubKey", about: "Deriving a public key from a secret inside a circuit" },
    ],
  },
  {
    name: "zk-loan",
    summary: "Private credit scoring: verifying a signed attestation inside a circuit and disclosing only the outcome",
    topics: ["signature verification", "verify a signature in a circuit", "schnorr", "attestation", "credit score", "jubjub", "selective disclosure", "admin role"],
    files: [
      { path: "contract/schnorr.compact", symbol: "export circuit schnorrVerify", about: "Verifying a Schnorr signature in a circuit" },
      { path: "contract/zk-loan.compact", symbol: "circuit evaluateApplicant", about: "Checking an attested score and disclosing only the decision" },
      { path: "contract/zk-loan.compact", symbol: "export circuit requestLoan", about: "The entry point that uses the attestation" },
      { path: "contract/zk-loan.compact", symbol: "export circuit rotateAdmin", about: "Rotating an admin key" },
    ],
  },
  {
    name: "shielded-chips",
    summary: "Shielded tokens: MIP-0011 chips, and a roulette contract that holds and pays out coins privately",
    topics: ["shielded token", "mint shielded", "burn", "treasury", "escrow", "contract-held coins", "mip-0011", "payout"],
    files: [
      { path: "contract/chips.compact", symbol: "export circuit mint", about: "Minting a shielded token" },
      { path: "contract/chips.compact", symbol: "export circuit burn", about: "Burning a shielded token" },
      { path: "contract/chips.compact", symbol: "export circuit mintToTreasury", about: "Minting into a contract-held treasury" },
      { path: "contract/roulette.compact", symbol: "export circuit betColor", about: "Taking a shielded coin into escrow" },
      { path: "contract/roulette.compact", symbol: "export circuit claimWinnings", about: "Paying out shielded coins from the contract" },
    ],
  },
  {
    name: "private-bid",
    summary: "Proving a bid is at least a public minimum, storing only a commitment, and revealing it later",
    topics: ["range proof", "prove greater than", "commitment", "private bid", "reveal", "minimum"],
    files: [
      { path: "contract/private-bid.compact", symbol: "export circuit placeBid", about: "Proving a hidden amount clears a public minimum" },
      { path: "contract/private-bid.compact", symbol: "export circuit revealBid", about: "Revealing the committed amount" },
      { path: "contract/private-bid.compact", symbol: "circuit derive", about: "Deriving per-purpose keys from one secret" },
    ],
  },
  {
    name: "battleship",
    summary: "A two-player game as a contract state machine, with roles and private state",
    topics: ["state machine", "game", "private state", "role-based access", "turn-based", "two players"],
    files: [
      { path: "contract/battleship.compact", symbol: "export circuit acceptGame", about: "Joining as the second player" },
      { path: "contract/battleship.compact", symbol: "export circuit player1Shoot", about: "A turn, guarded by role and game state" },
      { path: "contract/battleship.compact", symbol: "export circuit checkBoard1", about: "Answering against private state held in a witness" },
      { path: "contract/battleship.compact", symbol: "circuit commitBoardSpace", about: "Committing to hidden board positions" },
    ],
  },
  {
    name: "private-tip-jar",
    summary: "An anonymous tip jar: anyone drops a shielded coin into a contract-held pot without saying who they are, and only the owner can withdraw",
    topics: ["anonymous tip", "anonymous payment", "donation", "contract-held pot", "re-nonce a coin", "owner-only withdrawal", "secret key witness"],
    files: [
      { path: "contract/private-tip-jar.compact", symbol: "export circuit tip", about: "Taking a tipper's shielded coin without their identity" },
      { path: "contract/private-tip-jar.compact", symbol: "circuit reNonceToSelf", about: "Re-sending a coin to the contract so its nonce doesn't point back at the tipper" },
      { path: "contract/private-tip-jar.compact", symbol: "export circuit withdraw", about: "Paying a pot coin to the owner, checked against a hash of their secret key" },
      { path: "contract/private-tip-jar.compact", symbol: "export pure circuit ownerKey", about: "Deriving the owner's key from the secret a witness supplies" },
      { path: "contract/witnesses.ts", symbol: "export const witnesses", about: "The witness that supplies the owner's secret key" },
      { path: "contract/tip-token.compact", symbol: "export circuit mint", about: "Minting a demo shielded token to tip with on a fresh devnet" },
    ],
  },
];

const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`;

/**
 * The lines of the declaration that starts with `symbol`: through the brace that closes its body,
 * or to its `;` for a one-line declaration. Strings and comments are skipped. The body is the
 * first `{` outside the parameter list and type arguments, so an object type in a signature or
 * a return type doesn't end it early; for a call such as `it('…', () => {`, it's the first `{`.
 */
export function locate(source: string, symbol: string): [number, number] {
  const lines = source.split("\n");
  const boundary = !/[A-Za-z0-9_$]$/.test(symbol);
  const start = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(symbol) && (boundary || /[\s(<]/.test(trimmed.charAt(symbol.length) || " "));
  });
  if (start === -1) throw new Error(`"${symbol}" not found`);
  const call = /^[\w.]+\(/.test(symbol);
  let paren = 0;
  let angle = 0;
  let depth = 0;
  let body = false;
  let quote: string | null = null;
  let comment = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]!;
      if (comment) {
        if (ch === "*" && line[j + 1] === "/") (comment = false), j++;
        continue;
      }
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && line[j + 1] === "/") break;
      if (ch === "/" && line[j + 1] === "*") {
        comment = true;
        j++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }
      if (!body) {
        if (ch === "(") paren++;
        else if (ch === ")") paren--;
        else if (ch === "<") angle++;
        else if (ch === ">" && line[j - 1] !== "=") angle = Math.max(0, angle - 1);
        else if (ch === "{" && (call || (paren === 0 && angle === 0))) (body = true), (depth = 1);
        else if (ch === ";" && paren === 0) return [start + 1, i + 1];
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return [start + 1, i + 1];
    }
    // Only template literals span lines.
    if (quote && quote !== "`") quote = null;
  }
  throw new Error(`"${symbol}" has no end`);
}

function excerpt(source: string, [start, end]: [number, number]): string {
  const lines = source.split("\n").slice(start - 1, end);
  return lines.length <= MAX_EXCERPT_LINES ? lines.join("\n") : [...lines.slice(0, MAX_EXCERPT_LINES), "  // …"].join("\n");
}

/** The pinned toolchain table in the repository's README: component → version. */
export function readToolchain(readme: string): Record<string, string> {
  const at = readme.indexOf("## Pinned toolchain");
  if (at === -1) throw new Error("the README has no \"## Pinned toolchain\" section");
  const rest = readme.slice(at + 3);
  const next = rest.search(/^## /m);
  const section = next === -1 ? rest : rest.slice(0, next);
  return Object.fromEntries(
    [...section.matchAll(/^\| ([^|]+?) \| `([^`]+)`[^|]*\|$/gm)].map((m) => [m[1]!.replace(/`/g, "").trim(), m[2]!]),
  );
}

export async function buildIndex(): Promise<ExamplesIndex> {
  const readme = await fetchGitHub(raw("README.md"));
  const sources = new Map<string, string>();
  const examples = [];
  for (const example of EXAMPLES) {
    const files: ExampleFile[] = [];
    for (const file of example.files) {
      const path = `examples/${example.name}/${file.path}`;
      if (!sources.has(path)) sources.set(path, await fetchGitHub(raw(path)));
      const source = sources.get(path)!;
      let lines: [number, number];
      try {
        lines = locate(source, file.symbol);
      } catch (err) {
        throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      files.push({
        path,
        symbol: file.symbol,
        about: file.about,
        lines,
        url: `https://github.com/${REPO}/blob/${COMMIT}/${path}#L${lines[0]}-L${lines[1]}`,
        excerpt: excerpt(source, lines),
      });
    }
    examples.push({
      name: example.name,
      path: `examples/${example.name}`,
      summary: example.summary,
      topics: example.topics,
      url: `https://github.com/${REPO}/tree/${COMMIT}/examples/${example.name}`,
      files,
    });
  }
  return { repo: REPO, commit: COMMIT, toolchain: readToolchain(readme), examples };
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  let index: ExamplesIndex;
  try {
    index = await buildIndex();
  } catch (err) {
    console.error(`Couldn't build the examples index: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const rendered = `${JSON.stringify(index, null, 2)}\n`;
  if (!check) {
    writeFileSync(indexPath, rendered);
    console.log(`wrote src/data/examples-index.json (${index.examples.length} examples at ${COMMIT.slice(0, 7)})`);
    return 0;
  }
  const committed = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n");
  if (committed !== rendered) {
    console.log("src/data/examples-index.json differs from what the pinned commit renders. Run npm run examples-index.");
    return 1;
  }
  console.log(`The examples index matches ${REPO}@${COMMIT.slice(0, 7)}.`);
  try {
    const head = (JSON.parse(await fetchGitHub(`https://api.github.com/repos/${REPO}/commits/main`)) as { sha: string }).sha;
    if (head !== COMMIT) {
      const toolchain = readToolchain(await fetchGitHub(`https://raw.githubusercontent.com/${REPO}/${head}/README.md`));
      const keys = [...new Set([...Object.keys(index.toolchain), ...Object.keys(toolchain)])];
      const changed = keys
        .filter((k) => index.toolchain[k] !== toolchain[k])
        .map((k) => `${k} ${index.toolchain[k] ?? "—"} → ${toolchain[k] ?? "removed"}`);
      notice(
        "midnight-examples moved on",
        `${REPO} main is at ${head.slice(0, 7)}, past the pinned ${COMMIT.slice(0, 7)}.` +
          (changed.length ? ` Its pinned toolchain changed: ${changed.join(", ")}.` : " Its pinned toolchain is unchanged.") +
          " Review it, and move COMMIT in scripts/examples-index.ts when it's worth following.",
      );
    }
  } catch (err) {
    notice("midnight-examples not compared", `couldn't compare the pin with ${REPO} main: ${err instanceof Error ? err.message : String(err)}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    },
  );
}
