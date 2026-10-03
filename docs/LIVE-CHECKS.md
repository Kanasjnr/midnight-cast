# Live network checks

midnight-cast answers questions about live Midnight networks, so its tests have to look at those networks too. The trick is to keep two kinds of failure apart. A code regression should turn a pull request red. A network upgrade or outage should not block everyday work, because nothing in the pull request caused it, but it must stop a release, and someone needs to hear about it quickly. The CI is split along that line, and it follows the branch workflow: issue branches merge into `next-release`, and `next-release` is released by merging into `main`.

## Pull requests into next-release

`.github/workflows/test.yml` runs the unit suite on Linux, macOS and Windows against Node 20, 22 and 24, plus a typecheck covering `src/` and the TypeScript scripts in `scripts/`. The unit tests never touch the network or the wall clock, so they only fail for code reasons. That is all these pull requests run. A preprod outage can't block feature work.

## Releases: pull requests into main

A release pull request from `next-release` into `main` runs everything above and then the live checks, which are required checks in `main`'s branch protection. The live smoke suite (in `live.yml`, alongside the drift check) runs against preview, preprod and mainnet. It asserts things that should hold whatever version a network runs: the RPC and indexer answer, the node's runtime `specVersion` matches the indexer's `protocolVersion`, the JSON output has the expected shape, and a known preprod transaction decodes. The live drift check (in `live.yml`, described below) runs for each network. It fails when the bundled support matrix disagrees with what a network is actually running, when node and indexer disagree, or during an outage. So a release can't ship a matrix that no longer matches the real networks, and it can't ship while a network is down and the release can't be verified. Midnight's published matrix is treated as the truth only for components the public endpoints don't reveal (indexer, on-chain runtime and compact runtime), so it blocks a release when it is ahead of the bundled matrix for those. For node and proof server, which we can observe, Midnight's matrix being ahead is only a warning: Midnight can publish a version before a network runs it, and blocking on that would leave no matrix that could pass. Because the published matrix can block, a release check that can't fetch it after retries fails as incomplete; re-run it.

When an outage blocks a release, report it to Midnight's service desk (`midnightntwrk/servicedesk`, bug-report form), then re-run the checks once the network recovers. Repository admins can still override branch protection in an emergency.

`live.yml` starts on every pull request into `main`, with no path filter, because a required check whose workflow never starts would leave the release waiting forever.

## The scheduled live check

`live.yml` also runs every six hours, on every push to `main`, and on demand from the Actions tab for one network or all of them. For each network, `scripts/live-check.ts` runs the built CLI (`health` and `versions --json`). It fetches the support matrix Midnight publishes in `midnightntwrk/midnight-docs`, then compares three things: what the network is running, what midnight-cast bundles, and what the upstream matrix says.

Each finding is classified, and the classification decides what happens:

| Finding | Meaning | Scheduled run | Release PR |
| --- | --- | --- | --- |
| outage | A required service still failed after three attempts | Job fails, issue opened | Blocks |
| bundled-drift | The live network doesn't satisfy the bundled matrix: node below `minNode`, a different runtime spec, a different proof server, or an unexpected indexer API (the same checks `midnight-cast versions` runs) | Issue opened | Blocks |
| upstream-ahead | Midnight's matrix lists a different indexer, on-chain runtime or compact runtime than the bundled one (components the endpoints don't reveal) | Issue opened | Blocks |
| upstream-differs | Midnight's matrix lists a different node or proof server than the bundled one. These are checked against the live network instead, and Midnight can list versions a network doesn't run yet, or that have no public release | Reported only | Reported only |
| protocol-split | Node and indexer disagree on the protocol version | Issue opened | Blocks |
| upstream-lag | Midnight's own matrix is behind the live network | Reported only | Reported only |

`scripts/live-issue.ts` keeps one issue per network, titled `Live check: <network>` and labelled `live-check`. The issue is edited only when the findings change, tracked by a fingerprint stored in the issue body. It is closed automatically once the network is clean again. The report and a JSON result are also attached to each run as an artifact and shown in the job summary. Pull request runs never touch issues. Scheduled runs fire only from the default branch, so the schedule takes effect once this workflow reaches `main`.

## Error codes

`live.yml` also runs `npm run error-codes` (`scripts/error-code-parity.ts`) on the same triggers. It reads the `LedgerApiError` table from the midnight-node source at the release the bundled support matrix names for mainnet (`node-1.0.300` today) and fails if `src/data/error-codes.json` is missing a code, has one the node doesn't, or names one differently. Error codes come from the on-chain runtime, so the node's release tag, not `main`, is the reference: `main` can already carry the next runtime's codes. During a rollout, when preview or preprod runs a newer node than mainnet, the map keeps following mainnet and the check notes which codes the newer table adds or removes, so a staggered upgrade doesn't block releases.

It also compares Midnight Expert's status-codes catalog, pinned to a commit in the script, and fails if it names a code differently. Codes that catalog marks retired while the deployed node still emits them, and codes the node doesn't emit yet, are only noted; the first is reported upstream as midnightntwrk/midnight-expert#272. Moving the pin is a deliberate change: update `MIDNIGHT_EXPERT_REF` and rerun the check.

Fetches are retried. If the sources still can't be read, or the node file no longer contains the table the parser expects, the check exits 2 and says it is incomplete rather than reporting drift; re-run it, or update the parser if the table has moved. A scheduled run that finds drift shows as a failed run rather than opening an issue.

## Recorded responses

`test/fixtures/<network>/` holds what preview and preprod returned for every request midnight-cast makes: RPC calls, indexer GraphQL queries, the proof server, and a DUST subscription. It also holds each indexer's GraphQL schema from introspection. The unit tests replay them through the real commands, with `fetch` answered from the fixtures and a local WebSocket server standing in for the indexer. They check that every output matches the published JSON Schemas and that every query midnight-cast sends is valid against the recorded indexer schema. A request with no recorded response fails the test, so a new query can't ship unrecorded.

`npm run fixtures` re-records them (`--discover` picks a fresh transaction with DUST events instead of the recorded one). `live.yml` runs `npm run fixtures -- --check` on the same triggers as the other live checks. It re-records into memory and compares shapes, keys and value types rather than values, plus the indexer schema. It fails on schema drift: a request midnight-cast no longer makes, a new one, a changed status, a field that disappeared or changed type, or any change to the GraphQL schema. A field that is null on one run and set on another isn't drift. When it fails, re-record, review the diff, and fix any parser it affects.

## Mainnet and Blockfrost

Midnight retired its hosted mainnet RPC and indexer on 30 September 2026. Blockfrost now serves both, and every request needs a Midnight Mainnet project token. To enable the mainnet checks, create a project for the Midnight Mainnet network on [blockfrost.io](https://blockfrost.io). Then add its project ID as the repository secret `BLOCKFROST_MAINNET_PROJECT_ID` (Settings → Secrets and variables → Actions).

The composite action `.github/actions/blockfrost-mainnet` exports the secret as `BLOCKFROST_PROJECT_ID`, exactly as a user would, and masks it in logs. Every report is also scrubbed of `project_id` values before it is written, uploaded or posted to an issue. On scheduled runs without the secret, mainnet is reported as skipped (a notice plus a line in the job summary), never as passed. On release pull requests and pushes to `main` the secret is mandatory, and its absence fails the check, so neither a required check nor a post-merge run can pass without having looked at mainnet. Release pull requests come from `next-release` in this repository, so they have access to the secret.

None of this needs a wallet, DUST or NIGHT. midnight-cast only reads from the networks.

## Running it locally

```bash
npm run build
npm run live-check -- preprod --out live-check
INTEGRATION=1 npm run test:smoke
```

`live-check` exits 0 when clean, 10 on drift and 20 on an outage. It exits 2 on a usage or internal error, or when the upstream matrix still can't be fetched after retries: a verdict without it would be incomplete, so the issue is left unchanged. To check mainnet locally, export `BLOCKFROST_PROJECT_ID`.
