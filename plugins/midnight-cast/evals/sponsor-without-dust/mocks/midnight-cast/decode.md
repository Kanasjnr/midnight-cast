{
  "schemaVersion": 2,
  "ok": true,
  "command": "decode",
  "network": null,
  "data": {
    "raw": "Insufficient Funds: could not balance dust",
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
        "id": "wallet-insufficient-dust",
        "name": "Wallet.InsufficientFunds: could not balance dust",
        "description": "The wallet couldn't pay the transaction's fee in DUST: it doesn't hold enough, or its DUST state is too stale to balance against the chain.",
        "fix": "Hold NIGHT registered for DUST generation and wait for DUST to accrue, as Midnight's examples advise. Sync the wallet first, since a stale DUST state fails the same way. Another wallet can also pay the fee (DUST sponsorship).",
        "examples": [
          {
            "example": "hello-world",
            "about": "Explaining a wallet's InsufficientFunds error (no DUST for fees) to a user",
            "path": "examples/hello-world/ui/src/lib/errors.ts",
            "lines": [
              48,
              53
            ],
            "url": "https://github.com/midnightntwrk/midnight-examples/blob/377495c5efbd5b1f3123f5aee2776c3694b05eda/examples/hello-world/ui/src/lib/errors.ts#L48-L53"
          },
          {
            "example": "private-party",
            "about": "Having a sponsor wallet pay the DUST fee and submit",
            "path": "examples/private-party/src/sponsor.ts",
            "lines": [
              97,
              116
            ],
            "url": "https://github.com/midnightntwrk/midnight-examples/blob/377495c5efbd5b1f3123f5aee2776c3694b05eda/examples/private-party/src/sponsor.ts#L97-L116"
          },
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
        "matched": "Insufficient Funds: could not balance dust",
        "runbooks": [
          {
            "title": "cNIGHT→DUST duplicate registrations",
            "url": "https://github.com/midnightntwrk/servicedesk/blob/main/runbooks/cnight-dust-duplicate-registration-runbook/cnight-dust-duplicate-registration-runbook.md"
          }
        ],
        "when": "Insufficient Funds: could not balance dust (capital F: short of DUST for the fee, not NIGHT)",
        "advice": "cNIGHT→DUST duplicates if DUST stopped generating; otherwise wait for DUST to generate"
      }
    ]
  },
  "warnings": [],
  "error": null,
  "next": [
    {
      "command": "midnight-cast preflight preprod --address <wallet address>",
      "reason": "Check the wallet holds NIGHT registered for DUST"
    },
    {
      "command": "midnight-cast explain dust",
      "reason": "How NIGHT generates DUST",
      "tool": {
        "name": "explain",
        "arguments": {
          "topic": "dust"
        }
      }
    }
  ]
}
