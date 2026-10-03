import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeMatrixSource,
  overlayUpstream,
  resolveSupportMatrix,
  versionFromTag,
} from "../src/lib/upstream-matrix.js";
import type { SupportMatrixFile } from "../src/lib/versions.js";

const bundled: SupportMatrixFile = {
  docUrl: "https://docs.midnight.network/relnotes/support-matrix",
  updated: "2026-10",
  networks: {
    preprod: {
      node: "1.0.300",
      minNode: "1.0.300",
      runtimeSpec: 1000300,
      ledger: "8.1.2",
      indexer: "4.3.302",
      indexerApi: "v4",
      proofServer: "8.1.0",
      onChainRuntime: "3.0.0",
      packages: { "@midnight-ntwrk/compact-runtime": "0.16.0", "@midnight-ntwrk/ledger-v8": "8.1.2" },
    },
  },
};

// Shaped like midnight-docs/docs/relnotes/support-matrix.json.
const published = {
  components: [
    { component: "Node (Midnight)", versions: { preprod: { tag: "node-1.0.400", containerTag: "node-1.0.300" } } },
    { component: "Midnight Indexer", versions: { preprod: { tag: "midnight-indexer-4.3.400" } } },
    { component: "Proof server", versions: { preprod: { tag: "proof-server-8.2.0" } } },
    { component: "On-chain runtime", versions: { preprod: { tag: "onchain-runtime-3.0.1" } } },
    { component: "Compact runtime", versions: { preprod: { tag: "compact-runtime-0.16.1" } } },
  ],
};

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const unreachable = (async () => {
  throw new Error("fetch failed");
}) as unknown as typeof fetch;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mc-matrix-"));
  return { cacheDir: join(dir, "cache"), overridePath: join(dir, "none.json"), bundled, offline: false };
}

describe("published support matrix", () => {
  it("parses release tags into versions", () => {
    expect(versionFromTag("node-1.0.400")).toBe("1.0.400");
    expect(versionFromTag("midnight-indexer-4.3.302")).toBe("4.3.302");
    expect(versionFromTag("proof-server-8.1.0")).toBe("8.1.0");
    expect(versionFromTag(undefined)).toBeUndefined();
  });

  it("takes only what the endpoints can't reveal, and notes the file's own disagreements", () => {
    const { matrix, notes } = overlayUpstream(bundled, published);
    const row = matrix.networks.preprod!;
    expect(row.indexer).toBe("4.3.400");
    expect(row.onChainRuntime).toBe("3.0.1");
    expect(row.packages?.["@midnight-ntwrk/compact-runtime"]).toBe("0.16.1");
    expect(row.packages?.["@midnight-ntwrk/ledger-v8"]).toBe("8.1.2");
    expect([row.node, row.minNode, row.runtimeSpec, row.proofServer]).toEqual(["1.0.300", "1.0.300", 1000300, "8.1.0"]);
    expect(notes).toEqual({ preprod: ["node: upstream tag 1.0.400 but containerTag 1.0.300"] });
  });

  it("fetches once, then serves the cache for six hours", async () => {
    const options = setup();
    const now = Date.parse("2026-10-03T10:00:00Z");
    const first = await resolveSupportMatrix({ ...options, now, fetchImpl: respond(published) });
    expect(first.source).toMatchObject({ kind: "upstream", ageMinutes: 0 });
    expect(first.matrix.networks.preprod?.indexer).toBe("4.3.400");

    const later = await resolveSupportMatrix({ ...options, now: now + 60 * 60_000, fetchImpl: unreachable });
    expect(later.source).toMatchObject({ kind: "cache", ageMinutes: 60 });
    expect(describeMatrixSource(later.source)).toBe("Midnight's published matrix (cached 1h ago)");

    const expired = await resolveSupportMatrix({ ...options, now: now + 7 * 60 * 60_000, fetchImpl: respond(published) });
    expect(expired.source.kind).toBe("upstream");
  });

  it("refetches when asked, even with a fresh cache", async () => {
    const options = setup();
    const now = Date.now();
    await resolveSupportMatrix({ ...options, now, fetchImpl: respond(published) });
    const refreshed = await resolveSupportMatrix({ ...options, now, refresh: true, fetchImpl: unreachable });
    expect(refreshed.source).toMatchObject({ kind: "cache", reason: expect.stringContaining("fetch failed") });
  });

  it("falls back to the bundled matrix when offline or unreachable", async () => {
    const options = setup();
    expect((await resolveSupportMatrix({ ...options, offline: true, fetchImpl: respond(published) })).source).toEqual({
      kind: "bundled",
      updated: "2026-10",
      reason: "offline",
    });
    const down = await resolveSupportMatrix({ ...options, fetchImpl: respond({}, 503) });
    expect(down.source).toMatchObject({ kind: "bundled", reason: "published matrix unavailable (HTTP 503)" });
    expect(down.matrix).toBe(bundled);
  });

  it("rejects a published file without components instead of caching it", async () => {
    const options = setup();
    const result = await resolveSupportMatrix({ ...options, fetchImpl: respond({ components: [] }) });
    expect(result.source.kind).toBe("bundled");
  });

  it("uses a local override first, and says when it isn't a matrix", async () => {
    const options = setup();
    writeFileSync(options.overridePath, JSON.stringify({ ...bundled, updated: "2026-11" }));
    const result = await resolveSupportMatrix({ ...options, fetchImpl: unreachable });
    expect(result.source).toEqual({ kind: "override", updated: "2026-11" });

    writeFileSync(options.overridePath, JSON.stringify({ fetchedAt: "x" }));
    await expect(resolveSupportMatrix({ ...options, fetchImpl: unreachable })).rejects.toThrow(/not a support matrix/);
  });

  it("honours MN_OFFLINE", async () => {
    const options = setup();
    expect(process.env.MN_OFFLINE).toBe("1");
    const result = await resolveSupportMatrix({ ...options, offline: undefined, fetchImpl: respond(published) });
    expect(result.source.kind).toBe("bundled");
    expect(() => readFileSync(join(options.cacheDir, "published-support-matrix.json"))).toThrow();
  });

  it("keeps the bundled date as the matrix date, since node and runtime still come from it", async () => {
    const result = await resolveSupportMatrix({ ...setup(), fetchImpl: respond(published) });
    expect(result.matrix.updated).toBe("2026-10");
  });

  it("treats a cache dated in the future as expired", async () => {
    const options = setup();
    const now = Date.parse("2026-10-03T10:00:00Z");
    await resolveSupportMatrix({ ...options, now: now + 30 * 24 * 60 * 60_000, fetchImpl: respond(published) });
    const result = await resolveSupportMatrix({ ...options, now, fetchImpl: respond(published) });
    expect(result.source).toMatchObject({ kind: "upstream", ageMinutes: 0 });
  });

  it("remembers a failed fetch for an hour instead of waiting on it every run", async () => {
    const options = setup();
    const now = Date.parse("2026-10-03T10:00:00Z");
    let calls = 0;
    const counting = (async () => {
      calls++;
      throw new Error("timed out");
    }) as unknown as typeof fetch;
    await resolveSupportMatrix({ ...options, now, fetchImpl: counting });
    const soon = await resolveSupportMatrix({ ...options, now: now + 30 * 60_000, fetchImpl: counting });
    expect(calls).toBe(1);
    expect(soon.source).toMatchObject({ kind: "bundled", reason: expect.stringContaining("retrying after an hour") });
    await resolveSupportMatrix({ ...options, now: now + 2 * 60 * 60_000, fetchImpl: counting });
    expect(calls).toBe(2);
  });

  it("falls back to an old cache only within a week, and never over a newer bundled matrix", async () => {
    const options = setup();
    const fetchedAt = Date.parse("2026-10-03T10:00:00Z");
    await resolveSupportMatrix({ ...options, now: fetchedAt, fetchImpl: respond(published) });

    const twoDays = await resolveSupportMatrix({ ...options, now: fetchedAt + 2 * 24 * 60 * 60_000, fetchImpl: unreachable });
    expect(twoDays.source.kind).toBe("cache");

    const tenDays = await resolveSupportMatrix({
      ...options,
      now: fetchedAt + 10 * 24 * 60 * 60_000,
      refresh: true,
      fetchImpl: unreachable,
    });
    expect(tenDays.source.kind).toBe("bundled");

    const newerRelease = await resolveSupportMatrix({
      ...options,
      bundled: { ...bundled, updated: "2026-10-04" },
      now: fetchedAt + 2 * 24 * 60 * 60_000,
      refresh: true,
      fetchImpl: unreachable,
    });
    expect(newerRelease.source.kind).toBe("bundled");
  });
});
