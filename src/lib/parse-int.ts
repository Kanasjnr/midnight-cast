export function parseIntOrFail(
  value: string,
  label: string,
  options?: { min?: number; max?: number },
): number | { error: string } {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return { error: `Invalid ${label}: "${value}" (expected integer)` };
  }

  const n = Number(trimmed);
  if (!Number.isSafeInteger(n)) {
    return { error: `Invalid ${label}: "${value}" (out of range)` };
  }

  if (options?.min !== undefined && n < options.min) {
    return { error: `Invalid ${label}: ${n} (minimum ${options.min})` };
  }
  if (options?.max !== undefined && n > options.max) {
    return { error: `Invalid ${label}: ${n} (maximum ${options.max})` };
  }

  return n;
}
