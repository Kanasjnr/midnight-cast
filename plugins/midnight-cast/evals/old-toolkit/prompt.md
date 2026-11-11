---
description: An old toolkit or node can't read runtime 1.0.300 blocks from before the Ledger 9 upgrade
expected_outcome: Decodes the message, says runtime 1.0.300 is the one from before the Ledger 9 upgrade, still in the chain's history, and says to upgrade the node and toolkit to 2.1.101, which preprod runs now
max_turns: 12
allowed_tools: [Skill]
---

My Midnight toolkit fails with `UnsupportedBlockVersion(1000300)` when it syncs from preprod. What is wrong?
