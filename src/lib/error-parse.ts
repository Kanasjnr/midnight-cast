export interface PalletModuleError {
  index: string;
  variant: string;
}

export interface ParsedRawError {
  substrate1010: boolean;
  ledgerCodes: string[];
  palletModules: PalletModuleError[];
  jsonRpcCodes: string[];
}

const LEDGER_MAX = 255;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function isLedgerCode(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= LEDGER_MAX;
}

function addLedgerCode(codes: string[], value: string): void {
  const n = parseInt(value, 10);
  if (isLedgerCode(n)) codes.push(String(n));
}

function addJsonRpcCode(codes: string[], value: string): void {
  const n = parseInt(value, 10);
  if (n <= -32000 && n >= -32700) codes.push(String(n));
}

function palletKey(p: PalletModuleError): string {
  return `${p.index}:${p.variant}`;
}

function addPalletModule(modules: PalletModuleError[], index: string, variant: string): void {
  const key = palletKey({ index, variant });
  if (!modules.some((m) => palletKey(m) === key)) {
    modules.push({ index, variant });
  }
}

export function parseRawErrorMessage(raw: string): ParsedRawError {
  const ledgerCodes: string[] = [];
  const palletModules: PalletModuleError[] = [];
  const jsonRpcCodes: string[] = [];

  const substrate1010 =
    /\b1010\b/.test(raw) || /Invalid\s+Transaction/i.test(raw);

  const customPatterns = [
    /Custom(?:\s+error)?[\s:(]+(\d{1,3})\b/gi,
    /LedgerApiError[\s:(]+(\d{1,3})\b/gi,
    /LedgerApiError::(\d{1,3})\b/gi,
  ];
  for (const pattern of customPatterns) {
    for (const match of raw.matchAll(pattern)) {
      if (match[1]) addLedgerCode(ledgerCodes, match[1]);
    }
  }

  const hexPattern = /\b0x([0-9a-fA-F]{1,2})\b/g;
  for (const match of raw.matchAll(hexPattern)) {
    if (match[1]) addLedgerCode(ledgerCodes, String(parseInt(match[1], 16)));
  }

  const codeHintPattern =
    /\b(?:ledger|custom|error|code)\s*[=:#]?\s*(\d{1,3})\b/gi;
  for (const match of raw.matchAll(codeHintPattern)) {
    if (match[1]) addLedgerCode(ledgerCodes, match[1]);
  }

  const indexFirstPatterns = [
    /Module\s*\{[^}]*index:\s*(\d+)[^}]*error:\s*(\d+)/gi,
    /DispatchError::Module\s*\{[^}]*index:\s*(\d+)[^}]*error:\s*(\d+)/gi,
    /pallet[_\s]?index[:\s=]+(\d+)[^,;}\n]*(?:variant|error)[:\s=]+(\d+)/gi,
  ];
  for (const pattern of indexFirstPatterns) {
    for (const match of raw.matchAll(pattern)) {
      if (match[1] && match[2]) {
        addPalletModule(palletModules, match[1], match[2]);
      }
    }
  }

  const errorFirstPatterns = [
    /Module\s*\{[^}]*error:\s*(\d+)[^}]*index:\s*(\d+)/gi,
    /DispatchError::Module\s*\{[^}]*error:\s*(\d+)[^}]*index:\s*(\d+)/gi,
  ];
  for (const pattern of errorFirstPatterns) {
    for (const match of raw.matchAll(pattern)) {
      if (match[1] && match[2]) {
        addPalletModule(palletModules, match[2], match[1]);
      }
    }
  }

  for (const match of raw.matchAll(/"code"\s*:\s*(-?\d+)/g)) {
    if (!match[1]) continue;
    const n = parseInt(match[1], 10);
    if (n === 1010) continue;
    if (isLedgerCode(n)) addLedgerCode(ledgerCodes, match[1]);
    else addJsonRpcCode(jsonRpcCodes, match[1]);
  }

  const rpcPatterns = [
    /\bRPC\s*(?:error)?[:\s]+(-?\d+)/gi,
    /\bJSON-?RPC\s*(?:error)?[:\s]+(-?\d+)/gi,
    /\berror\s+code\s+(-?\d+)/gi,
    /\b(-3260\d)\b/g,
    /\b(-320\d{2})\b/g,
  ];
  for (const pattern of rpcPatterns) {
    for (const match of raw.matchAll(pattern)) {
      if (match[1]) addJsonRpcCode(jsonRpcCodes, match[1]);
    }
  }

  const trimmed = raw.trim();
  if (/^\d{1,3}$/.test(trimmed)) {
    addLedgerCode(ledgerCodes, trimmed);
  } else if (/^0x[0-9a-fA-F]{1,2}$/i.test(trimmed)) {
    addLedgerCode(ledgerCodes, String(parseInt(trimmed, 16)));
  }

  return {
    substrate1010,
    ledgerCodes: unique(ledgerCodes),
    palletModules,
    jsonRpcCodes: unique(jsonRpcCodes),
  };
}

export function findLedgerCodesByName(
  raw: string,
  namesByCode: Record<string, string>,
  minNameLength = 10,
): string[] {
  const found: string[] = [];
  const matched = new Set<string>();
  const entries = Object.entries(namesByCode).sort(
    ([, a], [, b]) => b.length - a.length,
  );

  for (const [code, name] of entries) {
    if (name.length < minNameLength) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(raw) && !matched.has(code)) {
      found.push(code);
      matched.add(code);
    }
  }

  return found;
}
