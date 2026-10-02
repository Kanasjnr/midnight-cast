# Changelog

## Unreleased

### Tests & CI
- Scheduled live network check (`live.yml`, every 6h, on push to `main` and on demand) compares each network's live versions against the bundled and upstream support matrices, and keeps one `live-check` issue per network in sync (opens on drift or outage, closes when clean)
- Mainnet joins the live checks via Blockfrost using the `BLOCKFROST_MAINNET_PROJECT_ID` secret, exported as `BLOCKFROST_PROJECT_ID` the way users set it; skipped (not passed) on scheduled runs without it, and mandatory on release PRs
- Live checks are a release gate: they run only for `main` (release PRs and pushes) as required checks, so PRs into `next-release` stay off the network, and a release can't ship during an outage or with a stale support matrix
- Live smoke tests assert live-stack invariants instead of bundled-matrix equality
- Unit tests run on Linux, macOS and Windows × Node 20/22/24, plus a typecheck of `src/` and `scripts/`

### Changes
- Mainnet works again, through Blockfrost. Midnight retired `rpc.mainnet.midnight.network` and `indexer.mainnet.midnight.network` on 2026-09-30, so the built-in mainnet endpoints are now Blockfrost's. The project ID comes from `--project-id`, the network's config section (`blockfrost_project_id`, or `project_id` in its URLs), or `BLOCKFROST_PROJECT_ID`, in that order. It is sent in the `project_id` header (in the URL only for WebSockets) and redacted from all output. Without one, mainnet commands stop before any request and explain how to get one
- Blockfrost errors are explained: a `403` means a missing, invalid or wrong-network project ID, and `402`/`429` mean a plan limit. The v4 indexer API under Blockfrost's `/api/v0` is recognised
- A config that still points at the retired mainnet hosts gets a warning on stderr. `config show` reports where the project ID came from, and `config init --network mainnet` says how to set it
- `versions` and `health` check the node against a minimum version (`minNode`) and the runtime `spec_version` exactly (`runtimeSpec`), instead of requiring one exact node version. Different operators run different compatible builds: Midnight's endpoints report node 1.0.400 and Blockfrost's mainnet node 2.1.0, both on runtime 1000300
- Support matrix refreshed for runtime 1.0.300 on all networks: node >= 1.0.300 (recommended 1.0.300, the newest public release), spec_version 1000300, ledger 8.1.2, indexer 4.3.5 (preview) and 4.3.302 (preprod/mainnet), `midnight-js-indexer-public-data-provider` 4.1.1
- Error map stamped for ledger 8.1.2 and gains code 211 (`MerkleTreeError`, system transactions); the node's code table is otherwise unchanged since node 0.22.5
- Live check: node and proof-server numbers in Midnight's matrix that differ from the bundled ones are reported as `upstream-differs` (info), since those components are checked against the live network

### Fixes
- RPC and indexer requests retry timeouts, network errors and 502/503/504 (up to 3 attempts, 10 s each, within 20 s per request) instead of failing on the first slow response. Preprod's RPC is load-balanced across nodes that sometimes lag (servicedesk#223). The generic `rpc` command still makes a single attempt, since it can call methods that submit
- `ping` checks RPC, indexer and proof server in parallel, and reports a dead stack in about 20 s
- Matrix staleness test no longer depends on the current date (`isMatrixStale` accepts an injectable clock)
- Config path test passes on Windows

### Docs
- `docs/LIVE-CHECKS.md`: how CI tests live networks and how to enable mainnet

## 0.1.6

### Fixes
- Refresh support matrix (preview 1.0.1, preprod/mainnet 1.0.2; proof-server pins; updated 2026-08)
- Warn when `decode --network` ledger ≠ bundled error-codes map ledger
- Default local `proofServer` to `http://127.0.0.1:6300`; surface “not configured”
- Prefer `midnight-cast` over `mn` in install docs; Extends Midnight README attribution
- Expand `explain` topics: `dust`, `1010`, `versions`, `transcript`
- Health human output notes “healthy but mismatched” when versions fail
- Route unrecognized Compact/SDK/proof `--raw` pastes to other tooling hints

## 0.1.5

### Fixes
- Correct indexer package pin in support matrix (`midnight-js-indexer-public-data-provider`)
- Update preprod support matrix node pin to 1.0.0 (network upgrade)
- Omit mainnet proof-server URL until a public endpoint exists
- Use `process.exitCode` instead of `process.exit` for large `--json` piping
- Full Apache-2.0 license text
- Validate numeric CLI flags (`--threshold`, `--limit`, `--timeout`, dust event id)
- Validate `decode --network`; cap `decode --raw` length
- Strip control characters from error output; omit internal `exitCode` from JSON
- Sanitize untrusted version/data at client boundary (proof-server, node version, emit data)
- Positional `[network]` on `tx`, `rpc`, `decode`, and `dust-event` (aligned with ping/health)
- `config init` respects `MN_NETWORK` and global `--network`
- Expanded JSON-RPC error code reference

### Tests & CI
- Gate live network tests behind `INTEGRATION=1`
- CI smoke: preprod (full) + preview (ping, health, versions, tip, decode)
- Add unit tests for ping, dust, parse-int, sanitize
- Node 20 / 22 / 24 CI matrix

### Docs
- Prefer `npx midnight-cast` over unpinned global install; note `mn` binary clash

## 0.1.4

- `mn block <height>`, `mn health`, proof-server version checks, decode UX, network warnings, docs examples

## 0.1.3

- Initial public preview: ping, tip, versions, decode, tx, dust-events
