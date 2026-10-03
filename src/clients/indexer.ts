import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import type { NetworkEndpoints } from "../networks.js";
import { postJson, readJson } from "../lib/http.js";
import { blockfrostHttpError, isBlockfrostUrl, takeProjectId } from "../lib/blockfrost.js";

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
  } catch {
    throw new Error("Indexer unreachable");
  }

  if (!response.ok) {
    throw new Error(
      (isBlockfrostUrl(target) && blockfrostHttpError("Indexer", response.status)) ||
        `Indexer unreachable (${response.status})`,
    );
  }

  const body = await readJson<GqlResponse<T>>(response, "Indexer");
  if (body.errors?.length) {
    throw new Error(
      `Indexer unreachable: ${body.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!body.data) {
    throw new Error("Indexer unreachable (no data)");
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

const DUST_SUBSCRIPTION = `
  subscription DustEvents($id: Int) {
    dustLedgerEvents(id: $id) {
      ${DUST_EVENT_FIELDS}
    }
  }
`;

function isCloseEvent(value: unknown): boolean {
  return typeof value === "object" && value !== null && "code" in value && "reason" in value;
}

function createWsClient(indexerWs: string, keepTrying: () => boolean): { client: Client; close: () => void } {
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
      connected: () => {
        everConnected = true;
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
    let settled = false;
    const { client, close } = createWsClient(endpoints.indexerWs, () => !settled);
    let unsubscribe = () => {};

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        close();
        if (events.length === 0) {
          reject(new Error("Event not received within timeout"));
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
            new Error(
              `Indexer WS unreachable: ${String((err as { message?: unknown })?.message || "connection failed")}`,
            ),
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
