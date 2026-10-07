// GETs from GitHub for the live-check scripts: retries server errors and dropped connections, so
// one blip doesn't fail a check, and sends GITHUB_TOKEN to api.github.com, whose unauthenticated
// limit shared runners can exhaust.

export async function fetchGitHub(url: string, attempts = 3): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const api = url.startsWith("https://api.github.com/");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: api ? { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.text();
      if (res.status < 500 || attempt === attempts) throw new Error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      if (attempt === attempts || /HTTP 4\d\d/.test(String(err))) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
}

/** A warning the GitHub Actions run shows on its summary page, or a plain line elsewhere. */
export function notice(title: string, message: string): void {
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${title}::${message.replace(/\n/g, " ")}`);
  else console.log(`Note: ${message}`);
}
