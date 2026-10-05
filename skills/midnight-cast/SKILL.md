---
name: midnight-cast
description: Diagnose Midnight blockchain problems with the read-only midnight-cast CLI. Decodes Midnight errors (1010 rejections, Custom(N) ledger codes, pallet and JSON-RPC errors, toolkit and Blockfrost messages), checks network health and versions on preview, preprod and mainnet, and looks up transactions, contracts, DUST registration and DUST events. Use when a Midnight error, transaction, contract or network is involved.
license: Apache-2.0
compatibility: Needs Node.js 20 or later and network access; mainnet needs a Blockfrost project ID.
---

# midnight-cast

midnight-cast is a read-only CLI for the Midnight networks (preview, preprod, mainnet, local). It needs no wallet or keys, so its commands are safe to run without asking. Use it instead of guessing when a Midnight error, transaction, contract or network is involved. It needs midnight-cast 0.2.0 or later (`npx -y midnight-cast@latest`).

**Always add `--json`.** Every command then prints one envelope: `ok`, `data`, `error` (`message`, `kind`, `hint`), `warnings` and `next`. Read `error.hint` before deciding what's wrong, and follow `next`: each step is a command an expert would run next. Exit codes are 0 for success, 1 for a failed check or request, and 2 for a usage error.

**Debug ladder**

1. The user has an error message: `midnight-cast decode --raw "<the whole message>" --json`, with `--network <network>` if known. It recognises 1010 rejections, `Custom(N)` ledger codes, pallet errors, JSON-RPC codes and messages from current tooling (old toolkit versions, Blockfrost tokens, Compact builds for ledger 9). Decode before explaining an error; don't rely on memory.
2. The network might be the problem rather than the code: `midnight-cast health <network> --json`, then `ping` or `tip` to narrow it down. Its `data.examples` says whether Midnight's own examples pass on the node that network runs; if they pass and the network is healthy, look at the user's code or setup first.
3. Versions might not match: `midnight-cast versions <network> --project-dir <project> --json` compares the live network and the project's Midnight packages with the support matrix.
4. Something happened on chain: `tx <hash>` for a transaction, `contract <address>` for a deployed contract (latest action, circuit, deploy block), `dust-status <cardano-reward-address>` when a wallet has no DUST, `dust-event <id>` and `dust-events` for DUST ledger events.
5. Background on a topic: `midnight-cast explain dust|1010|versions|transcript`. `midnight-cast explain --json` lists every command, option, exit code and error kind.

Mainnet goes through Blockfrost: set `BLOCKFROST_PROJECT_ID` to a Midnight Mainnet project ID. midnight-cast never prints it.
