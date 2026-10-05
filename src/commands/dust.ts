import {
  latestDustEventId,
  subscribeDustEvents,
  truncateRaw,
  type DustLedgerEventPayload,
} from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import { settle } from "../lib/settle.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

const LATEST_WINDOW = 4;
const MAX_WIDENINGS = 3;

function formatEvent(
  event: DustLedgerEventPayload,
  verbose: boolean,
): Record<string, unknown> {
  return {
    id: event.id,
    typename: event.__typename,
    protocolVersion: event.protocolVersion,
    raw: truncateRaw(event.raw, verbose),
    maxId: event.maxId,
  };
}

export async function dustEventCommand(
  eventId: number,
  networkArg: string | undefined,
  flags: ResolveFlags & { verbose?: boolean; timeoutMs?: number },
  _options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  // A subscription to an id that doesn't exist yet just waits, so learn the latest id alongside it
  // and give up as soon as that shows the event can't arrive.
  const doneProbing = new AbortController();
  const tooNew = new AbortController();
  const latest = settle(latestDustEventId(endpoints, { signal: doneProbing.signal })).then((result) => {
    if (!result.ok || eventId <= result.value) return undefined;
    tooNew.abort();
    return result.value;
  });

  try {
    const events = await subscribeDustEvents(endpoints, {
      fromId: eventId,
      targetId: eventId,
      limit: 1,
      timeoutMs: flags.timeoutMs ?? 15000,
      signal: tooNew.signal,
    });

    if (events.length === 0) return fail(`DUST event ${eventId} wasn't found on ${endpoints.network}`);

    return {
      ok: true,
      data: formatEvent(events[0]!, flags.verbose ?? false),
    };
  } catch (err) {
    const newest = await latest;
    if (newest === undefined) return fail(err);
    return {
      ok: false,
      error: `DUST event ${eventId} doesn't exist yet on ${endpoints.network}; the latest is ${newest}`,
      next: [{ command: `midnight-cast dust-events ${endpoints.network}`, reason: "See the latest DUST events" }],
    };
  } finally {
    doneProbing.abort();
  }
}

export async function dustEventsCommand(
  networkArg: string | undefined,
  flags: ResolveFlags & {
    from?: number;
    limit?: number;
    verbose?: boolean;
    timeoutMs?: number;
  },
  _options: GlobalOptions,
): Promise<EmitResult> {
  let endpoints;
  try {
    endpoints = resolveNetwork(networkArg ?? flags.network, flags);
  } catch (err) {
    return fail(err);
  }

  const limit = flags.limit ?? 10;
  const timeoutMs = flags.timeoutMs ?? 30000;

  try {
    // Without a starting id, show the latest events rather than the network's first ones. Ids have
    // gaps, so read a window wider than the limit up to the newest id and keep its last events.
    const newest = flags.from === undefined ? await latestDustEventId(endpoints, { timeoutMs }) : undefined;
    let events =
      newest === undefined ? await subscribeDustEvents(endpoints, { fromId: flags.from, limit, timeoutMs }) : [];
    // Widen the window while it holds fewer than limit events and older ids remain.
    for (let window = limit * LATEST_WINDOW, round = 0; newest !== undefined; window *= LATEST_WINDOW, round++) {
      const start = Math.max(0, newest - window + 1);
      events = await subscribeDustEvents(endpoints, { fromId: start, untilId: newest, limit: window, timeoutMs });
      if (events.length >= limit || start === 0 || round === MAX_WIDENINGS) break;
    }

    if (events.length === 0) {
      return fail("No dust events received within timeout");
    }

    const ordered = [...events].sort((a, b) => a.id - b.id);
    const sorted = newest === undefined ? ordered.slice(0, limit) : ordered.slice(-limit);

    return {
      ok: true,
      data: {
        table: sorted.map((e) =>
          formatEvent(e, flags.verbose ?? false),
        ),
        count: sorted.length,
      },
    };
  } catch (err) {
    return fail(err);
  }
}
