{
  "schemaVersion": 2,
  "ok": true,
  "command": "decode",
  "network": null,
  "data": {
    "raw": "UnsupportedBlockVersion(1000300)",
    "parsed": {
      "substrate1010": false,
      "ledgerCodes": [],
      "palletModules": [],
      "jsonRpcCodes": [],
      "ledgerNames": []
    },
    "decodings": [
      {
        "kind": "message",
        "id": "unsupported-block-version",
        "name": "UnsupportedBlockVersion",
        "description": "The tool reading the chain doesn't know runtime spec_version 1000300, an earlier runtime than the 2001100 Preview, Preprod and Mainnet run now. Its blocks are still in the chain's history, so a node or toolkit syncing from genesis reads them and needs a release that knows both.",
        "fix": "Upgrade the node and toolkit to 2.1.101 or later, which Preview, Preprod and Mainnet run now."
      }
    ]
  },
  "warnings": [],
  "error": null,
  "next": [
    {
      "command": "midnight-cast versions preprod",
      "reason": "See which versions the network expects"
    }
  ]
}
