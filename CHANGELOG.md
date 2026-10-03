# Changelog

## Unreleased

### Breaking changes
- `--json` output is a versioned envelope: `{ schemaVersion, ok, command, network, data, warnings, error, next }`. `error` is now an object, `{ message, kind, hint }`, instead of a string, and the top-level `errorKind` and `hint` moved inside it as `kind` and `hint`. Read `error.message` where you read `error` before. Any later breaking change to the JSON bumps `schemaVersion`
- Usage errors (an unknown command or option, a missing argument or subcommand) exit `2` instead of `1`

### Agents & JSON
- `next` lists follow-up commands, spelled `midnight-cast …`: `decode` points at the ledger code inside a 1010 and at `explain` topics, `tx` at `decode --raw` for a failed segment and at `dust-event` for each DUST event, a failed `health` at `ping` or `tip`, and an unreachable configured endpoint at `config show`. Suggestions keep any endpoint overrides, but never the project ID
- `ping`, `health`, `tip` and `versions` failures say what failed, e.g. "Required services unreachable: rpc" or "Indexer is 120 blocks behind the node (threshold 100)", instead of no message
- Warnings, such as a config pointing at the retired mainnet hosts, are included in the envelope's `warnings` as well as printed on stderr in human mode
- With `--json`, a usage error prints an envelope with `error.kind: "usage"` and commander's suggestion as the hint
- `explain --json` with no topic returns a catalog of every command, generated from the CLI definition: usage, arguments, options, whether it is read-only, and its output schema, plus the global options, topics, exit codes and error kinds
- JSON Schemas for the envelope and each command's data ship in `schemas/`, and the tests validate every command's output against them
- The `decode 1010` result has `kind: "substrate"`, like every other decoding
- Hints, error messages, `--help` and the docs say `midnight-cast` everywhere, matching the JSON output. `mn` still works as an alias, and the dev script is now `npm run cli`

### Tests & CI
- Scheduled live network check (`live.yml`, every 6h, on push to `main` and on demand) compares each network's live versions against the bundled and upstream support matrices, and keeps one `live-check` issue per network in sync (opens on drift or outage, closes when clean)
- Mainnet joins the live checks via Blockfrost using the `BLOCKFROST_MAINNET_PROJECT_ID` secret, exported as `BLOCKFROST_PROJECT_ID` the way users set it; skipped (not passed) on scheduled runs without it, and mandatory on release PRs
- Live checks are a release gate: they run only for `main` (release PRs and pushes) as required checks, so PRs into `next-release` stay off the network, and a release can't ship during an outage or with a stale support matrix
- Live smoke tests assert live-stack invariants instead of bundled-matrix equality
- Every live job lives in `live.yml` and the `Tests` workflow is unit-only, so PRs into `main` list no skipped checks
- Unit tests run on Linux, macOS and Windows × Node 20/22/24, plus a typecheck of `src/` and `scripts/`

### Changes
- Network failures are classified. With `--json`, a failed RPC or indexer request reports a `kind` (`dns`, `refused`, `timeout`, `tls`, `network`, `http_4xx`, `http_5xx`, `rpc_error`, `graphql_error`, `invalid_response`) and a `hint` in `error`. Human mode prints the hint under the error, and `ping`/`health` rows carry the kind as `errorKind`
- `versions` reads Midnight packages under both npm scopes (`@midnight-ntwrk` and the new `@midnightntwrk`) and takes installed versions from `package-lock.json`. Matrix pins apply whichever scope is used. Installing one package under both scopes, directly or through a dependency, fails a `scope:` check, and old-scope packages that have a stable new-scope release get a rename hint
- Mainnet works again, through Blockfrost. Midnight retired `rpc.mainnet.midnight.network` and `indexer.mainnet.midnight.network` on 2026-09-30, so the built-in mainnet endpoints are now Blockfrost's. The project ID comes from `--project-id`, the network's config section (`blockfrost_project_id`, or `project_id` in its URLs), or `BLOCKFROST_PROJECT_ID`, in that order. It is sent in the `project_id` header (in the URL only for WebSockets) and redacted from all output. Without one, mainnet commands stop before any request and explain how to get one
- Blockfrost errors are explained: a `403` means a missing, invalid or wrong-network project ID, and `402`/`429` mean a plan limit. The v4 indexer API under Blockfrost's `/api/v0` is recognised
- A config that still points at the retired mainnet hosts gets a warning on stderr. `config show` reports where the project ID came from, and `config init --network mainnet` says how to set it
- `versions` and `health` check the node against a minimum version (`minNode`) and the runtime `spec_version` exactly (`runtimeSpec`), instead of requiring one exact node version. Different operators run different compatible builds: Midnight's endpoints report node 1.0.400 and Blockfrost's mainnet node 2.1.0, both on runtime 1000300
- Support matrix refreshed for runtime 1.0.300 on all networks: node >= 1.0.300 (recommended 1.0.300, the newest public release), spec_version 1000300, ledger 8.1.2, indexer 4.3.5 (preview) and 4.3.302 (preprod/mainnet), `midnight-js-indexer-public-data-provider` 4.1.1
- Error map stamped for ledger 8.1.2 and gains code 211 (`MerkleTreeError`, system transactions); the node's code table is otherwise unchanged since node 0.22.5
- Live check: node and proof-server numbers in Midnight's matrix that differ from the bundled ones are reported as `upstream-differs` (info), since those components are checked against the live network

### Support matrix
- `versions`, `matrix` and `health` judge against Midnight's published support matrix (`midnightntwrk/midnight-docs`), fetched with a 3-second timeout and cached for six hours in `~/.cache/midnight-cast/`, so they stay current between releases. It updates the indexer, on-chain runtime and Compact runtime; node, proof server, runtime `spec_version`, ledger and indexer API stay as bundled, since those are checked live or aren't in the published file. A local `support-matrix.json` override still comes first, and the bundled matrix is used when offline or when nothing can be fetched
- The output says which matrix was used (`Matrix:` line, `matrixSource` in JSON), and shows disagreements inside the published file, such as mainnet's node `tag` 1.0.400 against `containerTag` 1.0.300, as notes (`matrixNotes`)
- `--offline` (or `MN_OFFLINE=1`) uses the bundled matrix; `--refresh-matrix` refetches even with a fresh cache
- A failed fetch isn't retried for an hour, and a cached copy stands in for it only if it is under a week old and not older than the bundled matrix. The staleness warning still tracks the bundled matrix's age, since node, runtime spec and ledger come from it
- The published-matrix parser is shared by the CLI and the live check, which runs the CLI with `--offline` so it still judges the matrix that ships

### Decode
- `decode --raw` recognises messages from current tooling and explains them, with `kind: "message"` and a `next` step: `UnsupportedBlockVersion(1000300)` from toolkit 1.0.0 or node 1.0.2 (upgrade to 1.0.300), Blockfrost's missing and invalid project token responses, the retired mainnet hosts, and output from Compact 0.35 / Compact runtime 0.20, which target ledger 9 (run `compact update 0.31` for the public networks)
- `OutOfDustValidityWindow` (171) notes the indexer bug, fixed in 4.3.4 and 4.3.5, that rejected the first transaction of a block, and the deserialization codes (0–11) note ledger 8.1.2's stricter encoding rules
- The ledger code map was checked against node 1.0.300 and matches all 120 codes. The new codes in node 2.x aren't added, since they arrive only with a runtime upgrade
- Codes 117 (NotNormalized), 138 (BalanceCheckOverspend) and 170 (InvalidDustSpendProof) carry the fuller, devnet-verified descriptions and fixes from Midnight Expert's status-codes catalog, credited in `NOTICE`
- Code 208 (InvalidBasisPoints) said the valid range was 0-9999; the ledger accepts up to 10000

### Tests & CI (recorded responses)
- Recorded preview and preprod responses for every request midnight-cast makes, plus each indexer's GraphQL schema, live in `test/fixtures/` and are replayed through the real commands in the unit tests. Every output is checked against the published JSON Schemas and every indexer query against the recorded schema. `npm run fixtures` re-records them
- `live.yml` re-records on the usual triggers and fails on schema drift: a request no longer made or newly made, a changed status, a field that disappeared or changed type, or a changed indexer schema

### Tests & CI (error codes)
- `npm run error-codes` checks the ledger error map against midnight-node at the release the support matrix names, and against a pinned Midnight Expert catalog. It runs with the live checks, so a runtime upgrade that changes the code table fails before a release. Midnight Expert's entries for seven codes still live on runtime 1.0.300 are marked retired upstream; that is reported as midnightntwrk/midnight-expert#272

### Fixes
- `tx --json` printed `"segments": null` for successful transactions, because the indexer returns null rather than an empty list, and that broke the published `tx` schema. `segments` is now left out when there are none. Found by the recorded preview responses
- `decode --raw` no longer reads short words as hex codes ("a block" decoded as code 10, and "after 10 retries" as code 16), and no longer decodes "Invalid Transaction" as ledger code 1 `Transaction`. "Ledger N" counts as a code only when labelled ("ledger error 9", "ledger code 9"), so "targets ledger 9" and "ledger 8.1.2" are no longer read as codes
- An HTTP 429 from an RPC or indexer endpoint gets a rate-limiting hint instead of the generic "rejected the request"
- `dust-event` and `dust-events` no longer repeat "Indexer WS unreachable" twice in their error
- `dust-event` and `dust-events` exit right after a subscription times out. They used to keep reconnecting in the background, hang until the operating system gave up on a pending connection, or crash with an unhandled promise rejection
- Failed commands print their report in human mode: `ping` with a service down, `health` when unhealthy and `tip --fail-on-lag` while lagging used to print nothing and only exit 1
- Local package checks compare only exact versions (from `package-lock.json` or an exact pin) against the matrix. A range such as `^8.1.0` used to be compared as if it were the installed version; without a lockfile it is now listed as not resolved
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
