// Recorded RPC, indexer and proof-server responses: how requests are keyed,
// replayed and compared by shape.

export interface Exchange {
  key: string;
  status: number;
  contentType: string;
  body: string;
}

export interface DustRecording {
  variables: Record<string, unknown>;
  payloads: unknown[];
}

export interface FixtureFile {
  network: string;
  recordedAt: string;
  /** Inputs the replayed commands use, found on the live network when recording. */
  inputs: { txHash: string; blockHeight: number; dustEventId: number };
  exchanges: Exchange[];
  dust: DustRecording;
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/** What a request asks for, independent of host, headers and retries. */
export function exchangeKey(url: string, body: string | undefined, proofServer?: string): string {
  if (proofServer && url.startsWith(proofServer.replace(/\/+$/, ""))) {
    return `proof-server GET ${new URL(url).pathname}`;
  }
  const request = JSON.parse(body ?? "{}") as { method?: string; params?: unknown; query?: string; variables?: unknown };
  if (request.method) return `rpc ${request.method} ${JSON.stringify(request.params ?? [])}`;
  if (request.query) return `indexer ${normalizeQuery(request.query)} ${JSON.stringify(request.variables ?? {})}`;
  return `unknown ${url}`;
}

function bodyText(body: unknown): string | undefined {
  return typeof body === "string" ? body : undefined;
}

/** The GraphQL query in an indexer exchange key, without its trailing variables JSON. */
export function indexerQuery(key: string): string {
  const request = key.slice("indexer ".length);
  for (let at = request.lastIndexOf(" {"); at > 0; at = request.lastIndexOf(" {", at - 1)) {
    try {
      JSON.parse(request.slice(at + 1));
      return request.slice(0, at);
    } catch {
      // Not the variables yet: keep looking further left.
    }
  }
  return request;
}

export function recordingFetch(
  realFetch: typeof fetch,
  proofServer: string | undefined,
  exchanges: Map<string, Exchange>,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const response = await realFetch(input, init);
    const body = await response.clone().text();
    const key = exchangeKey(url, bodyText(init?.body), proofServer);
    exchanges.set(key, {
      key,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body,
    });
    return response;
  }) as typeof fetch;
}

export function replayFetch(fixture: FixtureFile, proofServer: string | undefined): typeof fetch {
  const byKey = new Map(fixture.exchanges.map((e) => [e.key, e]));
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = exchangeKey(url, bodyText(init?.body), proofServer);
    const exchange = byKey.get(key);
    if (!exchange) {
      throw new Error(`No recorded response for ${key}; run npm run fixtures to record it`);
    }
    return new Response(exchange.body, { status: exchange.status, headers: { "content-type": exchange.contentType } });
  }) as typeof fetch;
}

/** Keys and value types, not values: `{"a":[{"b":1}]}` -> `{a:[{b:number}]}`. */
export function shapeOf(value: unknown): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0])] : [];
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, shapeOf(v)]),
    );
  }
  return typeof value;
}

function parsedBody(exchange: Exchange): unknown {
  try {
    return JSON.parse(exchange.body);
  } catch {
    return exchange.body.length ? "text" : "empty";
  }
}

export interface ShapeDrift {
  key: string;
  change: "missing" | "new" | "shape" | "status";
  recorded?: string;
  live?: string;
}

// Values that vary by block or are optional in the indexer schema read as null on one run and a value on the next.
function compatible(recorded: unknown, live: unknown): boolean {
  if (recorded === "null" || live === "null") return true;
  if (Array.isArray(recorded) && Array.isArray(live)) {
    return !recorded.length || !live.length || compatible(recorded[0], live[0]);
  }
  if (typeof recorded === "object" && typeof live === "object" && recorded && live) {
    const a = recorded as Record<string, unknown>;
    const b = live as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => k in a && k in b && compatible(a[k], b[k]));
  }
  return recorded === live;
}

// Heights and hashes differ between recordings; the request kind doesn't.
function requestKind(key: string): string {
  return key.replace(/"0x[0-9a-f]+"/gi, '"0x"').replace(/\b\d+\b/g, "#");
}

export function compareShapes(recorded: Exchange[], live: Exchange[]): ShapeDrift[] {
  const liveByKey = new Map(live.map((e) => [requestKind(e.key), e]));
  const recordedKeys = new Set(recorded.map((e) => requestKind(e.key)));
  const drift: ShapeDrift[] = [];
  for (const before of recorded) {
    const after = liveByKey.get(requestKind(before.key));
    if (!after) {
      drift.push({ key: before.key, change: "missing" });
    } else if (before.status !== after.status) {
      drift.push({ key: before.key, change: "status", recorded: String(before.status), live: String(after.status) });
    } else {
      const a = shapeOf(parsedBody(before));
      const b = shapeOf(parsedBody(after));
      if (!compatible(a, b)) {
        drift.push({ key: before.key, change: "shape", recorded: JSON.stringify(a), live: JSON.stringify(b) });
      }
    }
  }
  for (const after of live) {
    if (!recordedKeys.has(requestKind(after.key))) drift.push({ key: after.key, change: "new" });
  }
  return drift;
}
