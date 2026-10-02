const RETRYABLE_STATUS = new Set([502, 503, 504]);

export interface PostJsonOptions {
  timeoutMs: number;
  attempts?: number;
  budgetMs?: number;
  retryDelayMs?: number;
  minAttemptMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postJson(
  url: string,
  body: unknown,
  {
    timeoutMs,
    attempts = 3,
    budgetMs = 20_000,
    retryDelayMs = 300,
    minAttemptMs = 1000,
    headers = {},
  }: PostJsonOptions,
): Promise<Response> {
  const deadline = Date.now() + budgetMs;
  const noTimeForAnother = (delay: number) => deadline - Date.now() - delay < minAttemptMs;
  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now();
    const delay = retryDelayMs * attempt;
    const isLast = attempt >= attempts;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, remaining))),
      });
      if (!RETRYABLE_STATUS.has(response.status) || isLast || noTimeForAnother(delay)) {
        return response;
      }
      await response.body?.cancel();
    } catch (err) {
      if (isLast || noTimeForAnother(delay)) throw err;
    }
    await sleep(delay);
  }
}
