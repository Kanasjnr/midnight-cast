---
description: Find out why a DUST sponsor wallet can't pay fees by checking it, rather than guessing
expected_outcome: Runs preflight on the sponsor's address, finds its NIGHT isn't registered for DUST generation, says to register it, and points at private-party's sponsorship code
max_turns: 14
allowed_tools: [Skill]
---

I pay my users' transaction fees from one sponsor wallet on preprod, but every sponsored transaction fails with `Insufficient Funds: could not balance dust`. The sponsor wallet is mn_addr_preprod1rwk3px4llmgruwupgpteghcq6c6956eu3de9xtgs5f8mgcaw6rls0d5mz9. What's wrong, and how do I fix it?
