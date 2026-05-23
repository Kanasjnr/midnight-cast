import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

interface ErrorCodeEntry {
  name: string;
  description: string;
  fix: string;
}

interface ErrorCodesFile {
  docUrl: string;
  codes: Record<string, ErrorCodeEntry>;
}

let cached: ErrorCodesFile | null = null;

function loadErrorCodes(): ErrorCodesFile {
  if (cached) return cached;
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "..", "data", "error-codes.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as ErrorCodesFile;
  return cached;
}

function parseCodeInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n >= 0 && n <= 255) return String(n);
    return null;
  }
  if (/^0x[0-9a-fA-F]{1,2}$/.test(trimmed)) {
    return String(parseInt(trimmed, 16));
  }
  return null;
}

function findByName(name: string, data: ErrorCodesFile): string | null {
  const normalized = name.replace(/\s+/g, "");
  for (const [code, entry] of Object.entries(data.codes)) {
    if (entry.name.toLowerCase() === normalized.toLowerCase()) {
      return code;
    }
  }
  return null;
}

export function decodeCommand(
  input: string,
  options: GlobalOptions,
): EmitResult {
  const data = loadErrorCodes();
  const numericKey = parseCodeInput(input);
  let code: string | null = numericKey;

  if (!code) {
    code = findByName(input, data);
  }

  if (!code || !data.codes[code]) {
    return fail(`Unknown error code: ${input}`);
  }

  const entry = data.codes[code]!;
  const payload = {
    code: parseInt(code, 10),
    name: entry.name,
    description: entry.description,
    fix: entry.fix,
    docUrl: data.docUrl,
  };

  if (options.json) {
    return success(payload);
  }

  const text = [
    `Code:   ${code} (${entry.name})`,
    `Desc:   ${entry.description}`,
    `Fix:    ${entry.fix}`,
    `Docs:   ${data.docUrl}`,
  ].join("\n");

  return success(text);
}
