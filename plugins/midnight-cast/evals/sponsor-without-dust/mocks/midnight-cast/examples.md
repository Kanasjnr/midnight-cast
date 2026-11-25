{
  "schemaVersion": 2,
  "ok": true,
  "command": "examples",
  "network": null,
  "data": {
    "repo": "midnightntwrk/midnight-examples",
    "commit": "c37451a810313bb22015ded286c3718db95cee19",
    "ledger": "9",
    "toolchain": {
      "Compact language (pragma)": "0.28",
      "Compact compiler (setup-compact-action)": "0.36.1",
      "@midnight-ntwrk/midnight-js-*": "5.0.1",
      "@midnight-ntwrk/testkit-js": "5.0.1",
      "wallet SDK": "2.0.1",
      "Node.js": "22",
      "npm": "11.21.0",
      "Vitest": "5.0.4",
      "Vite": "6.4.5",
      "Compact CLI (compact)": "0.5.3",
      "@midnight-ntwrk/dapp-connector-api": "4.0.1",
      "proof server image": "9.0.2",
      "node image (local devnet)": "2.1.101",
      "indexer image (local devnet)": "4.4.101"
    },
    "topic": "DUST sponsorship",
    "matches": [
      {
        "name": "private-party",
        "summary": "Private on-chain data, access control, and DUST sponsorship: one wallet pays the fees for another's transaction",
        "url": "https://github.com/midnightntwrk/midnight-examples/tree/c37451a810313bb22015ded286c3718db95cee19/examples/private-party",
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
            "url": "https://github.com/midnightntwrk/midnight-examples/blob/c37451a810313bb22015ded286c3718db95cee19/examples/private-party/src/sponsor.ts#L97-L116",
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
