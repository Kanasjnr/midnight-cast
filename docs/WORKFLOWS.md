# Developer workflows

How to use `mn` in real debugging sessions.

## The debug ladder

Run commands in this order when something breaks:

```
0. mn health        →  Ping + tip + versions in one command (optional shortcut)
1. mn ping          →  Are RPC and indexer up?
2. mn tip           →  Is the indexer caught up?
3. mn versions      →  Is the live stack aligned with the support matrix?
4. mn decode …      →  What does the error code mean?
5. mn tx <hash>     →  What happened to this transaction?
6. mn dust-event(s) →  Ledger event / sync detail
```

Skip step 3 (or `health`’s versions section) and you will waste time on proof regeneration when the real issue is preview vs preprod or indexer lag.

---

## New teammate (5 minutes)

```bash
npm i -g midnight-cast

mn config init
mn health preprod
mn decode 170
mn decode 1010
```

You should see RPC/indexer OK, small tip delta, versions checks passing, and decode output for Custom 170.

Or run the ladder manually: `mn ping`, `mn tip`, `mn versions`.

---

## Start of day

Before writing repro scripts or opening Discord:

```bash
mn health preprod
```

Or:

```bash
mn ping preprod
mn tip preprod
mn versions preprod
```

| Result | Action |
|--------|--------|
| `health` / `ping` FAIL on RPC or indexer | Fix connectivity first |
| `proof-server` FAIL or version mismatch | Check local proof server / SDK pin vs matrix; mainnet URL may not exist yet |
| `\|tip delta\|` ≥ threshold | Wait for indexer sync; don’t debug submissions yet |
| `versions` MISMATCH | Check [support matrix](https://docs.midnight.network/relnotes/support-matrix) and your local deps |
| **Network warning** on `versions` or `tx` | Endpoints may target wrong network — fix `--network` or RPC URL |

**CI example:**

```bash
mn health preprod --fail-on-lag --fail-on-mismatch
# or separately:
mn tip preprod --fail-on-lag --threshold 500
mn versions preprod --fail-on-mismatch
```

---

## “My tx failed with Custom 170”

Custom 170 = DUST spend proof failed at the ledger.

```bash
mn decode 170
mn tip preprod
mn versions preprod
```

If tip shows lag or versions mismatch, fix environment before regenerating proofs.

If stack looks healthy:

```bash
mn tx <your-tx-hash> --network preprod
```

Check segment failures and DUST events on that transaction. Human output links `mn dust-event <id>` for each DUST event. If a segment shows `fail`, the indexer does not include the reason — use `mn decode --raw` with the error from your wallet or node logs.

---

## “Error 1010: Invalid Transaction”

1010 is a **Substrate envelope**, not the Midnight-specific code.

**Fast path** — paste the full error:

```bash
mn decode --raw "1010: Invalid Transaction: Custom error: 186"
```

**Manual path:**

```bash
mn decode 1010
mn decode N          # after you find Custom error: N
mn decode pallet <index> <error>   # if DispatchError::Module
```

If there is **no** inner `Custom(N)`, the rejection was upstream (nonce, fee, mortality, size) — not ledger logic.

---

## Custom 179 / 180 / 181 (proof / transcript version)

Almost always version skew between proof server, ledger, and SDK:

```bash
mn decode 179
mn decode 180
mn decode 181
mn versions preprod
```

Each of 179–181 shows related transcript/proof codes in the decode hint. Use `--network preview` or `--network preprod` so the ledger map matches your environment.

From your dApp directory (reads `package.json` and compares to matrix **package pins**):

```bash
cd my-midnight-app
mn versions preprod
```

Look for **Local package checks** — `ledger-v8`, `compact-runtime`, `onchain-runtime-v3`, `midnight-js-indexer` vs matrix.

**Proof server:** `mn ping` and `mn versions` read `GET https://proof-server.<network>.midnight.network/version` when configured. Mismatch on 179–181 often means proof server or ledger skew, not just npm deps.

---

## Indexer lag / “tx not found”

```bash
mn tip preprod --json
mn ping preprod
```

If RPC height >> indexer height, the indexer has not indexed your tx yet. Wait and re-run `mn tx`.

---

## DUST / sync debugging

Indexer v4 exposes DUST events via **WebSocket subscription only**.

**Find valid event ids:**

```bash
mn dust-events --network preprod --from 565900 --limit 10
```

**Inspect one event:**

```bash
mn dust-event 565975 --network preprod
```

**Known good preprod example:** event `565975` (if still in retention).

**Preview note:** event ids differ per network. If `dust-event 12345` fails, the CLI suggests browsing with `dust-events --from` — use that to discover valid ids.

**From a transaction:** `mn tx <hash>` lists DUST event ids and prints `mn dust-event <id>` hints for each.

**Fields to watch:**

- `typename` — event type (`DustSpendProcessed`, etc.)
- `protocolVersion` — mismatch hints at ledger/indexer skew
- `raw` — hex prefix (use `--verbose` for full payload; not deserialized in CLI)

Static background:

```bash
mn explain dust
```

---

## Block at height

When you know the block number (from `mn tx` or an explorer) but want RPC header fields:

```bash
mn block 909000 preprod
mn block latest preprod
```

`latest` and `<height>` both return `hash`, `parentHash`, `stateRoot`, and `extrinsicsRoot`.

---

## Raw node introspection

When you need something `mn` does not wrap yet:

```bash
mn rpc chain_getHeader
mn rpc chain_getRuntimeVersion --json
mn rpc system_version
mn rpc rpc_methods
```

Use `--network` to target preview / preprod / mainnet.

---

## Switching networks

```bash
mn tip preview
mn tip preprod
mn tip mainnet
```

Or set once:

```bash
export MN_NETWORK=preprod
mn tip
mn versions
```

Config default:

```bash
mn config init -y --network preprod
```

---

## Cast ↔ mn (mental model)

| You want… | Command |
|-----------|---------|
| Full stack check | `mn health` |
| Is the node up? | `mn ping` |
| Latest block | `mn block latest` |
| Block at height | `mn block <height>` |
| Raw RPC | `mn rpc` |
| What does error N mean? | `mn decode` |
| What happened to my tx? | `mn tx` |
| Event stream debug | `mn dust-events` |
| Version alignment | `mn versions` |
| Send a transaction | **Not mn** — use wallet / Lace / testkit |

---

## What mn is not

- Not a wallet (no keys, no signing, no proving)
- Not a replacement for `testkit-js` or Compact tooling
- Not a standalone indexer deployment tool

---

## Getting help

### midnight-cast (`mn`)

| Need | Where |
|------|--------|
| Bug or CLI not working | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |
| Feature / new command proposal | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |

### Midnight protocol, errors, and network

| Need | Where |
|------|--------|
| Errors not in `mn decode`, network outages, SDK questions | [Midnight Discord](https://discord.gg/Ap2QZ7yq) |
| Official reference | [Midnight docs](https://docs.midnight.network/) |
| Version pins | [Support matrix](https://docs.midnight.network/relnotes/support-matrix) |

**Before Discord:** run `mn health` (or the debug ladder) and paste output — same signals core devs use in threads.

### Docs

- [Command reference](./COMMANDS.md)
