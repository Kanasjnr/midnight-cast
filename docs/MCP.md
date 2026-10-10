# midnight-cast as an MCP server

`midnight-cast mcp` runs a read-only [Model Context Protocol](https://modelcontextprotocol.io) server on stdio, so any agent that speaks MCP can query the live Midnight networks and decode Midnight errors. Each tool runs the matching midnight-cast command and returns the same envelope as `--json` (see [JSON output](./COMMANDS.md#json-output)): `ok`, `data`, a structured `error`, `warnings`, and `next`, the follow-up commands an expert would run.

Nothing it does needs a wallet, keys or approval: every tool only reads, and the server holds no secret except an optional Blockfrost project ID for mainnet.

The server ships with midnight-cast 0.2.0. Until that is on npm, build from source and use `node /path/to/midnight-cast/dist/cli.js mcp` wherever the snippets below say `npx -y midnight-cast mcp`.

## Tools

| Tool | Reaches a network | What it does |
| --- | --- | --- |
| `health` | yes | Reachability, indexer sync and live versions against the support matrix in one call, and whether Midnight's own examples pass on the node the network runs |
| `preflight` | yes | Whether a network, its proof server and optionally a wallet (`address`) are ready for a first transaction, and how long wallet sync took in Midnight's examples run |
| `ping` | yes | Whether the RPC node, indexer and proof server answer, with latency and an error kind |
| `tip` | yes | Node height against indexer height |
| `versions` | yes | Live node, runtime and indexer API against the support matrix, and a project's Midnight packages against the matrix pins. Pass `projectDir` with the absolute path of the user's project: the server's working directory is wherever the client started it. `data.localProject` says which directory was checked and whether it had a `package.json` |
| `block` | yes | A block header, latest or at a height |
| `tx` | yes | A transaction's status, segments, fees, contract actions and the DUST and Zswap events it produced |
| `contract` | yes | A deployed contract: its latest action and circuit, deploy transaction, unshielded balances, and the state's size and sha256 (`includeState` for the full hex) |
| `dust_status` | yes | DUST registration, NIGHT balance, generation rate and capacity for up to 20 Cardano reward addresses |
| `dust_event` | yes | One DUST ledger event by id. An id the network hasn't reached fails at once, naming the latest |
| `dust_events` | yes | The latest DUST ledger events, or up to 50 from an id |
| `decode` | no | Explains a pasted error: 1010 rejections, `Custom(N)` ledger codes, pallet errors, JSON-RPC codes and known tooling messages |
| `examples` | no | Working code from Midnight's official examples for a topic, with files, line ranges, pinned links and the code; without a topic, every example |
| `explain` | no | Background on a topic: `dust`, `1010`, `versions` or `transcript` |

Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`, and `openWorldHint` is true only for the tools that reach a network. Each declares the envelope as its output schema and returns it both as structured content and as text. A failed check comes back with `isError: true` and the envelope explaining why.

### Following next steps

Each step in `next` has the CLI `command`, and, when the same step is an MCP tool call that needs nothing filled in, a `tool` with its `name` and `arguments`. For example, after `tx` an agent gets `{ "name": "dust_event", "arguments": { "id": 1586607, "network": "preprod" } }` for each DUST event, and can call it directly. A step with a placeholder, such as decoding the wallet error the user still has to paste, has only the command.

### Instructions, prompts and resources

When a client connects, the server sends instructions that most clients pass to the model: start with `decode` for an error and `health` for a network problem, follow `next`, and where the Blockfrost ID goes.

Three prompts start the usual investigations. Clients that support prompts usually offer them as slash commands:

- `diagnose-error` (`error`, optional `network`): decode it, follow the next steps, check the network if that's where it points, then explain the cause and the fix.
- `check-network` (`network`): run `health`, narrow failures down with `ping` and `tip`, and say whether it's an outage or local configuration.
- `investigate-transaction` (`hash`, `network`): run `tx`, follow its DUST events, and summarise what happened.

Network arguments complete from the allow-list.

Four resources are available: `midnight-cast://support-matrix`, the versions each network is expected to run; `midnight-cast://error-codes`, the ledger, pallet and JSON-RPC codes `decode` knows; `midnight-cast://examples`, every official Midnight example with its topics and the code that shows them; and `midnight-cast://catalog`, every CLI command with its options, exit codes and error kinds, for agents that also have a terminal.

## Configuration

The server reads these environment variables:

- `MIDNIGHT_CAST_NETWORKS` limits which networks the model may query, as a comma-separated list such as `preview,preprod`. By default every built-in network is allowed: `preview`, `preprod`, `mainnet` and `local`. A network defined in your `config.toml` can be allowed by naming it here.
- `BLOCKFROST_PREPROD_PROJECT_ID` and `BLOCKFROST_MAINNET_PROJECT_ID` are the Blockfrost project IDs preprod and mainnet need, one per network; `BLOCKFROST_PROJECT_ID` is the fallback for either. They are sent only to Blockfrost and are redacted from every response, so the model never sees them. Without one, that network's calls fail with a message telling the user to add it to this server's configuration. Preview needs none.
- `MIDNIGHT_CAST_MAX_CALLS_PER_MINUTE` sets the rate limit on tools that reach a network: 30 a minute by default, in bursts of up to a third of that. A looping agent can't exhaust public endpoints or a Blockfrost plan; over the limit a call returns an error with kind `rate_limited` and how long to wait. `decode` and `explain` work offline and aren't limited.

An invalid value in any of them stops the server at startup with a message on stderr.

The Claude Code plugin has a Blockfrost option for each network and passes them in `MIDNIGHT_CAST_PLUGIN_PREPROD_PROJECT_ID` and `MIDNIGHT_CAST_PLUGIN_MAINNET_PROJECT_ID`, which take precedence over the `BLOCKFROST_*` variables when they aren't empty. A project ID in the network's `config.toml` section takes precedence over all of them.

The model chooses a network by name but can't pass endpoint URLs, so it can't point the server at other hosts. Endpoints come from the built-in networks and your `~/.config/midnight-cast/config.toml`, as they do for the CLI.

## Protocol

The server is built on the official MCP TypeScript SDK (v2). It answers both the `initialize` handshake that today's clients use and the stateless 2026-07-28 protocol revision, including `server/discover`, so it works with current clients and with clients that have moved to the newest revision. It exits as soon as the client closes its standard input.

## Installing it in your agent

These snippets follow each client's documentation as of 4 October 2026. They haven't all been tested by hand yet; the compatibility table below records the clients that have, with the local build of 0.2.0. Each passes a Blockfrost project ID for preprod and one for mainnet; leave out the one for a network you don't use, or both if you only need preview.

### Claude Code

```bash
claude mcp add --transport stdio --env BLOCKFROST_PREPROD_PROJECT_ID=<preprod project id> --env BLOCKFROST_MAINNET_PROJECT_ID=<mainnet project id> midnight-cast -- npx -y midnight-cast mcp
```

Add `--scope project` to share it through the project's `.mcp.json`, or `--scope user` for every project.

Or install the midnight-cast plugin, which configures the same server and adds the midnight-cast skill and a `/midnight-cast:diagnose <network> [tx or error]` command. When the plugin is enabled, Claude Code asks for optional Blockfrost project IDs for preprod and mainnet and keeps them in secure storage instead of a settings file. To change them later, run `/plugin`, open midnight-cast and choose Configure options. If an option is empty, a `BLOCKFROST_PREPROD_PROJECT_ID` or `BLOCKFROST_MAINNET_PROJECT_ID` exported before starting Claude Code is used. If you added the server with `claude mcp add` before, remove it with `claude mcp remove midnight-cast` so only the plugin's server runs:

```bash
claude plugin marketplace add Kanasjnr/midnight-cast
claude plugin install midnight-cast@midnight-cast
```

### OpenAI Codex CLI

```bash
codex mcp add midnight-cast --env BLOCKFROST_PREPROD_PROJECT_ID=<preprod project id> --env BLOCKFROST_MAINNET_PROJECT_ID=<mainnet project id> -- npx -y midnight-cast mcp
```

Or in `~/.codex/config.toml` (or a project's `.codex/config.toml`):

```toml
[mcp_servers.midnight-cast]
command = "npx"
args = ["-y", "midnight-cast", "mcp"]
env_vars = ["BLOCKFROST_PREPROD_PROJECT_ID", "BLOCKFROST_MAINNET_PROJECT_ID"]
```

`env_vars` forwards the variables from your shell instead of writing the IDs into the file.

### Gemini CLI

```bash
gemini mcp add -e BLOCKFROST_PREPROD_PROJECT_ID=<preprod project id> -e BLOCKFROST_MAINNET_PROJECT_ID=<mainnet project id> midnight-cast npx -y midnight-cast mcp
```

Or in `~/.gemini/settings.json` (or a project's `.gemini/settings.json`), where the `$BLOCKFROST_…` values are read from your environment:

```json
{
  "mcpServers": {
    "midnight-cast": {
      "command": "npx",
      "args": ["-y", "midnight-cast", "mcp"],
      "env": {
        "BLOCKFROST_PREPROD_PROJECT_ID": "$BLOCKFROST_PREPROD_PROJECT_ID",
        "BLOCKFROST_MAINNET_PROJECT_ID": "$BLOCKFROST_MAINNET_PROJECT_ID"
      }
    }
  }
}
```

### Cursor

In `.cursor/mcp.json` for a project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "midnight-cast": {
      "command": "npx",
      "args": ["-y", "midnight-cast", "mcp"],
      "env": {
        "BLOCKFROST_PREPROD_PROJECT_ID": "<preprod project id>",
        "BLOCKFROST_MAINNET_PROJECT_ID": "<mainnet project id>"
      }
    }
  }
}
```

### VS Code (GitHub Copilot)

In `.vscode/mcp.json`, which prompts for the project IDs instead of storing them:

```json
{
  "inputs": [
    { "type": "promptString", "id": "blockfrost-preprod", "description": "Blockfrost Midnight Preprod project ID", "password": true },
    { "type": "promptString", "id": "blockfrost-mainnet", "description": "Blockfrost Midnight Mainnet project ID", "password": true }
  ],
  "servers": {
    "midnight-cast": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "midnight-cast", "mcp"],
      "env": {
        "BLOCKFROST_PREPROD_PROJECT_ID": "${input:blockfrost-preprod}",
        "BLOCKFROST_MAINNET_PROJECT_ID": "${input:blockfrost-mainnet}"
      }
    }
  }
}
```

### Google Antigravity

In `~/.gemini/config/mcp_config.json`, which Antigravity's MCP server settings open as the raw config:

```json
{
  "mcpServers": {
    "midnight-cast": {
      "command": "npx",
      "args": ["-y", "midnight-cast", "mcp"],
      "env": {
        "BLOCKFROST_PREPROD_PROJECT_ID": "<preprod project id>",
        "BLOCKFROST_MAINNET_PROJECT_ID": "<mainnet project id>"
      }
    }
  }
}
```

### Windsurf

Windsurf's MCP documentation now lives at docs.devin.ai and describes the Cascade agent reading `~/.config/devin/mcp_config.json` (`%APPDATA%\devin\mcp_config.json` on Windows), in the `mcpServers` format below. Check your version's documentation for the file it uses.

### Any other MCP client

Most clients accept this `mcpServers` block:

```json
{
  "mcpServers": {
    "midnight-cast": {
      "command": "npx",
      "args": ["-y", "midnight-cast", "mcp"],
      "env": {
        "BLOCKFROST_PREPROD_PROJECT_ID": "<preprod project id>",
        "BLOCKFROST_MAINNET_PROJECT_ID": "<mainnet project id>"
      }
    }
  }
}
```

### From the MCP Registry

From 0.2.0, midnight-cast is listed in the [MCP Registry](https://registry.modelcontextprotocol.io) as `io.github.Kanasjnr/midnight-cast`. Clients and galleries that install from the registry start it as `npx -y midnight-cast mcp` and can ask for `BLOCKFROST_PREPROD_PROJECT_ID` and `BLOCKFROST_MAINNET_PROJECT_ID` (secrets, each needed only for its network) and `MIDNIGHT_CAST_NETWORKS`, as described in `server.json`.

## Compatibility

| Client | Version tested | Date | Result |
| --- | --- | --- | --- |
| MCP TypeScript SDK client (automated tests) | `@modelcontextprotocol/client` 2.3.0 | 4 October 2026 | Every tool and resource, against recorded preprod and mainnet responses |
| Claude Code | 2.1.296 | 10 October 2026 | Pass. Connected and offered all 14 tools; an agent called `decode`, `tip` (preprod, through Blockfrost) and `examples` with the right arguments and answered correctly |
| OpenAI Codex CLI | 0.149.0-alpha.4, macOS 14.7 | 10 October 2026 | Partial. Registered and enabled; Codex's MCP client listed the 14 tools, and `decode`, `explain`, `health` (preview), `examples` and `tip` (preprod) returned correct results with no schema or validation errors. The agent session itself didn't run (Codex backend timeout), so an agent choosing the tools is still to check |
| Gemini CLI | not yet | | |
| Cursor (agent CLI) | 2026.10.01 | 10 October 2026 | Pass. Ready with all 14 tools; an agent called `decode`, `tip` (preprod) and `examples` and answered correctly. In non-interactive runs each call needs approval: allow them with `{ "permissions": { "allow": ["Mcp(midnight-cast:*)"] } }` in `.cursor/cli.json` |
| Cursor (editor) | not yet | | |
| Google Antigravity | 1.3.3, macOS 14.7 | 10 October 2026 | Pass. Listed all 14 tools; its agent used `decode`, `health` (preview), `examples` (with links to the code) and `tip` (preprod) and answered all five test prompts correctly |
| VS Code (GitHub Copilot) | not yet | | Not tested: GitHub Copilot wasn't installed on the test machine |
| Windsurf | not yet | | |
