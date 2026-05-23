import { createClient, type Client } from "graphql-ws";
import WebSocket from "ws";
import type { NetworkEndpoints } from "../networks.js";

const DEFAULT_TIMEOUT_MS = 5000;

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
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Indexer unreachable");
  }

  if (!response.ok) {
    throw new Error(`Indexer unreachable (${response.status})`);
  }

  const body = (await response.json()) as GqlResponse<T>;
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

function createWsClient(indexerWs: string): Client {
  return createClient({
    url: indexerWs,
    webSocketImpl: WebSocket,
    connectionParams: {},
  });
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
    const client = createWsClient(endpoints.indexerWs);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.dispose();
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
      client.dispose();
      if (err) {
        reject(err);
      } else {
        resolve(events);
      }
    };

    client.subscribe(
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
              `Indexer WS unreachable: ${err instanceof Error ? err.message : String(err)}`,
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
