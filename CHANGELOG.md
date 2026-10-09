# Changelog

## Unreleased


### New commands
- `examples [topic]` finds working code in Midnight's official examples (`midnightntwrk/midnight-examples`) for a topic in your own words, such as "DUST sponsorship", "send shielded tokens" or "verify a signature in a circuit". It returns the examples that show it, with files, line ranges, links pinned to a commit and the code, or lists every example without a topic. It works offline from an index pinned to one commit, which `live.yml` checks and notes when the repository moves on. Agents get it as the `examples` MCP tool and the `midnight-cast://examples` resource, and the guidance tells them to start from these examples rather than writing Midnight code from memory
- `preflight [network] [--address <address>]` checks you can send a first transaction: the network answers and is in sync, the proof server answers at the version the matrix expects, and the wallet holds NIGHT registered for DUST generation. Unshielded addresses (`mn_addr_…`) are read from the indexer's per-address UTXO history; Cardano reward addresses use the `dust-status` query. When Midnight's examples have run on the network, it quotes how long a first wallet sync and a pre-seed restore took, and the faucet. It reads only, and the MCP server has it as the `preflight` tool
- `agents init` prints the guidance that teaches an AI coding agent to use midnight-cast, or with `--write` adds it to the project's `AGENTS.md`, `CLAUDE.md` or `GEMINI.md`. Only a marked section is ever changed, and an existing file is changed only after confirmation or `--yes`
- A portable agent skill, `skills/midnight-cast/SKILL.md`, installs with `npx skills add Kanasjnr/midnight-cast --skill midnight-cast`. It and the three snippets in `docs/agents/` are generated from one source (`npm run agent-files`), and a test fails if they drift. `docs/agents/EVALS.md` has diagnosis tasks for running the guidance in Claude Code, Codex and Gemini CLI
- `contract <address> [network]` looks up a deployed contract: whether it exists, its latest action (deploy, call or update) and the circuit a call ran, the deploy transaction and block, unshielded balances, and the state's size and sha256 (`--state` for the full hex). The MCP server has it as the `contract` tool
- `dust-status <addresses...>` shows DUST generation for Cardano reward addresses: registration, NIGHT balance, generation rate, and current and maximum capacity. The MCP server has it as the `dust_status` tool
- Both have JSON Schemas and recorded fixtures. The fixture recorder looks for a contract over at most 300 recent blocks, pausing between queries, so one run can't flood a public network
### Breaking changes
- `--json` output is a versioned envelope: `{ schemaVersion, ok, command, network, data, warnings, error, next }`. `error` is now an object, `{ message, kind, hint }`, instead of a string, and the top-level `errorKind` and `hint` moved inside it as `kind` and `hint`. Read `error.message` where you read `error` before. Any later breaking change to the JSON bumps `schemaVersion`
- Usage errors (an unknown command or option, a missing argument or subcommand) exit `2` instead of `1`

### Agents & JSON
- midnight-cast is listed in the MCP Registry as `io.github.Kanasjnr/midnight-cast`. `package.json` has the `mcpName` the registry checks, `server.json` describes the npm package with `mcp` as its argument and `BLOCKFROST_PROJECT_ID` (secret) and `MIDNIGHT_CAST_NETWORKS` as optional settings, and `publish.yml` lists each version after `npm publish` with GitHub's OIDC login. `npm version` keeps `server.json` at the package's version, and a test checks the entry against the registry's schema
- `versions` compares a project with the toolchain Midnight's examples are pinned to, as advice next to the matrix checks (`examplesToolchain` in JSON): `midnight-js`, `testkit-js`, the wallet SDK, the `pragma language_version` in its `.compact` files and its Node.js version. It checks only what the project declares and doesn't change the exit code
- `explain sync` answers "why is my wallet sync so slow?" with the first-sync and pre-seed times from the examples' latest regression report, so they move with each run, and `explain dust` and `explain sync` end with working code from the examples. The agent guidance names the new topic, and the plugin evals gain a task where the agent should build on the examples' DUST sponsorship code
- `versions` and `health` say whether Midnight's own examples pass on the node a network runs, from the regression reports in `midnightntwrk/midnight-examples` (`examples` in JSON: status, test counts, network, date, verdict, known issues and a link). A node version with no report is unverified rather than matched to an older one, and so is a run on another network or runtime: the reports cover preprod, so mainnet and preview show that run for context only. Reports are fetched for the exact version and cached, with bundled summaries as the fallback, and `source` says which was used. The MCP tools, their instructions and the agent guidance tell agents to look at the user's code first when the examples pass on a healthy network
- When the RPC or indexer is down, `health --json` lists every service with its status, `detail` and `errorKind` instead of returning `data: null`, and says which service failed ("Required services unreachable: rpc"). `sync` and `versions` are absent in that case, since they couldn't be measured
- A Claude Code plugin, installed with `claude plugin marketplace add Kanasjnr/midnight-cast` and `claude plugin install midnight-cast@midnight-cast`, bundles the midnight-cast skill, the MCP server and a `/midnight-cast:diagnose <network> [tx or error]` command. It asks for an optional Blockfrost project ID for mainnet and keeps it in secure storage, falling back to an exported `BLOCKFROST_PROJECT_ID`, and a missing-ID error tells plugin users where the option is. The plugin's version and the server it starts follow the package version. Its files are generated with the other agent files, and `plugins/midnight-cast/evals/` runs the four diagnosis tasks as a `claude plugin eval` suite against mocked tool answers
- `midnight-cast mcp` runs a read-only MCP server on stdio, built on the official MCP TypeScript SDK (v2). It answers both the `initialize` handshake today's clients use and the stateless 2026-07-28 protocol, including `server/discover`, and exits as soon as the client disconnects. Its tools (`health`, `ping`, `tip`, `versions`, `block`, `tx`, `dust_event`, `dust_events`, `decode`, `explain`) run the matching commands and return the `--json` envelope as structured content, with typed inputs and read-only annotations. Instructions sent at connection tell the model how to use them, and three prompts (`diagnose-error`, `check-network`, `investigate-transaction`) start the usual investigations, with network names completed. The support matrix, error codes and CLI command catalog are resources. `MIDNIGHT_CAST_NETWORKS` limits the networks the model may query (built-in ones, or ones defined in `config.toml`), the model can't supply endpoint URLs, each call keeps its own warnings, and the Blockfrost project ID from `BLOCKFROST_PROJECT_ID` is redacted from every response. Network tools are rate-limited (30 calls a minute by default, `MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE`), returning the new error kind `rate_limited` over budget. Error hints that would name CLI flags tell MCP users what to do instead. Setup for Claude Code, Codex, Gemini CLI, Cursor, VS Code, Windsurf and generic clients is in `docs/MCP.md`
- Each `next` step that is also an MCP tool call needing nothing filled in carries `tool: { name, arguments }`, so agents without a terminal can follow it
- `versions --project-dir <dir>` (the `projectDir` tool parameter over MCP) checks another project's packages, and the report's `localProject` says which directory was checked and whether it had a `package.json`; human output says when nothing was checked
- In the `explain --json` catalog, `outputSchema` is absent for `mcp`, which prints no envelope. Over MCP, `explain` takes a required topic, and the catalog is the `midnight-cast://catalog` resource
- `next` lists follow-up commands, spelled `midnight-cast …`: `decode` points at the ledger code inside a 1010 and at `explain` topics, `tx` at `decode --raw` for a failed segment and at `dust-event` for each DUST event, a failed `health` at `ping` or `tip`, and an unreachable configured endpoint at `config show`. Suggestions keep any endpoint overrides, but never the project ID
- `ping`, `health`, `tip` and `versions` failures say what failed, e.g. "Required services unreachable: rpc" or "Indexer is 120 blocks behind the node (threshold 100)", instead of no message
- Warnings, such as a config pointing at the retired mainnet hosts, are included in the envelope's `warnings` as well as printed on stderr in human mode
- With `--json`, a usage error prints an envelope with `error.kind: "usage"` and commander's suggestion as the hint
- `explain --json` with no topic returns a catalog of every command, generated from the CLI definition: usage, arguments, options, whether it is read-only, and its output schema, plus the global options, topics, exit codes and error kinds
- JSON Schemas for the envelope and each command's data ship in `schemas/`, and the tests validate every command's output against them
- The `decode 1010` result has `kind: "substrate"`, like every other decoding
- Hints, error messages, `--help` and the docs say `midnight-cast` everywhere, matching the JSON output. `mn` still works as an alias, and the dev script is now `npm run cli`

### Tests & CI
- `live.yml` checks the bundled examples-report summaries against `midnightntwrk/midnight-examples` and fails when a report is added, changed or removed, so they're refreshed with `npm run examples-reports`
- When the live check confirms an outage or a degraded network, the `Live check: <network>` issue carries a draft for Midnight's service desk in its bug-report form's layout: suggested fields and labels (P1 only when both RPC and indexer are down, with a reminder to page), expected and actual behaviour, `curl` reproductions that keep the Blockfrost project ID out, every attempt's raw result, and first and last seen times kept across runs for each failing service. On mainnet, a Blockfrost 401, 402, 403 or 429 is reported as our project ID or plan, not drafted. Nothing is filed automatically. The check also samples the RPC head and reports a load-balanced RPC whose head goes backwards as a new **degraded** status (exit 30). Its issue is labelled `live-check: degraded`, stays open until a day passes without the problem, and blocks neither a release nor `npm publish`
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
- The proof server passes on the matrix's version or a newer patch of the same major and minor, in `ping`, `health`, `versions`, `preflight` and the live check. Proof server 8.1.3, released with ledger 8.1.3's security fix, no longer fails against a matrix that lists 8.1.0, and the check says it's a newer patch
- Node 1.0.400, now publicly released, is the recommended and minimum node on preview, preprod and mainnet, and the networks' ledger is 8.1.3. 1.0.400 carries the fix for the critical ledger advisory GHSA-wr7g-rr4v-jmj8, and nodes on ledger 8.1.2 disagree with the network about which contract calls are valid. A node below the minimum now fails `versions` and `health` with that reason, which the matrix row holds (`minNodeReason`). The error map is checked against node-1.0.400 and is unchanged. Project package pins stay as they were: Midnight.js 4.1.1 still builds on ledger 8.1.0, and the release notes say DApps have nothing to change
- `versions`, `matrix` and `health` judge against Midnight's published support matrix (`midnightntwrk/midnight-docs`), fetched with a 3-second timeout and cached for six hours in `~/.cache/midnight-cast/`, so they stay current between releases. It updates the indexer, on-chain runtime and Compact runtime; node, proof server, runtime `spec_version`, ledger and indexer API stay as bundled, since those are checked live or aren't in the published file. A local `support-matrix.json` override still comes first, and the bundled matrix is used when offline or when nothing can be fetched
- The output says which matrix was used (`Matrix:` line, `matrixSource` in JSON), and shows disagreements inside the published file, such as mainnet's node `tag` 1.0.400 against `containerTag` 1.0.300, as notes (`matrixNotes`)
- `--offline` (or `MN_OFFLINE=1`) uses the bundled matrix; `--refresh-matrix` refetches even with a fresh cache
- A failed fetch isn't retried for an hour, and a cached copy stands in for it only if it is under a week old and not older than the bundled matrix. The staleness warning still tracks the bundled matrix's age, since node, runtime spec and ledger come from it
- The published-matrix parser is shared by the CLI and the live check, which runs the CLI with `--offline` so it still judges the matrix that ships

### Decode
- Where Midnight's examples show the fix, a decoding links the code: stale-DUST errors (170, 171, 196) to hello-world's wallet sync, a fee beyond the available DUST (138) to private-party's DUST sponsorship, a token balance error (126) to token-transfers' `sendToUser`, and a contract-owned output left unclaimed (124) to its `receiveShieldedTokens`. Other codes link nothing. The wallet's "Insufficient Funds: could not balance dust", which the examples' UI explains to new users, is a new known message that links that explanation, the sponsorship and the wallet sync
- `Custom(182)` notes that a fresh mainnet sync on node 1.0.300 halts at block #1788979 with it (midnight-node#2229), and that node 1.0.400 resumes without a resync. The deserialization codes (0–11) also note ledger 8.1.3's rejection of non-canonical field values and `noop 0` in contract call transcripts. `UnsupportedBlockVersion(1000300)` now says to upgrade to node and toolkit 1.0.400
- `decode --raw` recognises messages from current tooling and explains them, with `kind: "message"` and a `next` step: `UnsupportedBlockVersion(1000300)` from toolkit 1.0.0 or node 1.0.2 (upgrade to 1.0.300), Blockfrost's missing and invalid project token responses, the retired mainnet hosts, and output from Compact 0.35 / Compact runtime 0.20, which target ledger 9 (run `compact update 0.31` for the public networks)
- `OutOfDustValidityWindow` (171) notes the indexer bug, fixed in 4.3.4 and 4.3.5, that rejected the first transaction of a block, and the deserialization codes (0–11) note ledger 8.1.2's stricter encoding rules
- The ledger code map was checked against node 1.0.300 and matches all 120 codes. The new codes in node 2.x aren't added, since they arrive only with a runtime upgrade
- Codes 117 (NotNormalized), 138 (BalanceCheckOverspend) and 170 (InvalidDustSpendProof) carry the fuller, devnet-verified descriptions and fixes from Midnight Expert's status-codes catalog, credited in `NOTICE`
- Code 208 (InvalidBasisPoints) said the valid range was 0-9999; the ledger accepts up to 10000

### Release
- Standalone binaries, built with Bun, ship beside the npm package: Linux (glibc and musl, x64 and arm64), macOS (x64 and arm64) and Windows x64. `install.sh` and `install.ps1` download the one for this machine and check it against `SHA256SUMS` before installing. A musl system without `libstdc++` and `libgcc` is told to install them. `npm run binaries` builds them and `npm run smoke:binary` runs an archive the way a user gets it, including an installer download whose checksum doesn't match. `binaries.yml` builds each target where it works: Linux on Linux, macOS on macOS, which signs them (Apple silicon won't run a binary whose signature doesn't verify), and Windows on Windows (one cross-compiled on Linux crashed). It smokes each binary on its own OS and architecture; `publish.yml` runs that again, records build provenance and attaches the archives to the GitHub release. The container smokes pull Docker's official Alpine and Debian images from AWS's mirror, since Docker Hub rate-limits shared CI runners
- A release can only publish a package that works once installed. `npm run smoke:tarball` packs midnight-cast as npm would, checks that every data file, schema and notice ships and that no source, test or fixture does, installs it into an empty project, and runs both `midnight-cast` and `mn` through `npx`, validating their JSON against the shipped schemas. `tarball.yml` runs it on Node 20, 22 and 24 and on Windows for release pull requests, and `publish.yml` runs it again before publishing
- `publish.yml` also requires a successful live check on `main` within the last 24 hours
- `docs/RELEASING.md` describes the release, from refreshing the bundled data to checking the published package
- The build's data copy step is TypeScript (`scripts/copy-data.ts`)

### Tests & CI (recorded responses)
- Recorded preview, preprod and mainnet (Blockfrost) responses for every request midnight-cast makes, plus each indexer's GraphQL schema, live in `test/fixtures/` and are replayed through the real commands in the unit tests. Every output is checked against the published JSON Schemas and every indexer query against the recorded schema. `npm run fixtures` re-records them
- `live.yml` re-records on the usual triggers and fails on schema drift: a request no longer made or newly made, a changed status, a field that disappeared or changed type, or a changed indexer schema

### Tests & CI (error codes)
- `npm run error-codes` checks the ledger error map against midnight-node at the release the support matrix names, and against a pinned Midnight Expert catalog. It runs with the live checks, so a runtime upgrade that changes the code table fails before a release. Midnight Expert's entries for seven codes still live on runtime 1.0.300 are marked retired upstream; that is reported as midnightntwrk/midnight-expert#272

### Fixes
- `dust-events` without `--from` widens its window until it holds the requested number of events or reaches the first id, so gaps in the ids don't shorten the list
- Over MCP, `tip` reports a lagging indexer in its data instead of failing, and `versions` next steps don't map to a tool call, since the call would check the packages of wherever the server was started
- `dust-events` without `--from` lists the latest events instead of the network's first ones, and `dust-event` for an id the network hasn't reached fails at once, naming the latest id, instead of waiting out its 15 s timeout
- decode's fix for Blockfrost's missing-token response explains sending the project ID from any app, not only midnight-cast
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
- The README's "Using with AI agents" section, formerly "For agents and scripts", says what midnight-cast adds next to the Kapa answer engine and Midnight Expert, lists all 14 MCP tools, and spells out what an agent can and can't do with the server: every tool reads only, the networks can be limited, network calls are rate limited, and the Blockfrost project ID never reaches the model

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
