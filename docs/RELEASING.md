# Releasing midnight-cast

Work lands on `next-release` through pull requests. A release is a pull request from `next-release` into `main`, followed by a GitHub release that publishes to npm. Everything below runs from a clean checkout of `next-release` with `npm ci`.

## Before opening the release pull request

Bring the data midnight-cast bundles up to date, because it ships with the release and goes stale between releases.

```bash
npm run build
npm run live-check -- preview
npm run live-check -- preprod
BLOCKFROST_PROJECT_ID=<mainnet project id> npm run live-check -- mainnet
npm run error-codes
BLOCKFROST_PROJECT_ID=<mainnet project id> npm run fixtures -- --check
```

The live checks compare each network with `src/data/support-matrix.json` and with the matrix Midnight publishes. Update the bundled matrix for anything they report as drift, and set its `updated` field to the current month. `npm run error-codes` compares `src/data/error-codes.json` with the node source at the release mainnet runs. `npm run fixtures -- --check` compares live responses and the indexer schemas with `test/fixtures/`; if it reports drift, re-record with `npm run fixtures`, review the diff, and fix any parser it affects.

Then run `midnight-cast versions <network>` against each network as a last look at what a user will see, and `npm run smoke:tarball` to try the package exactly as npm will ship it.

Finally, prepare the version:

- Move the `Unreleased` section of `CHANGELOG.md` under the new version and date, and call out any breaking change, including any change that bumps the JSON `schemaVersion`.
- Set the version with `npm version <x.y.z> --no-git-tag-version`, which updates `package.json` and `package-lock.json`.
- Commit both on a branch and merge them into `next-release` through a pull request.

## The release pull request

Open a pull request from `next-release` into `main`. Its required checks are:

- the unit tests on Linux, macOS and Windows with Node 20, 22 and 24 (`test.yml`);
- the live checks for preview, preprod and mainnet, the live smoke tests, the error code check and the response shape check (`live.yml`);
- the packed tarball, installed and run on Node 20, 22 and 24 and on Windows (`tarball.yml`).

The live checks fail during a network outage. Report the outage to Midnight's service desk and re-run them once the network recovers; see [LIVE-CHECKS.md](./LIVE-CHECKS.md).

## Publishing

After the pull request merges, create a GitHub release that targets `main`, tagged `v<x.y.z>`, with the changelog section as its notes. Publishing it starts `publish.yml`, which:

1. runs the tarball smoke test again on the merged code;
2. confirms that a live check on `main` succeeded within the last 24 hours, since the scheduled run every six hours keeps that true unless a network is down or has drifted;
3. builds and publishes to npm with provenance.

If the live check is older than 24 hours, run `live.yml` from the Actions tab, then re-run the failed job.

Once it has published, check the release from a clean directory:

```bash
npx midnight-cast@<x.y.z> --version
npx midnight-cast@<x.y.z> explain --json
```
