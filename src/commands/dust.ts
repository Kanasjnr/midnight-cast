import {
  subscribeDustEvents,
  truncateRaw,
  type DustLedgerEventPayload,
} from "../clients/indexer.js";
import { resolveNetwork, type ResolveFlags } from "../config.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail } from "../output.js";

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
    return fail(err instanceof Error ? err.message : String(err));
  }

  try {
    const events = await subscribeDustEvents(endpoints, {
      fromId: eventId,
      targetId: eventId,
      limit: 1,
      timeoutMs: flags.timeoutMs ?? 15000,
    });

    if (events.length === 0) {
      return fail(`Event ${eventId} not found`);
    }

    return {
      ok: true,
      data: formatEvent(events[0]!, flags.verbose ?? false),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("WS")) {
      return fail(`Indexer WS unreachable: ${msg}`);
    }
    return fail(msg);
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
    return fail(err instanceof Error ? err.message : String(err));
  }

  const limit = flags.limit ?? 10;
  const from = flags.from;

  try {
    const events = await subscribeDustEvents(endpoints, {
      fromId: from,
      limit,
      timeoutMs: flags.timeoutMs ?? 30000,
    });

    if (events.length === 0) {
      return fail("No dust events received within timeout");
    }

    const sorted = [...events].sort((a, b) => a.id - b.id).slice(0, limit);

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
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("WS")) {
      return fail(`Indexer WS unreachable: ${msg}`);
    }
    return fail(msg);
  }
}
