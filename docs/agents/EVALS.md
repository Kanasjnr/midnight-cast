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
| OpenAI Codex CLI | not yet run | | | | | |
| Gemini CLI | not yet run | | | | | |
