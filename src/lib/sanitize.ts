import { BLOCKFROST_ENV } from "./blockfrost.js";

export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

const secrets = new Set<string>();
const PROJECT_ID_PARAM = /(project_id(?:=|%3D))[^&\s"'<>]+/gi;
const BLOCKFROST_MIDNIGHT_ID = /\bnight(?:mainnet|preprod|preview)[A-Za-z0-9]{8,}/g;

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) secrets.add(value);
}

export function redactSecrets(text: string): string {
  let out = text;
  const env = process.env[BLOCKFROST_ENV];
  for (const s of env && env.length >= 8 ? [...secrets, env] : secrets) {
    out = out.split(s).join("***");
  }
  return out.replace(PROJECT_ID_PARAM, "$1***").replace(BLOCKFROST_MIDNIGHT_ID, "***");
}

export function sanitizeForOutput(text: string): string {
  return redactSecrets(stripControlChars(text));
}

export function sanitizeDeep<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeForOutput(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeDeep(entry);
    }
    return out as T;
  }
  return value;
}
