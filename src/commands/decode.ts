import { loadDataJson } from "../lib/data-path.js";
import { parseRawErrorMessage } from "../lib/error-parse.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

export interface DecodeOptions extends GlobalOptions {
  raw?: string;
}

interface ErrorCodeEntry {
  name: string;
  description: string;
  fix: string;
}

interface ErrorCodesFile {
  docUrl: string;
  ledger?: string;
  updated?: string;
  source?: string;
  codes: Record<string, ErrorCodeEntry>;
}

interface PalletVariant {
  name: string;
  description: string;
  fix: string;
}

interface PalletErrorsFile {
  docUrl: string;
  pallets: Record<
    string,
    {
      name: string;
      description: string;
      variants: Record<string, PalletVariant>;
    }
  >;
}

interface JsonRpcErrorsFile {
  docUrl: string;
  codes: Record<string, ErrorCodeEntry>;
}

const SUBSTRATE_1010 = {
  code: 1010,
  name: "InvalidTransaction",
  description:
    "Substrate transaction pool rejected the extrinsic. This is an envelope code, not a Midnight ledger code.",
  steps: [
    "Find Custom error: N in the error message (u8, 0–255).",
    "Run: mn decode ledger N   (or: mn decode N)",
    "If DispatchError::Module { index, error }, run: mn decode pallet <index> <error>",
    "If there is no inner Custom(N), rejection was upstream Substrate validation (nonce, fee, size, etc.).",
  ],
  docUrl:
    "https://docs.midnight.network/how-to/decode-1010-transaction-rejection-errors",
  ledgerDocUrl: "https://docs.midnight.network/nodes/error-codes",
};

function parseLedgerCodeInput(input: string): string | null {
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

function findLedgerByName(name: string, data: ErrorCodesFile): string | null {
  const normalized = name.replace(/\s+/g, "");
  for (const [code, entry] of Object.entries(data.codes)) {
    if (entry.name.toLowerCase() === normalized.toLowerCase()) {
      return code;
    }
  }
  return null;
}

function decodeLedger(input: string, options: DecodeOptions): EmitResult {
  const data = loadDataJson<ErrorCodesFile>("error-codes.json");
  const numericKey = parseLedgerCodeInput(input);
  let code: string | null = numericKey;

  if (!code) {
    code = findLedgerByName(input, data);
  }

  if (!code || !data.codes[code]) {
    return fail(`Unknown ledger error code: ${input}`);
  }

  const entry = data.codes[code]!;
  const payload = {
    kind: "ledger" as const,
    code: parseInt(code, 10),
    name: entry.name,
    description: entry.description,
    fix: entry.fix,
    docUrl: data.docUrl,
    ledger: data.ledger,
    mapUpdated: data.updated,
  };

  if (options.json) {
    return success(payload);
  }

  const meta =
    data.ledger && data.updated
      ? `Map:    ledger ${data.ledger} (updated ${data.updated})`
      : undefined;

  const text = [
    `Kind:   ledger (Custom ${code})`,
    `Name:   ${entry.name}`,
    `Desc:   ${entry.description}`,
    `Fix:    ${entry.fix}`,
    ...(meta ? [meta] : []),
    `Docs:   ${data.docUrl}`,
  ].join("\n");

  return success(text);
}

function findPalletIndex(
  pallets: PalletErrorsFile["pallets"],
  indexOrName: string,
): string | null {
  if (pallets[indexOrName]) return indexOrName;
  const lower = indexOrName.toLowerCase();
  for (const [index, pallet] of Object.entries(pallets)) {
    if (pallet.name.toLowerCase() === lower) return index;
  }
  return null;
}

function findPalletVariant(
  variants: Record<string, PalletVariant>,
  variantOrName: string,
): string | null {
  if (variants[variantOrName]) return variantOrName;
  const lower = variantOrName.toLowerCase();
  for (const [v, entry] of Object.entries(variants)) {
    if (entry.name.toLowerCase() === lower) return v;
  }
  return null;
}

function decodePallet(
  indexArg: string,
  variantArg: string,
  options: DecodeOptions,
): EmitResult {
  const data = loadDataJson<PalletErrorsFile>("pallet-errors.json");
  const palletIndex = findPalletIndex(data.pallets, indexArg);

  if (!palletIndex) {
    return fail(`Unknown pallet index or name: ${indexArg}`);
  }

  const pallet = data.pallets[palletIndex]!;
  const variantKey = findPalletVariant(pallet.variants, variantArg);

  if (!variantKey || !pallet.variants[variantKey]) {
    return fail(
      `Unknown variant ${variantArg} for pallet ${pallet.name} (index ${palletIndex})`,
    );
  }

  const variant = pallet.variants[variantKey]!;
  const payload = {
    kind: "pallet" as const,
    palletIndex: parseInt(palletIndex, 10),
    palletName: pallet.name,
    variant: parseInt(variantKey, 10),
    variantName: variant.name,
    palletDescription: pallet.description,
    description: variant.description,
    fix: variant.fix,
    docUrl: data.docUrl,
  };

  if (options.json) {
    return success(payload);
  }

  const text = [
    `Kind:    pallet (DispatchError::Module)`,
    `Pallet:  ${palletIndex} (${pallet.name})`,
    `Variant: ${variantKey} (${variant.name})`,
    `Desc:    ${variant.description}`,
    `Fix:     ${variant.fix}`,
    `Docs:    ${data.docUrl}`,
  ].join("\n");

  return success(text);
}

function decodeJsonRpc(codeArg: string, options: DecodeOptions): EmitResult {
  const data = loadDataJson<JsonRpcErrorsFile>("jsonrpc-errors.json");
  const key = codeArg.startsWith("-") ? codeArg : `-${codeArg}`;
  const entry = data.codes[key] ?? data.codes[codeArg];

  if (!entry) {
    return fail(`Unknown JSON-RPC error code: ${codeArg}`);
  }

  const payload = {
    kind: "jsonrpc" as const,
    code: parseInt(key, 10),
    name: entry.name,
    description: entry.description,
    fix: entry.fix,
    docUrl: data.docUrl,
  };

  if (options.json) {
    return success(payload);
  }

  const text = [
    `Kind:   jsonrpc`,
    `Code:   ${key} (${entry.name})`,
    `Desc:   ${entry.description}`,
    `Fix:    ${entry.fix}`,
    `Docs:   ${data.docUrl}`,
  ].join("\n");

  return success(text);
}

function decode1010(options: DecodeOptions): EmitResult {
  if (options.json) {
    return success(SUBSTRATE_1010);
  }

  const text = [
    `Kind:  substrate (${SUBSTRATE_1010.code} ${SUBSTRATE_1010.name})`,
    `Desc:  ${SUBSTRATE_1010.description}`,
    ``,
    `Next steps:`,
    ...SUBSTRATE_1010.steps.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Guide: ${SUBSTRATE_1010.docUrl}`,
    `Ledger codes: ${SUBSTRATE_1010.ledgerDocUrl}`,
  ].join("\n");

  return success(text);
}

function decodeRaw(raw: string, options: DecodeOptions): EmitResult {
  const parsed = parseRawErrorMessage(raw);
  const parts: EmitResult[] = [];
  const sections: string[] = [`Parsed: ${raw}`, ""];

  if (parsed.substrate1010) {
    const r = decode1010(options);
    if (r.ok) parts.push(r);
    if (!options.json && typeof r.data === "string") {
      sections.push(r.data, "");
    }
  }

  if (parsed.ledgerCode) {
    const r = decodeLedger(parsed.ledgerCode, options);
    if (r.ok) parts.push(r);
    if (!options.json && typeof r.data === "string") {
      sections.push(r.data, "");
    }
  }

  if (parsed.palletIndex && parsed.palletVariant) {
    const r = decodePallet(parsed.palletIndex, parsed.palletVariant, options);
    if (r.ok) parts.push(r);
    if (!options.json && typeof r.data === "string") {
      sections.push(r.data, "");
    }
  }

  if (parts.length === 0) {
    return fail(
      "Could not extract 1010, Custom(N), or pallet index/error from message. " +
        "Try: mn decode ledger <N> or mn decode 1010",
    );
  }

  if (options.json) {
    return success({
      raw,
      parsed,
      decodings: parts.map((p) => p.data),
    });
  }

  return success(sections.join("\n").trimEnd());
}

export function decodeCommand(
  args: string[],
  options: DecodeOptions,
): EmitResult {
  if (options.raw) {
    return decodeRaw(options.raw, options);
  }

  if (args.length === 0) {
    return fail(
      "Usage: mn decode <code> | decode --raw \"<error>\" | decode ledger <code> | decode pallet <index> <variant> | decode 1010 | decode jsonrpc <code>",
    );
  }

  const [head, ...rest] = args;

  if (head === "1010" || head === "substrate") {
    return decode1010(options);
  }

  if (head === "ledger") {
    if (!rest[0]) return fail("Usage: mn decode ledger <code>");
    return decodeLedger(rest[0], options);
  }

  if (head === "pallet") {
    if (rest.length < 2) {
      return fail("Usage: mn decode pallet <index|name> <variant|name>");
    }
    return decodePallet(rest[0]!, rest[1]!, options);
  }

  if (head === "jsonrpc") {
    if (!rest[0]) return fail("Usage: mn decode jsonrpc <code>");
    return decodeJsonRpc(rest[0], options);
  }

  return decodeLedger(head, options);
}
