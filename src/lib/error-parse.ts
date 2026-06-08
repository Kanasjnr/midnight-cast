export interface ParsedRawError {
  substrate1010: boolean;
  ledgerCode?: string;
  palletIndex?: string;
  palletVariant?: string;
}

export function parseRawErrorMessage(raw: string): ParsedRawError {
  const result: ParsedRawError = { substrate1010: false };

  if (/\b1010\b/.test(raw) || /Invalid\s+Transaction/i.test(raw)) {
    result.substrate1010 = true;
  }

  const customMatch =
    raw.match(/Custom(?:\s+error)?:\s*(\d+)/i) ??
    raw.match(/Custom\s*\(\s*(\d+)\s*\)/i);
  if (customMatch?.[1]) {
    result.ledgerCode = customMatch[1];
  }

  const moduleMatch =
    raw.match(
      /Module\s*\{[^}]*index:\s*(\d+)[^}]*error:\s*(\d+)/i,
    ) ??
    raw.match(/index:\s*(\d+)[^,}]*error:\s*(\d+)/i);
  if (moduleMatch?.[1] && moduleMatch[2]) {
    result.palletIndex = moduleMatch[1];
    result.palletVariant = moduleMatch[2];
  }

  return result;
}
