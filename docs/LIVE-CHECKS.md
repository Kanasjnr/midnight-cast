# Live network checks

midnight-cast answers questions about live Midnight networks, so its tests have to look at those networks too. The trick is to keep two kinds of failure apart. A code regression should turn a pull request red. A network upgrade should not, because nothing in the pull request caused it, but someone still needs to hear about it quickly, since the bundled support matrix is now out of date. The CI is split along that line.

## Pull requests and pushes

`.github/workflows/test.yml` runs the unit suite on Linux, macOS and Windows against Node 20, 22 and 24. The unit tests never touch the network or the wall clock, so they only fail for code reasons. A typecheck covers both `src/` and the TypeScript scripts in `scripts/`.

The same workflow then runs a live smoke suite against preview, preprod and mainnet. It asserts things that should hold whatever version a network runs: the RPC and indexer answer, the node's runtime `specVersion` matches the indexer's `protocolVersion`, the JSON output has the expected shape, and a known preprod transaction decodes. It deliberately does not compare live versions with the bundled matrix.

## The scheduled live check

`.github/workflows/live.yml` runs every six hours, and on demand from the Actions tab for one network or all of them. For each network, `scripts/live-check.ts` runs the built CLI (`health` and `versions --json`). It fetches the support matrix Midnight publishes in `midnightntwrk/midnight-docs`, then compares three things: what the network is running, what midnight-cast bundles, and what the upstream matrix says.

Each finding is classified, and the classification decides what happens:

| Finding | Meaning | Effect |
| --- | --- | --- |
| outage | A required service still failed after three attempts | Job fails |
| bundled-drift | The live network differs from the bundled matrix | Issue opened |
| upstream-ahead | Midnight's matrix moved past the bundled one | Issue opened |
| protocol-split | Node and indexer disagree on the protocol version | Issue opened |
| upstream-lag | Midnight's own matrix is behind the live network | Reported only |

`scripts/live-issue.ts` keeps one issue per network, titled `Live check: <network>` and labelled `live-check`. The issue is edited only when the findings change, tracked by a fingerprint stored in the issue body. It is closed automatically once the network is clean again. The report and a JSON result are also attached to each run as an artifact and shown in the job summary.

A pull request that changes `src/data/support-matrix.json` triggers the same check, and fails if drift remains. That way a matrix refresh is proven against the real networks before it merges. Scheduled runs only fire from the default branch, so the schedule takes effect once this workflow reaches `main`.

## Mainnet and Blockfrost

Midnight retired its hosted mainnet RPC and indexer on 30 September 2026. Blockfrost now serves both, and every request needs a Midnight Mainnet project token. To enable the mainnet checks, create a project for the Midnight Mainnet network on [blockfrost.io](https://blockfrost.io). Then add its project ID as the repository secret `BLOCKFROST_MAINNET_PROJECT_ID` (Settings → Secrets and variables → Actions).

The composite action `.github/actions/blockfrost-mainnet` writes a mainnet config pointing at Blockfrost into the runner's temp directory and masks the token in logs. Every report is also scrubbed of `project_id` values before it is written, uploaded or posted to an issue. Without the secret, for example on pull requests from forks, mainnet is reported as skipped rather than passed.

None of this needs a wallet, DUST or NIGHT. midnight-cast only reads from the networks.

## Running it locally

```bash
npm run build
npm run live-check -- preprod --out live-check
INTEGRATION=1 npm run test:smoke
```

`live-check` exits 0 when clean, 10 on drift and 20 on an outage. It exits 2 on a usage or internal error, or when the upstream matrix still can't be fetched after retries: a verdict without it would be incomplete, so the issue is left unchanged. To check mainnet locally, point your own `~/.config/midnight-cast/config.toml` at the Blockfrost URLs, and export `BLOCKFROST_PROJECT_ID` so it is redacted from the report.
