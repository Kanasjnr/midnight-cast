# Developer workflows

Use midnight-cast in real debugging sessions, with sample output you can compare against.

## The debug ladder

Run these in order when something breaks:

```
0. midnight-cast health        →  Ping + tip + versions in one command (optional shortcut)
1. midnight-cast ping          →  Are RPC and indexer up?
2. midnight-cast tip           →  Is the indexer caught up?
3. midnight-cast versions      →  Is the live stack aligned with the support matrix?
4. midnight-cast decode …      →  What does the error code mean?
5. midnight-cast tx <hash>     →  What happened to this transaction?
6. midnight-cast dust-event(s) →  Ledger event / sync detail
```

Skip step 3 (or the versions section in `health`) and you may end up debugging proofs when the real issue is network skew or indexer lag.

---

## New teammate (5 minutes)

```bash
npm i -g midnight-cast

midnight-cast config init
midnight-cast health preprod
midnight-cast decode 170
midnight-cast decode 1010
```

You should see RPC/indexer OK, a small tip delta, passing version checks, and a decode result for Custom 170.

Or run the ladder manually: `midnight-cast ping`, `midnight-cast tip`, `midnight-cast versions`.

---

## Start of day

Before writing repro scripts or opening Discord:

```bash
midnight-cast health preprod
```

Example output:

```text
Network: preprod
Healthy: yes

Services:
  rpc: OK (668ms)
  indexer: OK (1215ms)
  proof-server: OK (1053ms) (optional) — version=8.1.0 (matches matrix 8.1.0)

Sync:
  RPC height:      2805470
  Indexer height:  2805468
  Delta:           2 (threshold 100)
  In sync:         yes
```

Or:

```bash
midnight-cast ping preprod
midnight-cast tip preprod
midnight-cast versions preprod
```

| Result | Action |
|--------|--------|
| `health` / `ping` FAIL on RPC or indexer | Fix connectivity first |
| `proof-server` FAIL or version mismatch | Check local proof server / SDK pin vs matrix; on mainnet the proof server always runs locally |
| `\|tip delta\|` ≥ threshold | Wait for indexer sync; don’t debug submissions yet |
| `versions` MISMATCH | Check [support matrix](https://docs.midnight.network/relnotes/support-matrix) and your local deps |
| **Network warning** on `versions` or `tx` | Endpoints may target wrong network — fix `--network` or RPC URL |

**CI example:**

```bash
midnight-cast health preprod --fail-on-lag --fail-on-mismatch
# or separately:
midnight-cast tip preprod --fail-on-lag --threshold 500
midnight-cast versions preprod --fail-on-mismatch
```

---

## “My tx failed with Custom 170”

Custom 170 = DUST spend proof failed at the ledger.

```bash
midnight-cast decode 170
midnight-cast tip preprod
midnight-cast versions preprod
```

If `tip` shows lag or `versions` shows mismatch, fix the environment before regenerating proofs.

If stack looks healthy:

```bash
midnight-cast tx <your-tx-hash> --network preprod
```

Example output:

```text
Type:     RegularTransaction
ID:       232830
Hash:     e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c
Block:    909000 (428660a6154a27cee57af3527cb3370ad3bbce94f461f433533b1413e24b71f4)
Protocol: 22000
Status:   PARTIAL_SUCCESS
Fees:     paid=1 estimated=1
Segments: 0:ok, 20003:ok, 35012:fail
Failure:  indexer v4 exposes segment success only (no failure reason)
Hint:     paste wallet/node error → midnight-cast decode --raw "<error>"
Actions:  ContractCall
DUST:     665110:DustSpendProcessed
          → midnight-cast dust-event 665110
```

Check segment failures and DUST events on the transaction. Human output links `midnight-cast dust-event <id>` for each DUST event. If a segment shows `fail`, the indexer does not include the reason, so use `midnight-cast decode --raw` with the wallet or node error.

---

## “Error 1010: Invalid Transaction”

1010 is a **Substrate envelope**, not the Midnight-specific code.

**Fast path** — paste the full error:

```bash
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186"
```

Example output:

```text
Parsed: 1010: Invalid Transaction: Custom error: 186

Kind:  substrate (1010 InvalidTransaction)
Desc:  Substrate transaction pool rejected the extrinsic. This is an envelope code, not a Midnight ledger code.

Next steps:
  1. Find Custom error: N in the error message (u8, 0–255).
  2. Run: midnight-cast decode ledger N   (or: midnight-cast decode N)
  3. If DispatchError::Module { index, error }, run: midnight-cast decode pallet <index> <error>
  4. If there is no inner Custom(N), rejection was upstream Substrate validation (nonce, fee, size, etc.).
```

**Manual path:**

```bash
midnight-cast decode 1010
midnight-cast decode N          # after you find Custom error: N
midnight-cast decode pallet <index> <error>   # if DispatchError::Module
```

If there is **no** inner `Custom(N)`, the rejection was upstream (nonce, fee, mortality, size) — not ledger logic.

---

## Custom 179 / 180 / 181 (proof / transcript version)

This is almost always version skew between proof server, ledger, and SDK:

```bash
midnight-cast decode 179
midnight-cast decode 180
midnight-cast decode 181
midnight-cast versions preprod
```

Each of 179–181 shows related transcript/proof codes in the decode hint. Use `--network preview` or `--network preprod` so the ledger map matches the target environment.

From your dApp directory (reads `package.json` and compares to matrix **package pins**):

```bash
cd my-midnight-app
midnight-cast versions preprod
```

Look for **Local package checks** — `ledger-v8`, `compact-runtime`, `onchain-runtime-v3`, `midnight-js-indexer-public-data-provider` vs matrix.

Example output:

```text
Checks:
  node: expected=>=1.0.300 live=1.0.400 → OK (recommended 1.0.300)
  runtimeSpec: expected=1000300 live=1000300 → OK (node runtime spec_version vs matrix)
  indexer-api: expected=v4 live=v4 → OK (from configured indexer URL path)
  protocolVersion: expected=1000300 live=1000300 → OK (RPC specVersion vs indexer latest block)
  proof-server: expected=8.1.0 live=8.1.0 → OK (GET /version on configured proof server URL)

Summary: live stack matches matrix checks ✓
```

**Proof server:** `midnight-cast ping` and `midnight-cast versions` read `GET https://proof-server.<network>.midnight.network/version` when configured. Mismatch on 179–181 often means proof server or ledger skew, not just npm deps.

---

## Indexer lag / “tx not found”

```bash
midnight-cast tip preprod --json
midnight-cast ping preprod
```

If RPC height is far ahead of indexer height, the indexer has not reached your tx yet. Wait and re-run `midnight-cast tx`.

---

## DUST / sync debugging

Indexer v4 exposes DUST events via **WebSocket subscription only**.

**Find valid event ids:**

```bash
midnight-cast dust-events --network preprod --from 565900 --limit 10
```

Example output:

```text
id=565900  typename=DustGenerationDtimeUpdate  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565901  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565902  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
```

**Inspect one event:**

```bash
midnight-cast dust-event 565975 --network preprod
```

**Known good preprod example:** event `565975` (if still in retention).

**Preview note:** event ids differ per network. If `dust-event 12345` fails, the CLI suggests browsing with `dust-events --from` — use that to discover valid ids.

**From a transaction:** `midnight-cast tx <hash>` lists DUST event ids and prints `midnight-cast dust-event <id>` hints for each.

**Fields to watch:**

- `typename` — event type (`DustSpendProcessed`, etc.)
- `protocolVersion` — mismatch hints at ledger/indexer skew
- `raw` — hex prefix (use `--verbose` for full payload; not deserialized in CLI)

Static background:

```bash
midnight-cast explain dust
```

---

## Block at height

When you know the block number (from `midnight-cast tx` or an explorer) and want the RPC header fields:

```bash
midnight-cast block 909000 preprod
midnight-cast block latest preprod
```

`latest` and `<height>` both return `hash`, `parentHash`, `stateRoot`, and `extrinsicsRoot`.

Example output:

```text
network: preprod
height: 909000
hash: 0x428660a6154a27cee57af3527cb3370ad3bbce94f461f433533b1413e24b71f4
parentHash: 0x0f3ea13ff874e823035aa0a27d94c6c79776a4076607c17079fec6519d7aa17a
stateRoot: 0x0d3efc9ac7f5a310e83bc1b83c3d283df4f8bbe8ba5bb6faff668bbd26a581f9
extrinsicsRoot: 0x3a61ec7982b80286f7908e90b481548e9f07240f80fb2dbd9f02205b05f49399
```

---

## Raw node introspection

When you need something midnight-cast does not wrap yet:

```bash
midnight-cast rpc chain_getHeader
midnight-cast rpc chain_getRuntimeVersion --json
midnight-cast rpc system_version
midnight-cast rpc rpc_methods
```

Use `--network` to target preview / preprod / mainnet.

---

## Switching networks

```bash
midnight-cast tip preview
midnight-cast tip preprod
midnight-cast tip mainnet   # needs BLOCKFROST_PROJECT_ID
```

Or set once:

```bash
export MN_NETWORK=preprod
midnight-cast tip
midnight-cast versions
```

Config default:

```bash
midnight-cast config init -y --network preprod
```

---

## Cast ↔ midnight-cast (mental model)

| You want… | Command |
|-----------|---------|
| Full stack check | `midnight-cast health` |
| Is the node up? | `midnight-cast ping` |
| Latest block | `midnight-cast block latest` |
| Block at height | `midnight-cast block <height>` |
| Raw RPC | `midnight-cast rpc` |
| What does error N mean? | `midnight-cast decode` |
| What happened to my tx? | `midnight-cast tx` |
| Event stream debug | `midnight-cast dust-events` |
| Version alignment | `midnight-cast versions` |
| Send a transaction | **Not midnight-cast** — use wallet / Lace / testkit |

---

## What midnight-cast is not

- Not a wallet (no keys, no signing, no proving)
- Not a replacement for `testkit-js` or Compact tooling
- Not a standalone indexer deployment tool

---

## Getting help

### midnight-cast

| Need | Where |
|------|--------|
| Bug or CLI not working | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |
| Feature / new command proposal | [GitHub Issues](https://github.com/Kanasjnr/midnight-cast/issues) |

### Midnight protocol, errors, and network

| Need | Where |
|------|--------|
| Errors not in `midnight-cast decode`, network outages, SDK questions | [Midnight Discord](https://discord.gg/Ap2QZ7yq) |
| Official reference | [Midnight docs](https://docs.midnight.network/) |
| Version pins | [Support matrix](https://docs.midnight.network/relnotes/support-matrix) |

**Before Discord:** run `midnight-cast health` (or the debug ladder) and paste output — same signals core devs use in threads.

### Docs

- [Command reference](./COMMANDS.md)
