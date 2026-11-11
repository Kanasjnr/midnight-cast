import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDataJson } from "../src/lib/data-path.js";
import type { MatrixNetwork, SupportMatrixFile } from "../src/lib/versions.js";

/** The bundled support matrix, for a test to change one network's row. */
export const bundledMatrix = (): SupportMatrixFile => loadDataJson<SupportMatrixFile>("support-matrix.json");

/** A Ledger 8 row, as preprod ran before its upgrade on 9 November 2026. */
export const LEDGER_8_ROW: Partial<MatrixNetwork> = {
  node: "1.0.400",
  minNode: "1.0.400",
  runtimeSpec: 1000300,
  ledger: "8.1.3",
  proofServer: "8.1.0",
  onChainRuntime: "3.0.0",
  packages: { "@midnight-ntwrk/compact-runtime": "0.16.0" },
};

/**
 * Runs work with a support-matrix override in a fresh config home: the bundled matrix with the given networks'
 * rows changed. The config home and XDG_CONFIG_HOME are restored after, whatever the work does.
 */
export async function withSupportMatrix<T>(rows: Record<string, Partial<MatrixNetwork>>, work: () => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "midnight-cast-matrix-"));
  const previous = process.env.XDG_CONFIG_HOME;
  try {
    mkdirSync(join(dir, "midnight-cast"), { recursive: true });
    const matrix = bundledMatrix();
    const networks = { ...matrix.networks };
    for (const [name, row] of Object.entries(rows)) networks[name] = { ...networks[name], ...row } as MatrixNetwork;
    writeFileSync(join(dir, "midnight-cast", "support-matrix.json"), JSON.stringify({ ...matrix, networks }));
    process.env.XDG_CONFIG_HOME = dir;
    return await work();
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}
