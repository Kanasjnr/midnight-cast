// Writes src/data/examples-reports.json: a summary of every regression report in
// midnightntwrk/midnight-examples, bundled as the fallback for when the report for a
// network's node version can't be fetched.
//
//   tsx scripts/examples-reports.ts [--check]
//
// --check exits 1 if a report was added, removed or changed since the bundled summaries
// were written, and 2 if the reports couldn't be read. GITHUB_TOKEN, if set, raises the
// GitHub API rate limit for listing the reports.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXAMPLES_REPO,
  reportPath,
  summarizeReport,
  type BundledReports,
  type ExamplesReport,
} from "../src/lib/examples-report.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundledPath = join(root, "src", "data", "examples-reports.json");

/** GETs JSON, retrying server errors and dropped connections so one blip doesn't fail the live check. */
async function get(url: string, attempts = 3): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.json();
      if (res.status < 500 || attempt === attempts) throw new Error(`${url}: HTTP ${res.status}`);
    } catch (err) {
      if (attempt === attempts || String(err).includes("HTTP 4")) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
  }
}

/** Every report in the repository, by node version. */
export async function fetchReports(): Promise<Record<string, ExamplesReport>> {
  const listing = (await get(`https://api.github.com/repos/${EXAMPLES_REPO}/contents/reports`)) as Array<{ name: string }>;
  const versions = listing
    .map((entry) => /^node-(\d+\.\d+\.\d+)-regression\.json$/.exec(entry.name)?.[1])
    .filter((v): v is string => !!v)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const reports = await Promise.all(
    versions.map(async (version) => {
      const report = summarizeReport(await get(`https://raw.githubusercontent.com/${EXAMPLES_REPO}/main/${reportPath(version)}`));
      if (report.nodeVersion !== version) throw new Error(`${reportPath(version)} is about node ${report.nodeVersion}`);
      return [version, report] as const;
    }),
  );
  return Object.fromEntries(reports);
}

/** What changed between the bundled summaries and the repository's reports. */
export function reportChanges(bundled: Record<string, ExamplesReport>, current: Record<string, ExamplesReport>): string[] {
  const changes: string[] = [];
  for (const version of Object.keys(current)) {
    if (!bundled[version]) changes.push(`new report: node ${version}`);
    else if (JSON.stringify(bundled[version]) !== JSON.stringify(current[version])) changes.push(`changed report: node ${version}`);
  }
  for (const version of Object.keys(bundled)) if (!current[version]) changes.push(`removed report: node ${version}`);
  return changes;
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const bundled = JSON.parse(readFileSync(bundledPath, "utf8")) as BundledReports;
  let current: Record<string, ExamplesReport>;
  try {
    current = await fetchReports();
  } catch (err) {
    console.error(`Couldn't read the examples reports, so this check is incomplete: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  const changes = reportChanges(bundled.reports, current);
  if (!changes.length) {
    console.log(`The bundled summaries match the ${Object.keys(current).length} reports in ${EXAMPLES_REPO}.`);
    return 0;
  }
  if (check) {
    console.log(changes.join("\n"));
    console.log("Run npm run examples-reports to update src/data/examples-reports.json.");
    return 1;
  }
  const updated: BundledReports = { updated: new Date().toISOString().slice(0, 10), reports: current };
  writeFileSync(bundledPath, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`${changes.join("\n")}\nwrote src/data/examples-reports.json`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
    },
  );
}
