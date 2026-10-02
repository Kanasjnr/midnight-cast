const RETRYABLE_STATUS = new Set([502, 503, 504]);

export interface PostJsonOptions {
  timeoutMs: number;
  attempts?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries timeouts, network errors and 502/503/504: public endpoints such as
// preprod's RPC are load-balanced, and a retry usually reaches a healthy
// backend. Only read-only calls should use more than one attempt.
export async function postJson(
  url: string,
  body: unknown,
  { timeoutMs, attempts = 3, retryDelayMs = 300, headers = {} }: PostJsonOptions,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= attempts) {
        return response;
      }
    } catch (err) {
      if (attempt >= attempts) throw err;
    }
    await sleep(retryDelayMs * attempt);
  }
}
