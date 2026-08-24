import { loadDataJson } from "../lib/data-path.js";
import {
  findLedgerCodesByName,
  parseRawErrorMessage,
} from "../lib/error-parse.js";
import { loadSupportMatrix } from "../lib/versions.js";
import { NETWORK_NAMES } from "../networks.js";
import type { EmitResult, GlobalOptions } from "../output.js";
import { fail, success } from "../output.js";

const MAX_RAW_ERROR_LENGTH = 16_384;

export interface DecodeOptions extends GlobalOptions {
  raw?: string;
  network?: string;
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

const TRANSCRIPT_LEDGER_CODES = ["179", "180", "181"] as const;

function transcriptVersionHint(code: string): string | undefined {
  if (!TRANSCRIPT_LEDGER_CODES.includes(code as (typeof TRANSCRIPT_LEDGER_CODES)[number])) {
    return undefined;
  }
  return (
    "Related proof/transcript codes: 179 UnsupportedProofVersion, " +
    "180 GuaranteedTranscriptVersion, 181 FallibleTranscriptVersion"
  );
}

function palletTransactionHint(variantName: string): string | undefined {
  if (variantName !== "Transaction") return undefined;
  return (
    "Pallet Transaction wraps an inner Custom(N) ledger error — " +
    "find Custom error: N in the full message, then: mn decode ledger N"
  );
}

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

function ledgerMapMismatch(
  options: DecodeOptions,
  data: ErrorCodesFile,
): string | undefined {
  if (!options.network || !data.ledger) return undefined;
  const row = loadSupportMatrix().networks[options.network];
  if (!row?.ledger || row.ledger === data.ledger) return undefined;
  return (
    `Warning: bundled error map is ledger ${data.ledger}, but ${options.network} ` +
    `matrix expects ledger ${row.ledger}. Code names/fixes may be wrong — ` +
    `refresh from ${data.docUrl}`
  );
}

function ledgerMapMeta(options: DecodeOptions, data: ErrorCodesFile): string | undefined {
  if (!data.updated) return undefined;

  if (options.network) {
    const matrix = loadSupportMatrix();
    const row = matrix.networks[options.network];
    if (row?.ledger) {
      const mismatch =
        data.ledger && data.ledger !== row.ledger
          ? ` — map content is ${data.ledger}`
          : "";
      return `Map:    ledger ${data.ledger ?? row.ledger} (${options.network}, updated ${data.updated})${mismatch}`;
    }
  }

  if (data.ledger) {
    return `Map:    ledger ${data.ledger} (preprod/mainnet default, updated ${data.updated})`;
  }

  return undefined;
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
  const ledgerMeta = ledgerMapMeta(options, data);
  const mapMismatch = ledgerMapMismatch(options, data);
  const transcriptHint = transcriptVersionHint(code);
  const payload = {
    kind: "ledger" as const,
    code: parseInt(code, 10),
    name: entry.name,
    description: entry.description,
    fix: entry.fix,
    docUrl: data.docUrl,
    network: options.network,
    ledger: data.ledger,
    mapLedger: data.ledger,
    networkLedger: options.network
      ? loadSupportMatrix().networks[options.network ?? ""]?.ledger
      : undefined,
    mapUpdated: data.updated,
    ...(mapMismatch ? { mapMismatch } : {}),
    ...(transcriptHint ? { relatedHint: transcriptHint } : {}),
  };

  if (options.json) {
    return success(payload);
  }

  const meta = ledgerMeta;

  const text = [
    `Kind:   ledger (Custom ${code})`,
    `Name:   ${entry.name}`,
    `Desc:   ${entry.description}`,
    `Fix:    ${entry.fix}`,
    ...(transcriptHint ? [`Hint:   ${transcriptHint}`] : []),
    ...(mapMismatch ? [`Warn:   ${mapMismatch}`] : []),
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
  const innerHint = palletTransactionHint(variant.name);
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
    ...(innerHint ? { innerHint } : {}),
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
    ...(innerHint ? [`Hint:    ${innerHint}`] : []),
    `Docs:    ${data.docUrl}`,
  ].join("\n");

  return success(text);
}

function validateDecodeNetwork(network?: string): string | undefined {
  if (!network) return undefined;
  if (!NETWORK_NAMES.includes(network)) {
    throw new Error(
      `Unknown network "${network}". Known: ${NETWORK_NAMES.join(", ")}`,
    );
  }
  return network;
}

function decodeJsonRpc(codeArg: string, options: DecodeOptions): EmitResult {
  const data = loadDataJson<JsonRpcErrorsFile>("jsonrpc-errors.json");
  const trimmed = codeArg.trim();
  const numeric = /^-?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
  const key =
    Number.isInteger(numeric) && numeric < 0 ? String(numeric) : `-${trimmed.replace(/^-/, "")}`;
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

function appendDecodeResult(
  parts: EmitResult[],
  sections: string[],
  result: EmitResult,
  json: boolean | undefined,
): void {
  if (!result.ok) return;
  parts.push(result);
  if (!json && typeof result.data === "string") {
    sections.push(result.data, "");
  }
}

function decodeRaw(raw: string, options: DecodeOptions): EmitResult {
  if (raw.length > MAX_RAW_ERROR_LENGTH) {
    return fail(
      `Error message too long (${raw.length} chars, max ${MAX_RAW_ERROR_LENGTH}). ` +
        "Truncate or pass a shorter excerpt.",
    );
  }
  const parsed = parseRawErrorMessage(raw);
  const ledgerData = loadDataJson<ErrorCodesFile>("error-codes.json");
  const nameCodes = findLedgerCodesByName(
    raw,
    Object.fromEntries(
      Object.entries(ledgerData.codes).map(([code, entry]) => [code, entry.name]),
    ),
  );
  const ledgerCodes = [
    ...new Set([...parsed.ledgerCodes, ...nameCodes]),
  ];

  const parts: EmitResult[] = [];
  const sections: string[] = [`Parsed: ${raw}`, ""];
  const failures: string[] = [];

  if (parsed.substrate1010) {
    appendDecodeResult(parts, sections, decode1010(options), options.json);
  }

  for (const code of ledgerCodes) {
    const r = decodeLedger(code, options);
    if (r.ok) appendDecodeResult(parts, sections, r, options.json);
    else if (r.error) failures.push(r.error);
  }

  for (const pallet of parsed.palletModules) {
    const r = decodePallet(pallet.index, pallet.variant, options);
    if (r.ok) appendDecodeResult(parts, sections, r, options.json);
    else if (r.error) failures.push(r.error);
  }

  for (const code of parsed.jsonRpcCodes) {
    const r = decodeJsonRpc(code, options);
    if (r.ok) appendDecodeResult(parts, sections, r, options.json);
    else if (r.error) failures.push(r.error);
  }

  if (parts.length === 0) {
    const fallbackLedger = decodeLedger(raw.trim(), options);
    if (fallbackLedger.ok) {
      appendDecodeResult(parts, sections, fallbackLedger, options.json);
    } else if (fallbackLedger.error) {
      failures.push(fallbackLedger.error);
    }
  }

  if (parts.length === 0) {
    return fail(
      failures[0] ??
        otherErrorRouterHint(raw) ??
        "Could not extract a known error from message. " +
          "Paste 1010/Custom(N)/pallet/RPC text, or run: midnight-cast decode ledger <N>",
    );
  }

  if (options.json) {
    return success({
      raw,
      parsed: { ...parsed, ledgerCodes, ledgerNames: nameCodes },
      decodings: parts.map((p) => p.data),
      ...(failures.length > 0 ? { warnings: failures } : {}),
    });
  }

  if (failures.length > 0) {
    sections.push(
      "Note:",
      ...failures.map((f) => `  - ${f}`),
    );
  }

  return success(sections.join("\n").trimEnd());
}

function otherErrorRouterHint(raw: string): string | undefined {
  const lower = raw.toLowerCase();
  if (
    /compact|witness|zkir|circuit|implicit disclosure/i.test(raw) ||
    lower.includes("compactc")
  ) {
    return (
      "This looks like a Compact / witness / ZKIR error — midnight-cast only decodes " +
      "ledger/pallet/1010/JSON-RPC. Try Midnight Expert compact-debugging or Compact CLI logs."
    );
  }
  if (
    /effect|wallet|lace|dapp.?connector|provider/i.test(raw) ||
    lower.includes("@midnight-ntwrk/wallet")
  ) {
    return (
      "This looks like an SDK / wallet / Lace error — midnight-cast does not map Effect " +
      "or wallet error classes. Check Midnight Discord or wallet SDK docs."
    );
  }
  if (/proof.?server|prove|plonk|proving/i.test(raw)) {
    return (
      "This looks like a proof-server / proving error — try: midnight-cast ping " +
      "(proof-server optional check) or proof-server HTTP logs."
    );
  }
  return undefined;
}

export function decodeCommand(
  args: string[],
  options: DecodeOptions,
): EmitResult {
  try {
    options = {
      ...options,
      network: validateDecodeNetwork(options.network),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

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
