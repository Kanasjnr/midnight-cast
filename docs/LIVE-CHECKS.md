# Live network checks

midnight-cast answers questions about live Midnight networks, so its tests have to look at those networks too. The trick is to keep two kinds of failure apart. A code regression should turn a pull request red. A network upgrade or outage should not block everyday work, because nothing in the pull request caused it, but it must stop a release, and someone needs to hear about it quickly. The CI is split along that line, and it follows the branch workflow: issue branches merge into `next-release`, and `next-release` is released by merging into `main`.

## Pull requests into next-release

`.github/workflows/test.yml` runs the unit suite on Linux, macOS and Windows against Node 20, 22 and 24, plus a typecheck covering `src/` and the TypeScript scripts in `scripts/`. The unit tests never touch the network or the wall clock, so they only fail for code reasons. That is all these pull requests run. A preprod outage can't block feature work.

## Releases: pull requests into main

A release pull request from `next-release` into `main` runs everything above and then the live checks, which are required checks in `main`'s branch protection. The live smoke suite (in `test.yml`) runs against preview, preprod and mainnet. It asserts things that should hold whatever version a network runs: the RPC and indexer answer, the node's runtime `specVersion` matches the indexer's `protocolVersion`, the JSON output has the expected shape, and a known preprod transaction decodes. The live drift check (in `live.yml`, described below) runs for each network, and any drift fails it. So a release can't ship a bundled support matrix that no longer matches the real networks, and it can't ship while a network is in an outage that would make the release unverifiable.

When an outage blocks a release, report it to Midnight's service desk (`midnightntwrk/servicedesk`, bug-report form), then re-run the checks once the network recovers. Repository admins can still override branch protection in an emergency.

`live.yml` starts on every pull request into `main`, with no path filter, because a required check whose workflow never starts would leave the release waiting forever.

## The scheduled live check

`live.yml` also runs every six hours, on every push to `main`, and on demand from the Actions tab for one network or all of them. For each network, `scripts/live-check.ts` runs the built CLI (`health` and `versions --json`). It fetches the support matrix Midnight publishes in `midnightntwrk/midnight-docs`, then compares three things: what the network is running, what midnight-cast bundles, and what the upstream matrix says.

Each finding is classified, and the classification decides what happens:

| Finding | Meaning | Scheduled run | Release PR |
| --- | --- | --- | --- |
| outage | A required service still failed after three attempts | Job fails, issue opened | Blocks |
| bundled-drift | The live network differs from the bundled matrix | Issue opened | Blocks |
| upstream-ahead | Midnight's matrix moved past the bundled one | Issue opened | Blocks |
| protocol-split | Node and indexer disagree on the protocol version | Issue opened | Blocks |
| upstream-lag | Midnight's own matrix is behind the live network | Reported only | Reported only |

`scripts/live-issue.ts` keeps one issue per network, titled `Live check: <network>` and labelled `live-check`. The issue is edited only when the findings change, tracked by a fingerprint stored in the issue body. It is closed automatically once the network is clean again. The report and a JSON result are also attached to each run as an artifact and shown in the job summary. Pull request runs never touch issues. Scheduled runs fire only from the default branch, so the schedule takes effect once this workflow reaches `main`.

## Mainnet and Blockfrost

Midnight retired its hosted mainnet RPC and indexer on 30 September 2026. Blockfrost now serves both, and every request needs a Midnight Mainnet project token. To enable the mainnet checks, create a project for the Midnight Mainnet network on [blockfrost.io](https://blockfrost.io). Then add its project ID as the repository secret `BLOCKFROST_MAINNET_PROJECT_ID` (Settings → Secrets and variables → Actions).

The composite action `.github/actions/blockfrost-mainnet` writes a mainnet config pointing at Blockfrost into the runner's temp directory and masks the token in logs. Every report is also scrubbed of `project_id` values before it is written, uploaded or posted to an issue. On scheduled runs without the secret, mainnet is reported as skipped (a notice plus a line in the job summary), never as passed. On release pull requests the secret is mandatory, and its absence fails the check, so a required check can't pass without having looked at mainnet. Release pull requests come from `next-release` in this repository, so they have access to the secret.

None of this needs a wallet, DUST or NIGHT. midnight-cast only reads from the networks.

## Running it locally

```bash
npm run build
npm run live-check -- preprod --out live-check
INTEGRATION=1 npm run test:smoke
```

`live-check` exits 0 when clean, 10 on drift and 20 on an outage. It exits 2 on a usage or internal error, or when the upstream matrix still can't be fetched after retries: a verdict without it would be incomplete, so the issue is left unchanged. To check mainnet locally, point your own `~/.config/midnight-cast/config.toml` at the Blockfrost URLs, and export `BLOCKFROST_PROJECT_ID` so it is redacted from the report.
