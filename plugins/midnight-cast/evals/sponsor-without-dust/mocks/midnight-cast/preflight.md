---
error: true
---

{
  "schemaVersion": 2,
  "ok": false,
  "command": "preflight",
  "network": "preprod",
  "data": {
    "network": "preprod",
    "ready": false,
    "checks": [
      {
        "name": "network",
        "ok": true,
        "detail": "the RPC and indexer answer, and the indexer is 2 blocks from the node"
      },
      {
        "name": "proof-server",
        "ok": true,
        "detail": "answers at https://proof-server.preprod.midnight.network and runs 8.1.0"
      },
      {
        "name": "wallet",
        "ok": false,
        "detail": "750 NIGHT in 2 UTXOs, none registered for DUST generation, so it can't pay fees. Register it for DUST from the wallet"
      }
    ],
    "wallet": {
      "address": "mn_addr_preprod1rwk3px4llmgruwupgpteghcq6c6956eu3de9xtgs5f8mgcaw6rls0d5mz9",
      "kind": "unshielded",
      "night": "750",
      "nightUtxos": 2,
      "registeredUtxos": 0,
      "complete": true
    }
  },
  "warnings": [],
  "error": {
    "message": "Not ready: wallet",
    "kind": null,
    "hint": null
  },
  "next": [
    {
      "command": "midnight-cast explain dust",
      "reason": "How NIGHT generates DUST, and registering for it",
      "tool": {
        "name": "explain",
        "arguments": {
          "topic": "dust"
        }
      }
    }
  ]
}
