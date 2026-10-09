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
- Set the version with `npm version <x.y.z> --no-git-tag-version`, which updates `package.json` and `package-lock.json`, and `server.json`, the MCP Registry entry, through the `version` script.
- Commit both on a branch and merge them into `next-release` through a pull request.

## The release pull request

Open a pull request from `next-release` into `main`. Its required checks are:

- the unit tests on Linux, macOS and Windows with Node 20, 22 and 24 (`test.yml`);
- the live checks for preview, preprod and mainnet, the live smoke tests, the error code check and the response shape check (`live.yml`);
- the packed tarball, installed and run on Node 20, 22 and 24 and on Windows (`tarball.yml`, which also runs offline on pull requests into `next-release`);
- the standalone binaries (`binaries.yml`): Linux builds the Linux binaries, macOS builds and signs the macOS ones, since Apple silicon won't run a binary whose signature doesn't verify, and Windows builds its own, since one cross-compiled on Linux crashed there. Each binary is then run and installed from a local release on its own OS and architecture: Linux x64 and arm64 (glibc on the runner, musl in Alpine, and x64 glibc again in Debian), macOS arm64 and x64, and Windows x64. Pull requests into `next-release` smoke them offline.

The live checks fail during a network outage. Report the outage to Midnight's service desk and re-run them once the network recovers; see [LIVE-CHECKS.md](./LIVE-CHECKS.md).

## Publishing

After the pull request merges, create a GitHub release that targets `main`, tagged `v<x.y.z>`, with the changelog section as its notes. Publishing it starts `publish.yml`, which:

1. runs the tarball smoke test again on the merged code;
2. confirms that a full live check on `main` (a scheduled run or a push, not a manual run that may cover one network) succeeded within the last 24 hours, and that no `live-check` issue is open, since the live check keeps one open for each network while it reports drift or an outage;
3. builds and publishes to npm with provenance, then lists that version in the MCP Registry: it waits until npm serves the version, then runs `mcp-publisher publish` with GitHub's OIDC login, which needs no secret. The registry checks that the package's `mcpName` matches `server.json`, so if that job fails, re-run it once npm has the version;
4. separately, builds the standalone binaries, smokes them, records build provenance and, once steps 1 and 2 have passed, attaches the archives, `SHA256SUMS`, `install.sh` and `install.ps1` to the GitHub release.

npm doesn't wait for step 4, since the binaries are an extra channel. If a binary job fails after npm has published, re-run the failed jobs from the workflow run; until it passes, the release has no binaries and the install one-liner returns 404.

If the last full live check is older than 24 hours, wait for the next scheduled run or push to `main`, then re-run the failed job. If a `live-check` issue is open, resolve the drift or wait for the outage to clear; the issue closes itself once the network is clean.

Once it has published, check the release from a clean directory:

```bash
npx midnight-cast@<x.y.z> --version
npx midnight-cast@<x.y.z> explain --json
```

And the binaries, with the installer and the provenance the release recorded:

```bash
curl -fsSL https://github.com/Kanasjnr/midnight-cast/releases/latest/download/install.sh | sh
gh release download v<x.y.z> --repo Kanasjnr/midnight-cast --pattern 'midnight-cast-linux-x64.tar.gz'
gh attestation verify midnight-cast-linux-x64.tar.gz --repo Kanasjnr/midnight-cast
```
