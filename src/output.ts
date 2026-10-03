import { NetworkError } from "./lib/network-error.js";
import { sanitizeDeep, sanitizeForOutput } from "./lib/sanitize.js";

export const SCHEMA_VERSION = 1;

export interface NextStep {
  command: string;
  reason: string;
}

export interface EmitResult<T = unknown> {
  ok: boolean;
  error?: string;
  errorKind?: string;
  hint?: string;
  data?: T;
  exitCode?: number;
  network?: string;
  next?: NextStep[];
}

export interface GlobalOptions {
  json?: boolean;
  command?: string;
}

export interface Envelope<T = unknown> {
  schemaVersion: typeof SCHEMA_VERSION;
  ok: boolean;
  command: string | null;
  network: string | null;
  data: T | null;
  warnings: string[];
  error: { message: string; kind: string | null; hint: string | null } | null;
  next: NextStep[];
}

const pendingWarnings: string[] = [];

export function warn(message: string): void {
  if (!pendingWarnings.includes(message)) pendingWarnings.push(message);
}

export function emit<T>(
  result: EmitResult<T>,
  options: GlobalOptions,
): number {
  const warnings = pendingWarnings.splice(0).map(sanitizeForOutput);
  const safe = sanitizeEmitResult(result);

  if (options.json) {
    console.log(JSON.stringify(toEnvelope(safe, options.command, warnings), null, 2));
  } else {
    for (const message of warnings) console.error(message);
    if (safe.data !== undefined) printHuman(safe.data);
    if (!safe.ok && safe.error) console.error(safe.error);
    if (!safe.ok && safe.hint) console.error(`Hint: ${safe.hint}`);
  }

  if (!safe.ok) {
    return safe.exitCode ?? 1;
  }
  return safe.exitCode ?? 0;
}

export function toEnvelope<T>(result: EmitResult<T>, command: string | undefined, warnings: string[]): Envelope<T> {
  const dataNetwork = (result.data as { network?: unknown } | undefined)?.network;
  return {
    schemaVersion: SCHEMA_VERSION,
    ok: result.ok,
    command: command ?? null,
    network: result.network ?? (typeof dataNetwork === "string" ? dataNetwork : null),
    data: result.data ?? null,
    warnings,
    error: result.ok
      ? null
      : { message: result.error ?? "Command failed", kind: result.errorKind ?? null, hint: result.hint ?? null },
    next: result.next ?? [],
  };
}

function sanitizeEmitResult<T>(result: EmitResult<T>): EmitResult<T> {
  const next: EmitResult<T> = { ...result };
  if (next.error !== undefined) {
    next.error = sanitizeForOutput(next.error);
  }
  if (next.hint !== undefined) {
    next.hint = sanitizeForOutput(next.hint);
  }
  if (next.data !== undefined) {
    next.data = sanitizeDeep(next.data);
  }
  if (next.next !== undefined) {
    next.next = sanitizeDeep(next.next);
  }
  return next;
}

function printHuman(data: unknown): void {
  if (data === null || data === undefined) {
    return;
  }
  if (typeof data === "string") {
    console.log(sanitizeForOutput(data));
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
  if (typeof value === "string") return sanitizeForOutput(value);
  if (typeof value === "object") return JSON.stringify(sanitizeDeep(value));
  return String(value);
}

export function fail(
  error: unknown,
  exitCode = 1,
): EmitResult<never> {
  if (error instanceof NetworkError) {
    return {
      ok: false,
      error: error.message,
      errorKind: error.kind,
      ...(error.hint ? { hint: error.hint } : {}),
      exitCode,
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error), exitCode };
}

export function success<T>(data: T, exitCode = 0): EmitResult<T> {
  return { ok: true, data, exitCode };
}
