# Live network checks

midnight-cast answers questions about live Midnight networks, so its tests have to look at those networks too. The trick is to keep two kinds of failure apart. A code regression should turn a pull request red. A network upgrade or outage should not block everyday work, because nothing in the pull request caused it, but it must stop a release, and someone needs to hear about it quickly. The CI is split along that line, and it follows the branch workflow: issue branches merge into `next-release`, and `next-release` is released by merging into `main`.

## Pull requests into next-release

`.github/workflows/test.yml` runs the unit suite on Linux, macOS and Windows against Node 20, 22 and 24, plus a typecheck covering `src/` and the TypeScript scripts in `scripts/`. The unit tests never touch the network or the wall clock, so they only fail for code reasons. That is all these pull requests run. A preprod outage can't block feature work.

## Releases: pull requests into main

A release pull request from `next-release` into `main` runs everything above and then the live checks, which are required checks in `main`'s branch protection. The live smoke suite (in `live.yml`, alongside the drift check) runs against preview, preprod and mainnet. It asserts things that should hold whatever version a network runs: the RPC and indexer answer, the node's runtime `specVersion` matches the indexer's `protocolVersion`, the JSON output has the expected shape, and a known preprod transaction decodes. The live drift check (in `live.yml`, described below) runs for each network. It fails when the bundled support matrix disagrees with what a network is actually running, when node and indexer disagree, or during an outage. So a release can't ship a matrix that no longer matches the real networks, and it can't ship while a network is down and the release can't be verified. Midnight's published matrix is treated as the truth only for components the public endpoints don't reveal (indexer, on-chain runtime and compact runtime), so it blocks a release when it is ahead of the bundled matrix for those. For node and proof server, which we can observe, Midnight's matrix being ahead is only a warning: Midnight can publish a version before a network runs it, and blocking on that would leave no matrix that could pass. Because the published matrix can block, a release check that can't fetch it after retries fails as incomplete; re-run it.

When an outage blocks a release, report it to Midnight's service desk (`midnightntwrk/servicedesk`, bug-report form), using the draft in the `Live check: <network>` issue (see [Service desk drafts](#service-desk-drafts)), then re-run the checks once the network recovers. Repository admins can still override branch protection in an emergency.

`live.yml` starts on every pull request into `main`, with no path filter, because a required check whose workflow never starts would leave the release waiting forever.

## The scheduled live check

`live.yml` also runs every six hours, on every push to `main`, and on demand from the Actions tab for one network or all of them. For each network, `scripts/live-check.ts` runs the built CLI (`health` and `versions --json`). It fetches the support matrix Midnight publishes in `midnightntwrk/midnight-docs`, then compares three things: what the network is running, what midnight-cast bundles, and what the upstream matrix says.

Each finding is classified, and the classification decides what happens:

| Finding | Meaning | Scheduled run | Release PR |
| --- | --- | --- | --- |
| outage | A required service still failed after three attempts | Job fails, issue opened | Blocks |
| bundled-drift | The live network doesn't satisfy the bundled matrix: node below `minNode`, a different runtime spec, a proof server other than the bundled version or a newer patch of it, or an unexpected indexer API (the same checks `midnight-cast versions` runs) | Issue opened | Blocks |
| upstream-ahead | Midnight's matrix lists a different indexer, on-chain runtime or compact runtime than the bundled one (components the endpoints don't reveal) | Issue opened | Blocks |
| upstream-differs | Midnight's matrix lists a different node or proof server than the bundled one. These are checked against the live network instead, and Midnight can list versions a network doesn't run yet, or that have no public release | Reported only | Reported only |
| protocol-split | Node and indexer disagree on the protocol version | Issue opened | Blocks |
| rpc-inconsistent | Consecutive `chain_getHeader` calls returned a head more than two blocks below one already seen, the sign of a lagging node behind a load-balanced RPC. The network is then **degraded** | Issue opened, job warns | Reported only |
| upstream-lag | Midnight's own matrix is behind the live network | Reported only | Reported only |

Once the retries settle, and unless the network is in an outage, the check also asks the RPC for its head ten times, two seconds apart, to catch the degraded case above. That adds about 20 seconds to each network's check.

`scripts/live-issue.ts` keeps one issue per network, titled `Live check: <network>` and labelled `live-check`. The issue is edited when the findings change, tracked by a fingerprint stored in the issue body, and a comment says so. While it carries a service desk draft, every run also refreshes the draft's evidence and last-seen time, without a comment. It is closed automatically once the network is clean again. A degraded network can come and go between runs, so its issue stays open until a day has passed without seeing the problem; otherwise each sighting would open a new issue. The report and a JSON result are also attached to each run as an artifact and shown in the job summary. Pull request runs never touch issues. Scheduled runs fire only from the default branch, so the schedule takes effect once this workflow reaches `main`. An issue for a degraded network also carries the `live-check: degraded` label. An issue with both that label and a degraded status in its body doesn't block `npm publish`, because the problem is Midnight's to fix and doesn't make a release wrong; drift and outages do.

### Service desk drafts

When the check confirms an outage, or sees the RPC's head go backwards (even alongside drift), its report ends with a draft for Midnight's service desk, in the bug-report form's layout, so a maintainer can review it and file it without rewriting it. It covers an unreachable RPC or indexer, an indexer behind the node or an RPC behind the indexer, and an RPC whose head goes backwards. Each draft has:

- the suggested form fields and the labels the triage bot makes from them: `network:*`, `component:midnight-node` or `component:indexer`, and a priority. P1 is suggested only when both the RPC and the indexer are down, with a reminder to confirm the network is down from elsewhere and to page Midnight, as P1 requires. A single unreachable service is P2, and lag or a backwards head is P3;
- expected and actual behaviour, with the numbers from the failing attempt;
- `curl` commands that reproduce the failure with nothing else installed. On mainnet they send the project ID from `$BLOCKFROST_PROJECT_ID` rather than containing it;
- every attempt's raw result from `health --json`, which lists each service even when one is down: the time, each service's status, latency, error kind and message, and the heights, or the head samples. The description counts only the attempts that had the problem;
- when the problem was first and last seen. The first time is kept in the issue for each failing service, and for lag and a backwards head, so it dates from the first run that saw it, survives a change in which services fail, and isn't borrowed by a different problem. Each draft also says how the check was started: by the schedule, another GitHub Actions trigger, or by hand.

On mainnet, a Blockfrost 401, 402, 403 or 429 means our project ID or our plan's limit, not Midnight. The report says so and leaves that service out of the drafts, while anything else that failed is still drafted. Redaction leaves `$BLOCKFROST_PROJECT_ID` in the reproductions alone, so they still run.

Nothing is ever filed automatically. Midnight's [AI reporting guidelines](https://github.com/midnightntwrk/servicedesk/blob/main/ai-reports.md) need a person to re-run the commands, check the numbers and stand behind the report, and a P1 needs a page that a bot can't make. The draft's pre-submission checklist is left unticked for that reason.

## Error codes

`live.yml` also runs `npm run error-codes` (`scripts/error-code-parity.ts`) on the same triggers. It reads the `LedgerApiError` table from the midnight-node source at the release the bundled support matrix names for mainnet (`node-1.0.400` today) and fails if `src/data/error-codes.json` is missing a code, has one the node doesn't, or names one differently. Error codes come from the on-chain runtime, so the node's release tag, not `main`, is the reference: `main` can already carry the next runtime's codes. During a rollout, when preview or preprod runs a newer node than mainnet, the map keeps following mainnet and the check notes which codes the newer table adds or removes, so a staggered upgrade doesn't block releases.

It also compares Midnight Expert's status-codes catalog, pinned to a commit in the script, and fails if it names a code differently. Codes that catalog marks retired while the deployed node still emits them, and codes the node doesn't emit yet, are only noted; the first is reported upstream as midnightntwrk/midnight-expert#272. Moving the pin is a deliberate change: update `MIDNIGHT_EXPERT_REF` and rerun the check.

Fetches are retried. If the sources still can't be read, or the node file no longer contains the table the parser expects, the check exits 2 and says it is incomplete rather than reporting drift; re-run it, or update the parser if the table has moved. A scheduled run that finds drift shows as a failed run rather than opening an issue.

## Midnight's examples

`versions` and `health` show whether Midnight's own examples pass on the node a network runs, from the regression reports in [midnight-examples](https://github.com/midnightntwrk/midnight-examples/tree/main/reports). They fetch the report at run time, but fall back to summaries bundled in `src/data/examples-reports.json`. `live.yml` runs `npm run examples-reports -- --check` on the same triggers as the other live checks. It lists the reports, summarises each one, and fails when a report was added, changed or removed since the bundled summaries were written, or when a report no longer has the fields midnight-cast quotes. `npm run examples-reports` rewrites the summaries; review the diff before committing it. If the reports can't be read at all, the check exits 2 and says it is incomplete.

A separate job, "Examples index", checks the examples index (`src/data/examples-index.json`, used by `midnight-cast examples`) against the midnight-examples commit it's pinned to. It fails if the committed index differs from what that commit renders. When the repository's `main` has moved past the pin, it adds a warning to the run, with any change to the examples' pinned toolchain. Moving the pin is a deliberate change: update `COMMIT` in `scripts/examples-index.ts`, run `npm run examples-index`, and review the diff.

## Recorded responses

`test/fixtures/<network>/` holds what preview, preprod and mainnet returned for every request midnight-cast makes: RPC calls, indexer GraphQL queries, the proof server, and a DUST subscription. It also holds each indexer's GraphQL schema from introspection. The unit tests replay them through the real commands, with `fetch` answered from the fixtures and a local WebSocket server standing in for the indexer. They check that every output matches the published JSON Schemas and that every query midnight-cast sends is valid against the recorded indexer schema. A request with no recorded response fails the test, so a new query can't ship unrecorded.

`npm run fixtures` re-records them (`--discover` picks a fresh transaction with DUST events instead of the recorded one). Mainnet is recorded through Blockfrost and needs `BLOCKFROST_PROJECT_ID`; without it mainnet is skipped with a note. Only response bodies are stored, never request headers or URLs, and the recorder refuses to write a fixture that contains the project ID. The CI job gets the ID the same way the smoke job does, so mainnet is required on release pull requests and pushes to `main`. `live.yml` runs `npm run fixtures -- --check` on the same triggers as the other live checks. It re-records into memory and compares shapes, keys and value types rather than values, plus the indexer schema. It fails on schema drift: a request midnight-cast no longer makes, a new one, a changed status, a field that disappeared or changed type, or any change to the GraphQL schema. The DUST subscription's events are compared the same way. A field that is null, or a list that is empty, on one side isn't drift, but the path is listed as not compared, so a shape hidden behind a recorded null can't pass unnoticed. A server error from an endpoint is an outage, not drift: the check exits 2 and asks for a re-run. If a network was reset and the recorded transaction no longer exists, the check finds a fresh one and carries on. When it reports drift, re-record, review the diff, and fix any parser it affects.

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

`live-check` exits 0 when clean, 10 on drift, 20 on an outage and 30 when the network is degraded. It exits 2 on a usage or internal error, or when the upstream matrix still can't be fetched after retries: a verdict without it would be incomplete, so the issue is left unchanged. To check mainnet locally, export `BLOCKFROST_PROJECT_ID`.
