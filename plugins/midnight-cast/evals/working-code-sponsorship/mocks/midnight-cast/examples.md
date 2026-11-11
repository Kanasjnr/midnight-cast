{
  "schemaVersion": 2,
  "ok": true,
  "command": "examples",
  "network": null,
  "data": {
    "repo": "midnightntwrk/midnight-examples",
    "commit": "377495c5efbd5b1f3123f5aee2776c3694b05eda",
    "ledger": "9",
    "toolchain": {
      "Compact language (pragma)": "0.28",
      "Compact compiler (setup-compact-action)": "0.36.0",
      "@midnight-ntwrk/midnight-js-*": "5.0.0",
      "@midnight-ntwrk/midnight-js-network-id": "5.0.0-rc.5",
      "@midnight-ntwrk/testkit-js": "5.0.0",
      "wallet SDK": "2.0.0",
      "Node.js": "22",
      "npm": "11.21.0",
      "Vitest": "5.0.4",
      "Vite": "6.4.4"
    },
    "topic": "DUST sponsorship",
    "matches": [
      {
        "name": "private-party",
        "summary": "Private on-chain data, access control, and DUST sponsorship: one wallet pays the fees for another's transaction",
        "url": "https://github.com/midnightntwrk/midnight-examples/tree/377495c5efbd5b1f3123f5aee2776c3694b05eda/examples/private-party",
        "topics": [
          "dust sponsorship",
          "sponsor fees",
          "pay fees for another user",
          "access control",
          "commitment",
          "hashed set membership",
          "private guest list"
        ],
        "files": [
          {
            "path": "examples/private-party/src/sponsor.ts",
            "symbol": "export async function sponsorAndSubmit",
            "about": "Having a sponsor wallet pay the DUST fee and submit",
            "lines": [
              97,
              116
            ],
            "url": "https://github.com/midnightntwrk/midnight-examples/blob/377495c5efbd5b1f3123f5aee2776c3694b05eda/examples/private-party/src/sponsor.ts#L97-L116",
            "excerpt": "export async function sponsorAndSubmit(\n  logger: Logger,\n  sponsor: MidnightWalletProvider,\n  userTxHex: string,\n): Promise<string> {\n  // The marker triple matches `FinalizedTransaction = Transaction<SignatureEnabled, Proof, Binding>`.\n  const userTx = Transaction.deserialize<SignatureEnabled, Proof, Binding>(\n    'signature',\n    'proof',\n    'binding',\n    fromHex(userTxHex),\n  );\n\n  logger.info('[sponsor] attaching DUST fee offer...');\n  const sponsored = await sponsor.addDustFeesAndFinalize(userTx);\n\n  const txId = await sponsor.submitTx(sponsored);\n  logger.info(`[sponsor] submitted sponsored tx: ${txId}`);\n  return txId;\n}"
          }
        ],
        "filesMatched": true
      }
    ]
  },
  "warnings": [],
  "error": null,
  "next": []
}
