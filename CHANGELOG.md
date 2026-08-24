# Changelog

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
