const DEFAULT_TIMEOUT_MS = 5000;

export function proofServerVersionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/version`;
}

export function proofServerBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export async function fetchProofServerVersion(
  baseUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const response = await fetch(proofServerVersionUrl(baseUrl), {
    method: "GET",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();
  if (!text) {
    throw new Error("empty version response");
  }

  return text.split(/\s+/)[0] ?? text;
}
