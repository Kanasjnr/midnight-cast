import type { Command, Option } from "commander";
import type { NetworkErrorKind } from "./network-error.js";
import { SCHEMA_VERSION } from "../output.js";

export interface CatalogOption {
  flags: string;
  description: string;
  default?: unknown;
}

export interface CatalogCommand {
  name: string;
  usage: string;
  description: string;
  arguments: Array<{ name: string; required: boolean; variadic: boolean }>;
  options: CatalogOption[];
  readOnly: boolean;
  /** Absent for commands that don't print a JSON envelope, such as mcp. */
  outputSchema?: string;
}

export interface Catalog {
  cli: string;
  version: string;
  schemaVersion: typeof SCHEMA_VERSION;
  globalOptions: CatalogOption[];
  commands: CatalogCommand[];
  topics: string[];
  exitCodes: Record<string, string>;
  errorKinds: Record<string, string>;
}

const EXIT_CODES = {
  "0": "Success",
  "1": "The command ran and the check failed, or a request failed",
  "2": "Usage error: unknown command or option, or a missing argument",
};

const ERROR_KINDS: Record<NetworkErrorKind | "usage" | "rate_limited", string> = {
  usage: "The command line was invalid",
  rate_limited: "The MCP server's limit on network calls was reached; wait and retry",
  dns: "The host name doesn't resolve",
  refused: "Nothing is listening at the URL",
  timeout: "No answer in time, after retries",
  tls: "The TLS handshake failed (certificate, proxy or clock)",
  network: "The connection dropped",
  http_4xx: "The endpoint rejected the request, e.g. a wrong path (404) or a missing token (403)",
  http_5xx: "The endpoint reported a server error, after retries",
  rpc_error: "The node rejected the JSON-RPC call",
  graphql_error: "The indexer rejected the GraphQL query",
  invalid_response: "The response wasn't the JSON expected",
};

const SCHEMA_BASE = "https://raw.githubusercontent.com/Kanasjnr/midnight-cast/main/schemas/";
const WRITES_FILES = new Set(["config init"]);
const NO_ENVELOPE = new Set(["mcp"]);

export function outputSchemaFor(command: string): string {
  const [first = "", second] = command.split(" ");
  const file = first === "config" ? `config-${second}` : first === "matrix" ? "versions" : first;
  return `${SCHEMA_BASE}${file}.schema.json`;
}

function describeOption(option: Option): CatalogOption {
  return {
    flags: option.flags,
    description: option.description,
    ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}),
  };
}

// A default subcommand (decode's "[code] [network]") is how its parent runs, so it is listed under the parent's name.
// Its name string and its .argument() calls both register arguments, so names repeat.
export function isDefaultSubcommand(cmd: Command): boolean {
  return /^[[<]/.test(cmd.name());
}

function describeArguments(cmd: Command): CatalogCommand["arguments"] {
  const args = cmd.registeredArguments.filter(
    (a, i, all) => !all.slice(i + 1).some((b) => b.name() === a.name()),
  );
  return args.map((a) => ({ name: a.name(), required: a.required, variadic: a.variadic }));
}

function formatUsage(path: string[], args: CatalogCommand["arguments"], hasOptions: boolean): string {
  const shown = args.map((a) => {
    const name = a.variadic ? `${a.name}...` : a.name;
    return a.required ? `<${name}>` : `[${name}]`;
  });
  return ["midnight-cast", ...path, ...(hasOptions ? ["[options]"] : []), ...shown].join(" ");
}

function walk(cmd: Command, prefix: string[]): CatalogCommand[] {
  return cmd.commands.flatMap((sub) => {
    const isDefault = isDefaultSubcommand(sub);
    const path = isDefault ? prefix : [...prefix, sub.name()];
    const args = describeArguments(sub);
    const options = [...(isDefault ? cmd.options : []), ...sub.options].map(describeOption);
    const self: CatalogCommand[] =
      sub.commands.length === 0
        ? [
            {
              name: path.join(" "),
              usage: formatUsage(path, args, options.length > 0),
              description: sub.description(),
              arguments: args,
              options,
              readOnly: !WRITES_FILES.has(path.join(" ")),
              ...(NO_ENVELOPE.has(path.join(" ")) ? {} : { outputSchema: outputSchemaFor(path.join(" ")) }),
            },
          ]
        : [];
    return [...self, ...walk(sub, path)];
  });
}

export function buildCatalog(program: Command, topics: readonly string[]): Catalog {
  return {
    cli: "midnight-cast",
    version: program.version() ?? "unknown",
    schemaVersion: SCHEMA_VERSION,
    globalOptions: program.options.map(describeOption),
    commands: walk(program, []),
    topics: [...topics],
    exitCodes: EXIT_CODES,
    errorKinds: ERROR_KINDS,
  };
}
