export function stripControlChars(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sanitizeForOutput(text: string): string {
  return stripControlChars(text);
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
