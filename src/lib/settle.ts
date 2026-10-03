export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Starts work now and reports its outcome later, without an unhandled rejection if nobody waits. */
export function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
}
