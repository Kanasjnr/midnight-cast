# Agent evals

These tasks check that a coding agent, given only the midnight-cast guidance (the `AGENTS.md`, `CLAUDE.md` or `GEMINI.md` snippet, or the skill) and a shell, diagnoses common Midnight problems correctly. Run each task in a fresh session with the guidance installed and no other Midnight context, and record whether the agent reached the expected answer using midnight-cast rather than memory.

## Tasks

**1. Old toolkit on the current runtime.** Prompt: "My Midnight toolkit fails with `UnsupportedBlockVersion(1000300)`. What's wrong?" Expected: the agent runs `midnight-cast decode --raw "UnsupportedBlockVersion(1000300)" --json` and explains that the toolkit (or node) predates runtime 1.0.300, which preview, preprod and mainnet run, and that the fix is upgrading to 1.0.300 or later.

**2. Missing Blockfrost project ID.** Prompt: "Check whether Midnight mainnet is healthy", in a shell without `BLOCKFROST_PROJECT_ID`. Expected: the agent runs `midnight-cast health mainnet --json`, reads the error, and tells the user mainnet goes through Blockfrost and needs `BLOCKFROST_PROJECT_ID` set to a Midnight Mainnet project ID, instead of reporting an outage.

**3. Indexer lag.** Prompt: "Is the preprod indexer keeping up with the node?" Expected: the agent runs `midnight-cast tip preprod --json` (or `health`) and answers from `data.delta` and `data.inSync`, naming the gap in blocks.

**4. DUST validity window.** Prompt: "My transaction was rejected with `1010: Invalid Transaction: Custom error: 171`." Expected: the agent runs `decode --raw` and explains `OutOfDustValidityWindow`: the DUST used is outside its validity window, so fresher DUST is needed. It also mentions that indexers before 4.3.5 could reject the first transaction of a block this way.

## Results

| Agent | Version | Date | Task 1 | Task 2 | Task 3 | Task 4 |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | not yet run | | | | | |
| Claude Code plugin (`claude plugin eval`) | not yet run | | | | | |
| OpenAI Codex CLI | not yet run | | | | | |
| Gemini CLI | not yet run | | | | | |

## Claude Code plugin evals

The Claude Code plugin has the same four tasks as a [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals) suite in `plugins/midnight-cast/evals/`. The agent gets the plugin and nothing else, and the midnight-cast tools answer from mocks instead of a live network, so a run is repeatable and needs no Blockfrost project ID. The mocks are the real server's output for `decode` and for `health` on mainnet without a project ID; the `tip` result for the indexer-lag task was edited to show the indexer 420 blocks behind. `evals/mocks/midnight-cast/_tools.json` holds the server's real tool list, and a unit test checks it, and every mock and grader, against the current server.

Each case checks that the agent called the right tool and that its answer names the cause; the missing-project-ID task also has a judge that fails any answer reporting an outage. Every run is a model call on your account, so start small:

```bash
claude plugin eval ./plugins/midnight-cast --runs 1 --ablation none
```

Leave out `--ablation none` to also run each task without the plugin and see what it adds, and leave out `--runs 1` for the default three runs per task.
