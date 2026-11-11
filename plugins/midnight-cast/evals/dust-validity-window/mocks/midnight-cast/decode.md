{
  "schemaVersion": 2,
  "ok": true,
  "command": "decode",
  "network": null,
  "data": {
    "raw": "1010: Invalid Transaction: Custom error: 171",
    "parsed": {
      "substrate1010": true,
      "ledgerCodes": [
        "171"
      ],
      "palletModules": [],
      "jsonRpcCodes": [],
      "ledgerNames": []
    },
    "decodings": [
      {
        "kind": "substrate",
        "code": 1010,
        "name": "InvalidTransaction",
        "description": "Substrate transaction pool rejected the extrinsic. This is an envelope code, not a Midnight ledger code.",
        "steps": [
          "Find Custom error: N in the error message (u8, 0–255).",
          "Run: midnight-cast decode ledger N   (or: midnight-cast decode N)",
          "If DispatchError::Module { index, error }, run: midnight-cast decode pallet <index> <error>",
          "If there is no inner Custom(N), rejection was upstream Substrate validation (nonce, fee, size, etc.)."
        ],
        "docUrl": "https://docs.midnight.network/how-to/decode-1010-transaction-rejection-errors",
        "ledgerDocUrl": "https://docs.midnight.network/nodes/error-codes"
      },
      {
        "kind": "ledger",
        "code": 171,
        "name": "OutOfDustValidityWindow",
        "description": "DUST outside validity time window",
        "fix": "Use fresher DUST",
        "docUrl": "https://docs.midnight.network/nodes/error-codes",
        "network": "preprod",
        "ledger": "8.1.3",
        "mapLedger": "8.1.3",
        "networkLedger": "9.1.0.0",
        "mapUpdated": "2026-10",
        "mapMismatch": "Warning: bundled error map is ledger 8.1.3, but preprod matrix expects ledger 9.1.0.0. Code names/fixes may be wrong — refresh from https://docs.midnight.network/nodes/error-codes",
        "relatedHint": "Indexers before 4.3.5 could also reject the first transaction of a block with this error (fixed in 4.3.4 and 4.3.5). If only first-in-block transactions fail, check the indexer version.",
        "examples": [
          {
            "example": "hello-world",
            "about": "Syncing a wallet and reporting its progress",
            "path": "examples/hello-world/src/wallet.ts",
            "lines": [
              67,
              73
            ],
            "url": "https://github.com/midnightntwrk/midnight-examples/blob/377495c5efbd5b1f3123f5aee2776c3694b05eda/examples/hello-world/src/wallet.ts#L67-L73"
          }
        ]
      }
    ],
    "runbooks": [
      {
        "matched": "1010: Invalid Transaction: Custom error:",
        "runbooks": [
          {
            "title": "Node rejects a transaction (1010, Custom error: N)",
            "url": "https://github.com/midnightntwrk/servicedesk/blob/main/runbooks/node-1010-custom-error-runbook/node-1010-custom-error-runbook.md"
          }
        ]
      }
    ]
  },
  "warnings": [],
  "error": null,
  "next": [
    {
      "command": "midnight-cast explain 1010",
      "reason": "How to read a 1010 rejection",
      "tool": {
        "name": "explain",
        "arguments": {
          "topic": "1010"
        }
      }
    },
    {
      "command": "midnight-cast versions preprod",
      "reason": "Compare the indexer version with the support matrix"
    }
  ]
}
