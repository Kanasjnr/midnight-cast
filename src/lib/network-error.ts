import { inMcpCall } from "./surface.js";
export type NetworkErrorKind =
  | "dns"
  | "refused"
  | "timeout"
  | "tls"
  | "network"
  | "http_4xx"
  | "http_5xx"
  | "rpc_error"
  | "graphql_error"
  | "invalid_response";

export type Service = "RPC" | "Indexer";

export class NetworkError extends Error {
  readonly hint?: string;

  constructor(
    message: string,
    readonly kind: NetworkErrorKind,
    readonly service: Service,
    readonly status?: number,
    hint?: string,
  ) {
    super(message);
    this.name = "NetworkError";
    this.hint = hint ?? hintFor(kind, service, status, message);
  }
}

const TLS_CODES = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|DEPTH_ZERO/;

export function transportKind(err: unknown): NetworkErrorKind {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "timeout";
  const e = err as { code?: unknown; cause?: { code?: unknown }; error?: { code?: unknown } } | undefined;
  const code = String(e?.cause?.code ?? e?.error?.code ?? e?.code ?? "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") return "timeout";
  if (TLS_CODES.test(code)) return "tls";
  return "network";
}

export function statusKind(status: number): NetworkErrorKind {
  return status >= 500 ? "http_5xx" : "http_4xx";
}

export function isTransportKind(kind: NetworkErrorKind): boolean {
  return kind === "dns" || kind === "refused" || kind === "timeout" || kind === "tls" || kind === "network";
}

function hintFor(kind: NetworkErrorKind, service: Service, status: number | undefined, message: string): string | undefined {
  const name = service === "RPC" ? "RPC endpoint" : "indexer";
  switch (kind) {
    case "dns":
      return `The ${name} host name doesn't resolve. Check the URL and your network.`;
    case "refused":
      return `Nothing is listening at the ${name} URL. For a local node, check that it's running.`;
    case "timeout":
      return inMcpCall()
        ? `The ${name} didn't answer in time. Public endpoints can be slow, so try again shortly.`
        : `The ${name} didn't answer in time. Public endpoints can be slow, so try again, or point at another endpoint with --rpc / --indexer-http.`;
    case "tls":
      return "The TLS handshake failed: check the URL scheme, any proxy, and your system clock.";
    case "network":
      return "The connection dropped before a response arrived. Try again.";
    case "http_4xx":
      if (message.includes("Blockfrost")) return undefined;
      if (status === 404) {
        return service === "Indexer"
          ? "The URL path looks wrong. Midnight indexers serve GraphQL at /api/v4/graphql."
          : "The URL path looks wrong for a node RPC endpoint.";
      }
      if (status === 401 || status === 403) return `The ${name} refused access. It may need a token or an allow-listed IP.`;
      if (status === 429) return `The ${name} is rate limiting requests. Wait a minute before retrying, or use your own endpoint.`;
      return `The ${name} rejected the request (HTTP ${status}).`;
    case "http_5xx":
      return `The ${name} reported a server error, which is usually temporary. Try again later.`;
    case "rpc_error":
      return "The node rejected the call. Check the method name and parameters.";
    case "graphql_error":
      return inMcpCall()
        ? "The indexer rejected the query. Check the input; if it looks right, the indexer's API version may differ, which the versions tool checks."
        : "The indexer rejected the query. Check the input; if it looks right, the indexer's API version may differ: run midnight-cast versions <network>";
    case "invalid_response":
      return `The response wasn't valid JSON. The URL may not be a Midnight ${name}.`;
  }
}
