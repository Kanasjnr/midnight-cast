# Developer workflows

How to use `mn` in real debugging sessions.

## The debug ladder

Run commands in this order when something breaks:

```
1. mn ping          →  Are RPC and indexer up?
2. mn tip           →  Is the indexer caught up?
3. mn versions      →  Is the live stack aligned with the support matrix?
4. mn decode …      →  What does the error code mean?
5. mn tx <hash>     →  What happened to this transaction?
6. mn dust-event(s) →  Ledger event / sync detail
```

Skip step 3 and you will waste time on proof regeneration when the real issue is preview vs preprod or indexer lag.

---

## New teammate (5 minutes)

```bash
npm i -g midnight-cast

mn config init
mn ping preprod
mn tip preprod
mn versions preprod
mn decode 170
mn decode 1010
```

You should see RPC/indexer OK, small tip delta, versions checks passing, and decode output for Custom 170.

---

## Start of day

Before writing repro scripts or opening Discord:

```bash
mn ping preprod
mn tip preprod
mn versions preprod
```

| Result | Action |
|--------|--------|
| `ping` FAIL on RPC or indexer | Fix connectivity first |
| `\|tip delta\|` ≥ threshold | Wait for indexer sync; don’t debug submissions yet |
| `versions` MISMATCH | Check [support matrix](https://docs.midnight.network/relnotes/support-matrix) and your local deps |

**CI example:**

```bash
mn tip preprod --fail-on-lag 500
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

Check segment failures and DUST events on that transaction.

---

## “Error 1010: Invalid Transaction”

1010 is a **Substrate envelope**, not the Midnight-specific code.

```bash
mn decode 1010
```

Look for `Custom error: N` in the full error message, then:

```bash
mn decode N
# or
mn decode ledger N
```

If you see `DispatchError::Module { index, error }`:

```bash
mn decode pallet <index> <error>
```

If there is **no** inner `Custom(N)`, the rejection was upstream (nonce, fee, mortality, size) — not ledger logic.

---

## Custom 179 / 180 (proof / transcript version)

Almost always version skew:

```bash
mn decode 179
mn decode 180
mn versions preprod
```

From your dApp directory (reads `package.json`):

```bash
cd my-midnight-app
mn versions preprod
```

Compare local `@midnight-ntwrk/ledger-v8`, proof server, and midnight-js versions to the matrix row for your network.

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

**Preview note:** event ids differ per network. If `dust-event 12345` fails, the id may not exist — use `dust-events --from` to discover ids.

**Fields to watch:**

- `typename` — event type (`DustSpendProcessed`, etc.)
- `protocolVersion` — mismatch hints at ledger/indexer skew
- `raw` — hex prefix (use `--verbose` for full payload; not deserialized in CLI)

Static background:

```bash
mn explain dust
```

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
| Is the node up? | `mn ping` |
| Latest block | `mn block latest` |
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

**Before Discord:** run the debug ladder and paste `mn ping`, `mn tip`, `mn versions`, and `mn decode` output — same commands core devs use in threads.

### Docs

- [Command reference](./COMMANDS.md)
