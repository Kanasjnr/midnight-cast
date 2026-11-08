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
        "description": "The tool reading the chain doesn't know runtime spec_version 1000300, which Preprod runs. A node or toolkit built for an older runtime can't read its blocks.",
        "fix": "Upgrade the node and toolkit to 1.0.400 or later, which Preprod runs on this runtime."
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
