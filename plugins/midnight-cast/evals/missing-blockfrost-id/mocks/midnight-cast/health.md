---
error: true
expect:
  network: mainnet
---

{
  "schemaVersion": 1,
  "ok": false,
  "command": "health",
  "network": null,
  "data": null,
  "warnings": [],
  "error": {
    "message": "The mainnet RPC and indexer are served by Blockfrost and need a project ID, and this MCP server has none. Create a Midnight Mainnet project at https://blockfrost.io, then add BLOCKFROST_PROJECT_ID with its project ID to this server's env in the MCP client's configuration and restart the server. See https://docs.midnight.network/guides/networks-and-environments#blockfrost-the-mainnet-indexer-and-rpc-provider",
    "kind": null,
    "hint": null
  },
  "next": []
}
