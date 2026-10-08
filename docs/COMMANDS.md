# Command reference

Reference for midnight-cast. For scenario guides, see [WORKFLOWS.md](./WORKFLOWS.md).

## Common workflows

Start here for the shortest path:

| Goal | Command |
|------|---------|
| Full stack health | `midnight-cast health preprod` |
| Ready for a first transaction? | `midnight-cast preflight preprod --address mn_addr_preprod1…` |
| Service reachability only | `midnight-cast ping preprod` |
| Check indexer lag | `midnight-cast tip preprod` |
| Check versions vs matrix | `midnight-cast versions preprod` |
| Decode wallet/node error | `midnight-cast decode --raw "<error>"` |
| Inspect a tx | `midnight-cast tx <hash> --network preprod` |
| Inspect a block | `midnight-cast block latest preprod` or `midnight-cast block <height> preprod` |
| Inspect DUST events | `midnight-cast dust-events --network preprod` |
| Working code for a pattern | `midnight-cast examples dust sponsorship` |

## Global flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--json` | Machine-readable output in a versioned envelope (see [JSON output](#json-output)) |
| `--network <name>` | `preview`, `preprod`, `mainnet`, or `local` |
| `--rpc <url>` | Override node JSON-RPC URL |
| `--indexer-http <url>` | Override indexer GraphQL HTTP URL |
| `--indexer-ws <url>` | Override indexer WebSocket URL |
| `--proof-server <url>` | Override proof server URL (ping / health) |
| `--project-id <id>` | Blockfrost project ID for mainnet |
| `--offline` | `versions`, `matrix` and `health` use the bundled support matrix and examples-report summaries instead of fetching from GitHub |

Environment: `MN_NETWORK` sets the default network (same as `--network`). `BLOCKFROST_PROJECT_ID` supplies the Blockfrost project ID for any Blockfrost network that has none in its config section; `--project-id` overrides both. `MN_OFFLINE=1` is the same as `--offline`.

**Version:** `midnight-cast --version` or `midnight-cast -V` prints the CLI package version.

---

## `midnight-cast config`

### `midnight-cast config init`

Write `~/.config/midnight-cast/config.toml` (or `$XDG_CONFIG_HOME/midnight-cast/config.toml`).

```bash
midnight-cast config init
midnight-cast config init -y --network preprod
midnight-cast config init --network local --rpc http://127.0.0.1:9944 \
  --indexer-http http://127.0.0.1:8088/api/v4/graphql \
  --indexer-ws ws://127.0.0.1:8088/api/v4/graphql/ws
```

| Flag | Description |
|------|-------------|
| `-n, --network <name>` | Network to configure |
| `--rpc`, `--indexer-http`, `--indexer-ws`, `--proof-server` | Custom URLs |
| `-y, --yes` | Non-interactive; default network `preprod` |

### `midnight-cast config show`

Print resolved endpoints (built-in defaults merged with config file and flags).

```bash
midnight-cast config show
midnight-cast config show --network mainnet --json
```

---

## `midnight-cast ping [network]`

Check RPC and indexer reachability. If a proof server URL is configured, also GET `/version` and compare it to the support matrix pin (for example `8.1.0`). Proof-server FAIL does not change the command exit code.

```bash
midnight-cast ping preprod
midnight-cast ping preview --json
```

**Proof server row:** `version=8.1.0 (matches matrix 8.1.0)` or `version=… (expected …)` on mismatch. Unreachable hosts (e.g. mainnet DNS not live yet) show as FAIL with detail.

Example output:

```text
service=rpc  status=OK  latencyMs=700
service=indexer  status=OK  latencyMs=543
service=proof-server  status=OK  latencyMs=1044  optional=true  version=8.1.0  detail=version=8.1.0 (matches matrix 8.1.0)
```

**Exit code:** `0` if RPC and indexer OK; `1` otherwise.

---

## `midnight-cast health [network]`

Run **ping**, **tip**, and **versions** in one command. Use this first when checking a network.

```bash
midnight-cast health preprod
midnight-cast health preview --json
midnight-cast health preprod --fail-on-lag --fail-on-mismatch   # CI
```

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <n>` | `100` | Lag tolerance in blocks (same as `tip`) |
| `--fail-on-lag` | off | Treat indexer lag as unhealthy |
| `--fail-on-mismatch` | off | Treat live version mismatches as unhealthy |

**Output sections:** service reachability, RPC vs indexer height delta, live version checks vs support matrix, and whether Midnight's own examples pass on the node the network runs (see [Midnight's examples](#midnights-examples) under `versions`).

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

Versions:
  Matrix updated:  2026-10
  node: OK (expected >=1.0.400, live 1.0.400)
  runtimeSpec: OK (expected 1000300, live 1000300)
  indexer-api: OK (expected v4, live v4)
  protocolVersion: OK (expected 1000300, live 1000300)
  proof-server: OK (expected 8.1.0, live 8.1.0)

Midnight's examples: 202 passed, 1 failed on node 1.0.400 (preprod, 30 Sep 2026).
  Their verdict: No Node 1.0.400 regression found.
  Report: https://github.com/midnightntwrk/midnight-examples/blob/main/reports/node-1.0.400-regression.json
```

**Exit code:** `0` when RPC and indexer are up and optional CI flags pass. Version mismatches are **warnings** unless `--fail-on-mismatch` is set. Proof server failure does not fail health by itself.

---

## `midnight-cast preflight [network]`

Checks that you can send a first transaction: the network, the proof server and, with `--address`, the wallet. Most people who get stuck before their first transaction on preprod or preview are stuck here, not in their code.

```bash
midnight-cast preflight preprod
midnight-cast preflight preprod --address mn_addr_preprod1… --json
midnight-cast preflight preprod --proof-server http://127.0.0.1:6300 --address stake_test1…
```

| Flag | Default | Description |
|------|---------|-------------|
| `--address <address>` | none | The wallet to check: its Midnight unshielded address (`mn_addr_…`), or a Cardano reward address (`stake…`) for NIGHT held on Cardano |
| `--timeout <ms>` | `30000` | How long to read the address's transactions |

**Checks:**

- **network:** the RPC and indexer answer, and the indexer is within the lag threshold of the node, as `health` measures it.
- **proof server:** it answers at the configured URL (`--proof-server`, or `proof_server` in `config.toml`) and runs the version the support matrix expects, or a newer patch of it. A server on the wrong version is reported as such, not as unreachable. Unlike `health`, a missing proof server fails, because a transaction can't be proved without one.
- **wallet**, with `--address`:
  - For an unshielded address, the indexer replays the address's transactions until it has caught up. The check then counts the NIGHT UTXOs it holds now, and how many are registered for DUST generation. NIGHT is the unshielded token type `00…00` (`UnshieldedTokenType(HashOutput([0u8; 32]))` in midnight-ledger), shown in NIGHT at 1,000,000 STAR each.
  - With no NIGHT, it points at the faucet. With NIGHT but none registered for DUST, it says the wallet can't pay fees until it registers. DUST builds up after registration, so a wallet registered moments ago may still need to wait.
  - A busy address can take longer than `--timeout` to replay. The totals are then marked as possibly short, and a read that found no NIGHT before the timeout says so rather than sending you to the faucet.
  - For a Cardano reward address it uses the same indexer query as `dust-status`, and fails while no DUST has been generated yet.
  - The wallet is read alongside the other checks, and not at all if the indexer is down. An indexer error is reported as such, never as an empty wallet.
  - The address must belong to the network: `mn_addr1…` on mainnet, `mn_addr_<network id>1…` on preview and preprod, `mn_addr_undeployed1…` on a local devnet, and `stake1…` on mainnet or `stake_test1…` elsewhere for Cardano. Anything else, or an empty `--address`, is a usage error (exit `2`).

**Expectations:** when Midnight's examples have run on this network (see [Midnight's examples](#midnights-examples)), the output quotes what that run measured: how long a new wallet's first sync took, and how long restoring one from their pre-seed bundle took. A first sync of over an hour on preprod is normal, not a hang. JSON has it as `expectations`, with the faucet the run used.

Example output:

```text
Preflight: preprod

  OK   network      the RPC and indexer answer, and the indexer is 2 blocks from the node
  OK   proof server answers at https://proof-server.preprod.midnight.network and runs 8.1.0
  FAIL wallet       no NIGHT at this address. Fund it from the faucet (https://midnight-tmnight-preprod.nethermind.dev/)

Expect, from Midnight's examples run on preprod (30 Sep 2026): a new wallet's first sync took about 67 minutes; restoring one from a pre-seed bundle took 105-123 seconds.
  https://github.com/midnightntwrk/midnight-examples/blob/main/reports/node-1.0.400-regression.json
```

It works on `local` and on networks from `config.toml` too; without a support matrix row it doesn't check the proof server's version.

**Exit code:** `0` when every check passes, `1` when any fails (the error lists them, and `error.kind` is the first failure's kind, such as `refused`), `2` for an address it can't check. It only reads: no seeds, keys or transactions.

---

## `midnight-cast tip [network]`

Compare latest block height: node RPC vs indexer.

```bash
midnight-cast tip preprod
midnight-cast tip mainnet --threshold 500
midnight-cast tip preprod --fail-on-lag --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <n>` | `100` | Lag tolerance in blocks |
| `--fail-on-lag` | off | Exit `1` when `\|delta\| >= threshold` |

**Exit code:** `0` by default (informational). With `--fail-on-lag`, exits `1` when `|delta| >= threshold`.

Example output:

```text
network: preprod
rpcHeight: 1477612
indexerHeight: 1477609
delta: 3
threshold: 100
inSync: true
```

---

## `midnight-cast versions [network]` / `midnight-cast matrix [network]`

Compare live node/indexer signals to the [support matrix](https://docs.midnight.network/relnotes/support-matrix).

```bash
midnight-cast versions preprod
midnight-cast matrix preview --json
midnight-cast versions preprod --fail-on-mismatch
cd my-dapp && midnight-cast versions preprod   # also reads local package.json deps
midnight-cast versions preprod --no-local
midnight-cast versions preprod --project-dir ~/code/my-dapp
```

| Flag | Description |
|------|-------------|
| `--fail-on-mismatch` | Exit `1` if live checks fail (CI) |
| `--no-local` | Do not check local packages |
| `--project-dir <dir>` | Check the project in this directory instead of the current one |
| `--refresh-matrix` | Fetch Midnight's published matrix and the examples report even if the cached copies are fresh (also on `health`) |

**Live checks:** node `system_version` against the matrix minimum (`>=minNode`; exact match for rows without one), node runtime `specVersion` against the matrix `runtimeSpec`, indexer API path (`v4`), RPC `specVersion` vs indexer `protocolVersion`, and proof server `GET /version` when a URL is configured. The proof server passes on the matrix's version or a newer patch of it: 8.1.3 passes where the matrix lists 8.1.0, since patches carry fixes (8.1.3 has ledger 8.1.3's security fix), while 8.0.x, 8.2 and 9.0 don't. A minimum rather than an exact node version is used because different operators run different compatible builds: on 2 October 2026 Midnight's endpoints reported node 1.0.400 and Blockfrost's mainnet node 2.1.0, both on runtime 1000300.

**Reference only:** ledger, indexer package version, and on-chain runtime are shown for manual comparison.

**Local deps:** reads every Midnight package from the project's `package.json` (the current directory, or `--project-dir`) under either npm scope, `@midnight-ntwrk/*` or `@midnightntwrk/*`, using the installed version from `package-lock.json` when there is one. Matrix `packages` pins apply to a package whichever scope it uses, and a mismatch is reported as **MISMATCH**. Midnight is moving its packages to `@midnightntwrk`, with the same API and only the name changed. If the same package is installed under both scopes, directly or through another dependency, a `scope:<package>` check fails, because two copies of one package can break `instanceof` checks and types. Packages you still use from the old scope that have a stable release under the new one are listed under **npm scope** as a rename hint. As of 2 October 2026 those are `ledger-v8`, `onchain-runtime-v3`, `zkir-v2` and the `wallet-sdk*` packages. Installed versions are read from npm's `package-lock.json` only. In yarn or pnpm projects, and before `npm install`, a dependency without a concrete version is listed as not resolved instead of being compared.

**Network warning:** if the live node or runtime spec doesn't fit the selected matrix row, warns that your endpoints may point at a different environment.

**Which matrix:** `versions`, `matrix` and `health` take the first of these, and report it as `Matrix:` (`matrixSource` in JSON):

1. A `support-matrix.json` you drop in `~/.config/midnight-cast/`, used as is.
2. Midnight's published matrix (`midnightntwrk/midnight-docs`, `docs/relnotes/support-matrix.json`), fetched with a 3-second timeout and cached for six hours in `~/.cache/midnight-cast/` (or `$XDG_CACHE_HOME/midnight-cast/`). If a refresh fails, a cached copy up to a week old is used instead, unless the bundled matrix is newer, and the reason is shown. A failed fetch isn't retried for an hour, so an unreachable GitHub costs the timeout once rather than on every run.
3. The matrix bundled with this release, when offline (`--offline` or `MN_OFFLINE=1`) or when nothing could be fetched.

The published matrix updates only what the endpoints can't reveal: the indexer, on-chain runtime and Compact runtime versions, including the `compact-runtime` package pin. Node and proof server stay as bundled, because they are checked against the live network and the published file can list versions no network runs yet. The minimum node version, runtime `spec_version`, ledger and indexer API also come from the bundled matrix, since the published file doesn't carry them. Disagreements inside the published file, such as a `tag` and `containerTag` that differ, are shown as notes (`matrixNotes` in JSON).

**Staleness:** when the bundled matrix (or your override) is older than 45 days, a warning says mismatches may be false. It applies even with the published matrix, since node, runtime spec and ledger still come from the bundled copy.

<a id="midnights-examples"></a>**Midnight's examples:** for each node release, the maintainers of [midnight-examples](https://github.com/midnightntwrk/midnight-examples) run every example's test suite against public preprod and commit the result as `reports/node-<version>-regression.json`. `versions` and `health` show that report for the node version the network runs (`examples` in JSON): how many tests passed and failed, on which network and when, the report's own verdict when some failed, its known issues, and a link. It answers "is it the network or my code?": if the examples pass on this node and the network is healthy, look at your code or setup first.

- `status` is `passed` when every suite and test passed, and `failures` when any failed; read the verdict and known issues, since a failure can be a test problem rather than a node one.
- It is `unverified`, with a `reason`, when the node version has no report (it is never matched to an older one), when the report ran a different runtime `spec_version` or another network, or when it has no passing tests. The runs are on preprod, so mainnet and preview show the preprod run for context but stay unverified: the same node on another network isn't what the examples tested.
- The report is fetched for that exact version with a 3-second timeout and cached like the published matrix: six hours, a week as a fallback, and no retry for an hour after a failure. A report that says it's about a different node version is rejected. Offline, or when nothing can be fetched, the summaries bundled with this release are used, and a cached copy older than them is ignored. `source` says which was used, and how old it is. Reading the report never fails `versions` or `health`; a problem shows as `unverified` with the reason.

**Against Midnight's examples:** next to the matrix checks, `versions` compares the project with the toolchain Midnight's examples are pinned to, a set known to compile and pass its tests together (`examplesToolchain` in JSON). It covers the `midnight-js-*` packages, `testkit-js`, the wallet SDK, the `pragma language_version` in the project's `.compact` files (build output and `node_modules` skipped; a constraint such as `>= 0.16 && <= 0.20` must admit the examples' language) and the Node.js version in `.nvmrc` or `engines`. It checks only what the project declares, and it's advice: a difference doesn't change `allOk` or the exit code, since a project can be right on other versions. For example: "wallet-sdk: examples=1.2.0 project=1.0.4 → DIFFERS (the official examples run 1.2.0)".

Example output:

```text
Checks:
  node: expected=>=1.0.400 live=1.0.400 → OK (recommended 1.0.400)
  runtimeSpec: expected=1000300 live=1000300 → OK (node runtime spec_version vs matrix)
  indexer-api: expected=v4 live=v4 → OK (from configured indexer URL path)
  protocolVersion: expected=1000300 live=1000300 → OK (RPC specVersion vs indexer latest block)
  proof-server: expected=8.1.0 live=8.1.0 → OK (GET /version on configured proof server URL)

Summary: live stack matches matrix checks ✓
```

---

## `midnight-cast block latest [network]`

Latest block header from node RPC (`chain_getHeader` + head block hash).

```bash
midnight-cast block latest preprod
midnight-cast block latest --json
```

**JSON / human fields:** `height`, `hash`, `parentHash`, `stateRoot`, `extrinsicsRoot`, `network`.

Example output:

```text
network: preprod
height: 1477623
hash: 0x5ebdc11e23cba3915ef231f1e3934781481c61a0998f0852b0fb3efbe9e1825d
parentHash: 0xb88e03aec9731e1f6f964c78e710c1cc6eae26ad9bf46a1ffa64dc8e8ddbc1a3
stateRoot: 0xa51cf601544001880e24a386c06f728f00552703c20b51c42f8ea03566a1dad9
extrinsicsRoot: 0x371613d5bad47555572a59088d9012c00cb5160ca11c1d10610c3bd4a7a2a105
```

---

## `midnight-cast block <height> [network]`

Read the block header at a specific height (`chain_getBlockHash` + `chain_getHeader`).

```bash
midnight-cast block 909000 preprod
midnight-cast block 909000 --json
```

Use this to confirm a tx block or inspect RPC state at a past height.

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

## `midnight-cast rpc <method> [params]`

Raw JSON-RPC call to the configured node.

```bash
midnight-cast rpc chain_getHeader
midnight-cast rpc chain_getHeader '[]'
midnight-cast rpc chain_getRuntimeVersion --network mainnet --json
midnight-cast rpc system_version
```

`params` must be a JSON array (or omitted for `[]`).

---

## `midnight-cast tx <hashOrId>`

Look up an indexed transaction over GraphQL HTTP.

```bash
midnight-cast tx e5c86fcd43eb9707e8f23d940e59a6c12ca7ad3ca7e9d2f1232843cc62de1b8c
midnight-cast tx e5c86fcd... --network preprod --json
midnight-cast tx abc123... --by identifier
```

| Flag | Default | Description |
|------|---------|-------------|
| `--by <kind>` | `hash` | `hash` or `identifier` |

**Shows:** status, fees, segment results, contract action types, DUST/zswap event ids, block height.

When DUST events are present, human output includes `midnight-cast dust-event <id>` hints per event.

**Network warning:** compares live node `system_version` to the matrix row for `--network` (same as `versions`).

When a segment failed, output notes that indexer v4 does not expose the failure reason and suggests `midnight-cast decode --raw` with the wallet/node error string.

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

---

## `midnight-cast decode`

Decode Midnight and Substrate errors. No network required.

### Paste full error (`--raw`)

```bash
midnight-cast decode --raw "1010: Invalid Transaction: Custom error: 186"
midnight-cast decode raw "1010: Invalid Transaction: Custom error: 186"
midnight-cast decode raw "DispatchError::Module { index: 5, error: 3 }"
```

Auto-detects and decodes everything it finds in one pasted error:

- Substrate **1010** / Invalid Transaction envelope
- **Custom(N)** / `Custom(N)` / hex (`0xaa`) / bare numbers (0–255)
- Known **ledger error names** (e.g. `InvalidDustSpendProof`)
- **DispatchError::Module** pallet index + error
- **JSON-RPC** codes (e.g. `"code": -32602` or RPC error text)
- **Known messages** from current tooling, decoded with `kind: "message"`:
  - `UnsupportedBlockVersion(1000300)` from toolkit 1.0.0 or node 1.0.2 on runtime 1.0.300
  - Blockfrost's "Missing project token" and "Invalid project token"
  - Anything mentioning the retired `rpc.mainnet.midnight.network` or `indexer.mainnet.midnight.network`
  - Output from Compact toolchain 0.35 or Compact runtime 0.20 (`--feature-zkir-v3`, ZKIR 3.1, `ContractModuleProvider`, `ledger-v9`), which target ledger 9, not yet on the public networks

Hex codes need the `0x` prefix, "ledger N" counts only as "ledger error N" or "ledger code N", and single-word ledger names such as `Transaction` aren't matched in free text, since they also appear in ordinary error messages ("Invalid Transaction").

Where Midnight's examples show the fix, a decoding links that code, at the examples index's pinned commit (`examples` in JSON, `Code:` lines otherwise):
- stale-DUST errors (170, 171, 196) link hello-world's wallet sync;
- fees beyond the available DUST (138 and the fee-calculation codes) link private-party's DUST sponsorship;
- token balance and unshielded-input errors link token-transfers' send circuits;
- Zswap errors link its shielded circuits.

The wallet's "Insufficient Funds: could not balance dust" (`Wallet.InsufficientFunds`), the failure the examples' UI explains to new users, decodes as a known message with all three.

Some ledger codes carry a related hint. `OutOfDustValidityWindow` (171) notes the indexer bug fixed in 4.3.4 and 4.3.5, which rejected the first transaction of a block. `TransactionApplicationError` (182) notes the node 1.0.300 bug that halts a fresh mainnet sync at block #1788979, fixed in node 1.0.400. The deserialization codes (0–11) note that ledger 8.1.2 rejects non-canonical encodings, and that ledger 8.1.3 (node 1.0.400) also rejects contract call transcripts with non-canonical field values or `noop 0`.

### Shorthand

```bash
midnight-cast decode 170
midnight-cast decode 170 --network preview    # ledger map uses preview row (8.1.0 vs 8.0.3)
midnight-cast decode 0xaa
midnight-cast decode InvalidDustSpendProof
midnight-cast decode 1010
```

**Pallet `Transaction`:** decoding `midnight-cast decode pallet pallet_midnight Transaction` adds a hint to find inner `Custom(N)` in the full error string.

**Transcript codes 179 / 180 / 181:** decoding any of these shows related proof/transcript version context (`UnsupportedProofVersion`, `GuaranteedTranscriptVersion`, `FallibleTranscriptVersion`).

Example output:

```text
Kind:   ledger (Custom 170)
Name:   InvalidDustSpendProof
Desc:   DUST spend proof verification failed
Fix:    Regenerate DUST spend proof
Map:    ledger 8.1.0 (preview, updated 2026-06)
Docs:   https://docs.midnight.network/nodes/error-codes
```

### Subcommands

```bash
midnight-cast decode ledger 170
midnight-cast decode pallet 5 3
midnight-cast decode pallet pallet_midnight Transaction
midnight-cast decode 1010
midnight-cast decode jsonrpc -32602
```

| Form | Purpose |
|------|---------|
| `--raw <message>` | Parse full error string (1010, Custom N, pallet) |
| `--network <name>` | Stamp ledger map from matrix row (preview vs preprod) |
| `ledger <code>` | `Custom(N)` / LedgerApiError (0–255); shows map ledger version |
| `pallet <index> <variant>` | `DispatchError::Module` |
| `1010` | Substrate Invalid Transaction envelope guide |
| `jsonrpc <code>` | JSON-RPC errors (e.g. `-32602`) |

---

## `midnight-cast contract <address> [network]`

Look up a deployed contract on the indexer: whether a contract exists at the address, its latest action (deploy, call or update) and, for a call, the circuit it ran, the transaction and block of that action, when the contract was deployed, and its unshielded token balances.

```bash
midnight-cast contract a0885870e2650aa2213a44e348371b0050b134fe87c80f31b990430bca412b13 preprod
midnight-cast contract 0xa0885870… preprod --json
```

| Flag | Description |
|------|-------------|
| `--state` | Include the full contract state hex |

Contract state can be large (678 KB for one preprod contract), so by default the output gives its size in bytes and its sha256, enough to tell whether it changed. When the latest action is an update, the indexer doesn't link the deploy, so `deployed` is absent. An address with no contract fails with "No contract at …". `next` points at `tx` for the latest action's transaction.

---

## `midnight-cast dust-status <addresses...>`

DUST generation for one or more Cardano reward addresses: whether each is registered for DUST generation, its NIGHT balance, the generation rate, and current and maximum DUST capacity. Use it when a wallet has no DUST. Pick the network with `--network`.

```bash
midnight-cast dust-status stake_test1uq… --network preprod
midnight-cast dust-status stake1u… stake1u… --network mainnet --json
```

Values are passed through as the indexer reports them. An address that isn't a valid reward address is rejected by the indexer with its reason. When an address isn't registered, `next` points at `explain dust`.

---

## `midnight-cast dust-event <id>`

Fetch one DUST ledger event by id over **indexer WebSocket** (v4 has no HTTP query for dust events).

```bash
midnight-cast dust-event 565975 --network preprod
midnight-cast dust-event 565975 --verbose --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | off | Full `raw` hex |
| `--timeout <ms>` | `15000` | Subscription timeout |

**Not found:** suggests `midnight-cast dust-events --from <id-10> --limit 10` to browse recent events on that network.

---

## `midnight-cast dust-events [network]`

List DUST ledger events: the latest ones, or a run from a starting id.

```bash
midnight-cast dust-events --network preprod
midnight-cast dust-events --network preprod --from 565900 --limit 10
midnight-cast dust-events preview --from 12340 --limit 5 --json
```

| Flag | Default | Description |
|------|---------|-------------|
| `--from <id>` | latest | Start event id. Without it, the latest events are shown |
| `--limit <n>` | `10` | Max events to collect |
| `--verbose` | off | Full `raw` hex |
| `--timeout <ms>` | `30000` | Subscription timeout |

**Tip:** `dust-event` for an id the network hasn't reached yet fails at once and names the latest id; `dust-events` shows the events around it.

Example output:

```text
id=565900  typename=DustGenerationDtimeUpdate  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565901  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
id=565902  typename=DustInitialUtxo  protocolVersion=22000  raw=0x6d69646e696768743a6576656e745b76…  maxId=1219348
```

---

## `midnight-cast agents init`

Prints the guidance that teaches an AI coding agent when to use midnight-cast, the debug ladder, and how to read the JSON envelope. With `--write` it puts it in the project.

```bash
midnight-cast agents init
midnight-cast agents init --write
midnight-cast agents init --write --file CLAUDE.md --yes
```

| Flag | Default | Description |
|------|---------|-------------|
| `--file <name>` | `AGENTS.md` | `AGENTS.md`, `CLAUDE.md` or `GEMINI.md` |
| `--write` | off | Write it into that file in the current directory |
| `--yes` | off | Change an existing file without asking |

The guidance sits between `<!-- midnight-cast:start -->` and `<!-- midnight-cast:end -->` markers. A new file is created. In an existing file, only that section is added to the end or updated in place, and nothing else in the file is touched. Changing an existing file asks first, or needs `--yes` when there is no terminal to ask in.

---

## `midnight-cast mcp`

Runs a read-only MCP server on stdio, for AI agents. It exposes `health`, `ping`, `tip`, `versions`, `block`, `tx`, `dust_event`, `dust_events`, `decode` and `explain` as tools that return the [JSON envelope](#json-output), prompts for diagnosing an error, checking a network and investigating a transaction, and the support matrix, error codes and command catalog as resources. `MIDNIGHT_CAST_NETWORKS` (for example `preview,preprod`) limits the networks the model may query, `BLOCKFROST_PROJECT_ID` supplies the mainnet project ID, which never appears in a response, and `MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE` sets the rate limit on network tools (30 by default). Setup for each agent is in [MCP.md](./MCP.md).

```bash
midnight-cast mcp
MIDNIGHT_CAST_NETWORKS=preview,preprod midnight-cast mcp
```

---

## `midnight-cast examples [topic]`

Finds working code in Midnight's official examples ([midnightntwrk/midnight-examples](https://github.com/midnightntwrk/midnight-examples)), each compiled and tested in CI against one pinned toolchain. Give a topic in your own words and it returns the examples that show it: what each one covers, the files and line ranges, links pinned to a commit, and, for the best match, the code itself. Without a topic it lists every example and its topics. It works offline.

```bash
midnight-cast examples
midnight-cast examples dust sponsorship
midnight-cast examples "verify a signature in a circuit" --json
```

Example output (cut short):

```text
Midnight's examples for "dust sponsorship" (midnightntwrk/midnight-examples at 4056c6c, pinned to Compact language 0.23, Compact compiler 0.31.1, @midnight-ntwrk/midnight-js-* 4.1.1)

private-party: Private on-chain data, access control, and DUST sponsorship: one wallet pays the fees for another's transaction
  Having a sponsor wallet pay the DUST fee and submit: examples/private-party/src/sponsor.ts:96-115
    https://github.com/midnightntwrk/midnight-examples/blob/4056c6c…/examples/private-party/src/sponsor.ts#L96-L115

    export async function sponsorAndSubmit(
    …
```

The index covers all eleven examples:
- hello-world;
- calculator;
- private-party;
- token-transfers;
- silent-auction;
- election;
- secret-message;
- zk-loan;
- shielded-chips;
- private-bid;
- battleship.

The topics and code locations are chosen by hand. `npm run examples-index` finds each location by its declaration at the pinned commit, so the line ranges and excerpts always match the linked code. The JSON has the toolchain the examples are pinned to (Compact language and compiler, midnight-js, wallet SDK, Node.js), so you can tell when your project is on a different generation. A topic with no match exits `1`; a topic of only filler words, such as "show me code", lists every example. When an example matches as a whole but none of its files does, the JSON says so (`filesMatched: false`) and lists all of its files, and the human output shows no excerpt rather than an unrelated one.

`live.yml` checks the index against its pinned commit and notes when midnight-examples has moved past it, with any toolchain change; moving the pin is a deliberate change to `COMMIT` in `scripts/examples-index.ts`.

---

## `midnight-cast explain [topic]`

Static help (no network). Topics: `dust`, `1010`, `versions`, `transcript`, `sync`. `sync` is for a wallet that seems stuck syncing. It quotes the first-sync and pre-seed times Midnight's examples measured on preprod, from their FAST-SYNC notes and their latest regression report, and says how to rule out the network and how the examples start wallets from a pre-seeded bundle. `dust` and `sync` end with working code from Midnight's examples (`examples` in JSON).

```bash
midnight-cast explain dust
midnight-cast explain --json
```

With `--json` and no topic, `explain` returns a catalog of the whole CLI, built from the command definitions so it can't drift from them. It lists every command with its usage, arguments and options, whether it is read-only (only `config init` writes, to the config file), and a link to the schema of its output, plus the global options, the topics, the exit codes and the error kinds. An agent can learn what midnight-cast does from that one call.

---

## JSON output

With `--json`, every command prints one envelope on stdout:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "command": "tip",
  "network": "preprod",
  "data": null,
  "warnings": [],
  "error": {
    "message": "Indexer unreachable",
    "kind": "timeout",
    "hint": "The indexer didn't answer in time. Public endpoints can be slow, so try again, or point at another endpoint with --rpc / --indexer-http."
  },
  "next": [
    {
      "command": "midnight-cast config show --network preprod",
      "reason": "Check the configured endpoints; a wrong or retired URL is the usual cause"
    }
  ]
}
```

`command` is the command path, such as `decode ledger`, and is `null` only for a usage error. `network` is the network the command ran against, when it has one. `data` holds the command's result and `error` is `null` whenever `ok` is true. Some failed checks keep their report in `data`: a failed `ping` still lists every service, and an unhealthy `health` keeps its report. When the RPC or indexer is down, `health` lists every service with each failure's `detail` and `errorKind`, but has no `sync` or `versions`, since it couldn't measure them. Warnings that human mode prints on stderr, such as a config that still points at a retired mainnet host, are collected in `warnings`.

`next` lists follow-up commands, always spelled `midnight-cast …`, and appears only in JSON output. Suggested commands keep any `--rpc`, `--indexer-http`, `--indexer-ws` or `--proof-server` override, so they recheck the same endpoints, but never the project ID. The suggestions are: `decode 1010` points at `decode ledger <N>` and `explain 1010`, `tx` points at `decode --raw` when a segment failed and at `dust-event <id>` for each DUST event, a failed `health` points at `ping` or `tip`, and a request that can't reach a configured endpoint points at `config show`. A placeholder in angle brackets, such as `<N>`, has to be filled in before running the command. When a step is also an MCP tool call that needs nothing filled in, it has a `tool` with the tool's `name` and `arguments`, so an agent using [the MCP server](./MCP.md) can follow it without a terminal.

`error.kind` says what went wrong. The network kinds are also set on failed rows in `ping` and `health`:

| `kind` | Meaning |
| --- | --- |
| `usage` | The command line was invalid |
| `rate_limited` | The MCP server's limit on network calls was reached; wait and retry |
| `dns` | The host name doesn't resolve |
| `refused` | Nothing is listening at the URL |
| `timeout` | No answer in time, after retries |
| `tls` | The TLS handshake failed (certificate, proxy or clock) |
| `network` | The connection dropped |
| `http_4xx` | The endpoint rejected the request, e.g. a wrong path (404), a missing token (403) or rate limiting (429) |
| `http_5xx` | The endpoint reported a server error, after retries |
| `rpc_error` | The node rejected the JSON-RPC call |
| `graphql_error` | The indexer rejected the GraphQL query |
| `invalid_response` | The response wasn't the JSON expected |

Other failures, such as an unknown ledger code or a transaction that isn't found, have a `kind` of `null`. `error.hint` suggests what to do, and human mode prints it as a `Hint:` line under the error.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | The command ran and failed: a service is unreachable, a check failed, or a request was rejected |
| `2` | Usage error: an unknown command or option, or a missing argument |

`ping` exits `1` when the RPC or indexer is down. `tip --fail-on-lag`, `health --fail-on-lag`, `health --fail-on-mismatch` and `versions --fail-on-mismatch` exit `1` when their check fails; without those flags they only report.

### Schemas and versioning

JSON Schemas (draft 2020-12) for the envelope and for each command's `data` are in [`schemas/`](../schemas) and ship in the npm package. The `explain --json` catalog links each command to its schema. Data schemas require only the fields that are always present and allow others, so new fields can appear in any release. Removing or renaming a field, or changing its type, is a breaking change: it bumps `schemaVersion` and is called out in the changelog. Check `schemaVersion` before reading the rest.

---

## Networks (built-in)

| Network | Node RPC | Indexer |
|---------|----------|---------|
| `preview` | `https://rpc.preview.midnight.network` | `.../api/v4/graphql` |
| `preprod` | `https://rpc.preprod.midnight.network` | `.../api/v4/graphql` |
| `mainnet` | `https://rpc.midnight-mainnet.blockfrost.io` | `https://midnight-mainnet.blockfrost.io/api/v0` |
| `local` | `http://127.0.0.1:9944` | user-configured |

Built-in proof server URLs: `https://proof-server.<network>.midnight.network` (`GET /` health, `GET /version` for ledger pin). Mainnet has no public proof server; it always runs locally.

### Mainnet and Blockfrost

Midnight retired its hosted mainnet RPC and indexer on 30 September 2026, and Blockfrost serves them now. Every request needs a project ID from a **Midnight Mainnet** project on [blockfrost.io](https://blockfrost.io) (it starts with `nightmainnet`). Pass it with `--project-id`, set it in the network's config section (as `blockfrost_project_id`, or as `project_id` in its URLs), or export `BLOCKFROST_PROJECT_ID`, in that order of precedence. The environment variable applies to every Blockfrost network, so a network's own config wins over it:

```bash
midnight-cast health mainnet --project-id nightmainnet...
export BLOCKFROST_PROJECT_ID=nightmainnet...   # then: midnight-cast health mainnet
```

You can also put it in the config file:

```toml
[networks.mainnet]
blockfrost_project_id = "nightmainnet..."
```

Without a project ID, mainnet commands stop before making any request and say how to get one. midnight-cast sends the ID in Blockfrost's `project_id` header and never prints it: `config show` reports where it came from, and every output is scrubbed of it. A `403` from Blockfrost means the ID is missing, invalid, or for another network. A config file that still points at `rpc.mainnet.midnight.network` or `indexer.mainnet.midnight.network` gets a warning on stderr. Run `midnight-cast config init --network mainnet` to switch it to Blockfrost.

Override any endpoint in config or with flags. See [Midnight network docs](https://docs.midnight.network/relnotes/network).
