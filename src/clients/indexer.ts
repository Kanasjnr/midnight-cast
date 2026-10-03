import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import type { NetworkEndpoints } from "../networks.js";
import { postJson, readJson } from "../lib/http.js";
import { blockfrostHttpError, isBlockfrostUrl, takeProjectId } from "../lib/blockfrost.js";
import { NetworkError, statusKind, transportKind } from "../lib/network-error.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface GqlResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function gqlPost<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const { url: target, projectId } = takeProjectId(url);
  let response: Response;
  try {
    response = await postJson(
      target,
      { query, variables },
      { timeoutMs, headers: projectId ? { project_id: projectId } : {} },
    );
  } catch (err) {
    throw new NetworkError("Indexer unreachable", transportKind(err), "Indexer");
  }

  if (!response.ok) {
    throw new NetworkError(
      (isBlockfrostUrl(target) && blockfrostHttpError("Indexer", response.status)) ||
        `Indexer unreachable (${response.status})`,
      statusKind(response.status),
      "Indexer",
      response.status,
    );
  }

  const body = await readJson<GqlResponse<T>>(response, "Indexer");
  if (body.errors?.length) {
    throw new NetworkError(
      `Indexer unreachable: ${body.errors.map((e) => e.message).join("; ")}`,
      "graphql_error",
      "Indexer",
    );
  }
  if (!body.data) {
    throw new NetworkError("Indexer unreachable (no data)", "invalid_response", "Indexer");
  }
  return body.data;
}

export async function getLatestBlockHeight(
  indexerHttp: string,
): Promise<number> {
  const data = await gqlPost<{ block: { height: number } }>(
    indexerHttp,
    `query { block { height } }`,
  );
  return data.block.height;
}

export interface DustLedgerEventPayload {
  __typename: string;
  id: number;
  protocolVersion: number;
  raw: string;
  maxId: number;
}

const DUST_EVENT_FIELDS = `
  __typename
  id
  protocolVersion
  raw
  maxId
`;

export const DUST_SUBSCRIPTION = `
  subscription DustEvents($id: Int) {
    dustLedgerEvents(id: $id) {
      ${DUST_EVENT_FIELDS}
    }
  }
`;

function isCloseEvent(value: unknown): boolean {
  return typeof value === "object" && value !== null && "code" in value && "reason" in value;
}

function createWsClient(
  indexerWs: string,
  keepTrying: () => boolean,
  on: {
    connecting: () => void;
    connected: () => void;
    closed: (event: unknown) => void;
    error: (event: unknown) => void;
  },
): { client: Client; close: () => void } {
  const sockets = new Set<WebSocket>();
  class TrackedWebSocket extends WebSocket {
    constructor(...args: ConstructorParameters<typeof WebSocket>) {
      super(...args);
      sockets.add(this);
    }
  }
  let everConnected = false;
  const client = createClient({
    url: indexerWs,
    webSocketImpl: TrackedWebSocket,
    connectionParams: {},
    on: {
      ...on,
      connected: () => {
        everConnected = true;
        on.connected();
      },
    },
    // Before the first connection an error (refused, DNS, handshake) is final;
    // after it, a dropped connection is retried like a close.
    shouldRetry: (errOrClose) => keepTrying() && (everConnected || isCloseEvent(errOrClose)),
    retryWait: (retries) =>
      new Promise((resolve) => {
        setTimeout(resolve, 2 ** retries * 1000 + 300 + Math.floor(Math.random() * 2700)).unref();
      }),
  });
  return {
    client,
    // dispose() waits on a pending connect and rejects if it failed, so the
    // sockets are terminated directly to let the process exit.
    close: () => {
      Promise.resolve(client.dispose()).catch(() => {});
      for (const socket of sockets) socket.terminate();
    },
  };
}

export async function subscribeDustEvents(
  endpoints: Pick<NetworkEndpoints, "indexerWs">,
  options: {
    fromId?: number;
    targetId?: number;
    limit?: number;
    timeoutMs?: number;
  },
): Promise<DustLedgerEventPayload[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const events: DustLedgerEventPayload[] = [];
  const limit = options.limit ?? 1;
  const fromId = options.fromId ?? options.targetId;

  return new Promise((resolve, reject) => {
    let everConnected = false;
    let lastFailure: unknown;
    let attemptError: unknown;
    let settled = false;
    const { client, close } = createWsClient(endpoints.indexerWs, () => !settled, {
      connecting: () => {
        attemptError = undefined;
      },
      connected: () => {
        everConnected = true;
        lastFailure = undefined;
      },
      error: (event) => {
        attemptError = event;
        lastFailure = event;
      },
      closed: (event) => {
        const code = (event as { code?: unknown })?.code;
        if (code === 1000 || code === 1001) return;
        // A transport failure closes with 1006, which says less than its own error.
        lastFailure = code === 1006 && attemptError ? attemptError : event;
      },
    });
    let unsubscribe = () => {};

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        close();
        if (events.length === 0) {
          reject(
            lastFailure
              ? wsFailure(lastFailure, endpoints.indexerWs)
              : subscriptionTimeout(everConnected, options.targetId !== undefined),
          );
        } else {
          resolve(events);
        }
      }
    }, timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      close();
      if (err) {
        reject(err);
      } else {
        resolve(events);
      }
    };

    unsubscribe = client.subscribe(
      {
        query: DUST_SUBSCRIPTION,
        variables: fromId !== undefined ? { id: fromId } : {},
      },
      {
        next: (payload) => {
          const event = (payload.data as { dustLedgerEvents?: DustLedgerEventPayload })
            ?.dustLedgerEvents;
          if (!event) return;

          if (
            options.targetId !== undefined &&
            event.id !== options.targetId
          ) {
            if (event.id > options.targetId) {
              finish(new Error(`Event ${options.targetId} not found (passed id ${event.id})`));
            }
            return;
          }

          if (
            options.targetId === undefined &&
            options.fromId !== undefined &&
            event.id < options.fromId
          ) {
            return;
          }

          const already = events.some((e) => e.id === event.id);
          if (!already) {
            events.push(event);
          }

          if (options.targetId !== undefined && event.id === options.targetId) {
            finish();
            return;
          }

          if (events.length >= limit) {
            finish();
          }
        },
        error: (err) => {
          finish(
            Array.isArray(err)
              ? new NetworkError(
                  `Indexer WS error: ${err.map((e: { message?: string }) => e.message ?? String(e)).join("; ")}`,
                  "graphql_error",
                  "Indexer",
                )
              : wsFailure((err as { code?: unknown })?.code === 1006 && lastFailure ? lastFailure : err, endpoints.indexerWs),
          );
        },
        complete: () => finish(),
      },
    );
  });
}

export function truncateRaw(raw: string, verbose: boolean): string {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (verbose) return raw;
  const preview = hex.slice(0, 32);
  return hex.length > 32 ? `0x${preview}…` : raw;
}

export function subscriptionTimeout(connected: boolean, waitingForId: boolean): NetworkError {
  const hint = !connected
    ? "The indexer WebSocket never connected. Check the URL (--indexer-ws) and your network."
    : waitingForId
      ? "Connected, but that event didn't arrive in time. The id may not exist yet on this network; try a longer --timeout, or list recent ids with dust-events --from."
      : "Connected, but no events arrived in time. Try an earlier --from or a longer --timeout.";
  return new NetworkError("Event not received within timeout", "timeout", "Indexer", undefined, hint);
}

const CLOSE_AS_HTTP: Record<number, number> = { 1008: 403, 4400: 400, 4401: 401, 4403: 403, 4500: 500 };
const WS_TIMEOUT_HINT =
  "The indexer WebSocket didn't answer in time. Try again, or point at another endpoint with --indexer-ws.";

export function wsFailure(err: unknown, url?: string): NetworkError {
  const event = err as { code?: unknown; reason?: unknown; message?: unknown; error?: { message?: unknown; code?: unknown } };
  if (typeof event?.code === "number") {
    const reason = typeof event.reason === "string" && event.reason ? `: ${event.reason}` : "";
    const message = `Indexer WS closed (${event.code}${reason})`;
    const status = CLOSE_AS_HTTP[event.code];
    if (status) return new NetworkError(message, statusKind(status), "Indexer", status);
    return event.code === 4408
      ? new NetworkError(message, "timeout", "Indexer", undefined, WS_TIMEOUT_HINT)
      : new NetworkError(message, "network", "Indexer");
  }
  const detail = event?.message || event?.error?.message || event?.error?.code || "connection failed";
  const handshakeStatus = Number(/Unexpected server response: (\d{3})/.exec(String(detail))?.[1]);
  if (handshakeStatus >= 300 && handshakeStatus < 400) {
    return new NetworkError(
      `Indexer WS redirected (${handshakeStatus})`,
      "network",
      "Indexer",
      handshakeStatus,
      "The WebSocket URL redirects. Use the final URL, often wss:// instead of ws:// or a different path.",
    );
  }
  if (handshakeStatus >= 400) {
    return new NetworkError(
      (url && isBlockfrostUrl(url) && blockfrostHttpError("Indexer", handshakeStatus)) ||
        `Indexer WS unreachable (${handshakeStatus})`,
      statusKind(handshakeStatus),
      "Indexer",
      handshakeStatus,
      handshakeStatus === 404
        ? "The WebSocket URL path looks wrong. Midnight indexers serve subscriptions at /api/v4/graphql/ws."
        : undefined,
    );
  }
  const kind = transportKind(err);
  return new NetworkError(
    `Indexer WS unreachable: ${String(detail)}`,
    kind,
    "Indexer",
    undefined,
    kind === "timeout" ? WS_TIMEOUT_HINT : undefined,
  );
}
