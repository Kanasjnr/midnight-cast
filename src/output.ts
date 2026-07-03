import { sanitizeForOutput } from "./lib/sanitize.js";

export interface EmitResult<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
  exitCode?: number;
}

export interface GlobalOptions {
  json?: boolean;
}

export function emit<T>(
  result: EmitResult<T>,
  options: GlobalOptions,
): number {
  const safe = sanitizeEmitResult(result);

  if (options.json) {
    const { exitCode: _exitCode, ...publicPayload } = safe;
    console.log(JSON.stringify(publicPayload, null, 2));
  } else if (safe.ok && safe.data !== undefined) {
    printHuman(safe.data);
  } else if (!safe.ok && safe.error) {
    console.error(safe.error);
  }

  if (!safe.ok) {
    return safe.exitCode ?? 1;
  }
  return safe.exitCode ?? 0;
}

function sanitizeEmitResult<T>(result: EmitResult<T>): EmitResult<T> {
  if (!result.error) return result;
  return { ...result, error: sanitizeForOutput(result.error) };
}

function printHuman(data: unknown): void {
  if (data === null || data === undefined) {
    return;
  }
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  if (Array.isArray(data)) {
    for (const row of data) {
      if (typeof row === "object" && row !== null) {
        console.log(formatRow(row as Record<string, unknown>));
      } else {
        console.log(String(row));
      }
    }
    return;
  }
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if ("table" in obj && Array.isArray(obj.table)) {
      for (const row of obj.table as Record<string, unknown>[]) {
        console.log(formatRow(row));
      }
      if ("footer" in obj && typeof obj.footer === "string") {
        console.log(obj.footer);
      }
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      console.log(`${key}: ${formatValue(value)}`);
    }
  }
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join("  ");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function fail(
  error: string,
  exitCode = 1,
): EmitResult<never> {
  return { ok: false, error, exitCode };
}

export function success<T>(data: T, exitCode = 0): EmitResult<T> {
  return { ok: true, data, exitCode };
}
