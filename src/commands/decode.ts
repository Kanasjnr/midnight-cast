import { describeLinks, examplesForLedgerCode, examplesLedgerNote, resolveLinks } from "../lib/example-links.js";
import { matchRunbooks, type RunbookMatch } from "../lib/runbooks.js";
import { runs } from "../lib/network-names.js";
import { findCodesInText, findLedgerByName, knowsLedger, lastPart, ledgerMapFor, ledgerMaps, noMapForNetwork, type ErrorCodesFile } from "../lib/error-maps.js";
import { loadDataJson } from "../lib/data-path.js";
import {
  parseRawErrorMessage,
} from "../lib/error-parse.js";
import { matchKnownMessages, normalOnNetwork, type KnownMessage } from "../lib/known-messages.js";
import { loadSupportMatrix } from "../lib/versions.js";
import { NETWORK_NAMES } from "../networks.js";
import type { EmitResult, GlobalOptions, NextStep } from "../output.js";
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
  kind: "substrate" as const,
  code: 1010,
  name: "InvalidTransaction",
  description:
    "Substrate transaction pool rejected the extrinsic. This is an envelope code, not a Midnight ledger code.",
  steps: [
    "Find Custom error: N in the error message (u8, 0–255).",
    "Run: midnight-cast decode ledger N   (or: midnight-cast decode N)",
    "If DispatchError::Module { index, error }, run: midnight-cast decode pallet <index> <error>",
    "If there is no inner Custom(N), rejection was upstream Substrate validation (nonce, fee, size, etc.).",
  ],
  docUrl:
    "https://docs.midnight.network/how-to/decode-1010-transaction-rejection-errors",
  ledgerDocUrl: "https://docs.midnight.network/nodes/error-codes",
};

const TRANSCRIPT_LEDGER_CODES = ["179", "180", "181"] as const;

interface RelatedNote {
  hint: string;
  next: NextStep[];
}

function relatedNoteFor(code: string, network: string | undefined): RelatedNote | undefined {
  const n = parseInt(code, 10);
  if (TRANSCRIPT_LEDGER_CODES.includes(code as (typeof TRANSCRIPT_LEDGER_CODES)[number])) {
    return {
      hint:
        "Related proof/transcript codes: 179 UnsupportedProofVersion, " +
        "180 GuaranteedTranscriptVersion, 181 FallibleTranscriptVersion",
      next: [{ command: "midnight-cast explain transcript", reason: "Why proof and transcript versions get rejected" }],
    };
  }
  if (n === 171) {
    return {
      hint:
        "Indexers before 4.3.5 could also reject the first transaction of a block with this error " +
        "(fixed in 4.3.4 and 4.3.5). If only first-in-block transactions fail, check the indexer version.",
      next: [{ command: `midnight-cast versions ${network ?? "<network>"}`, reason: "Compare the indexer version with the support matrix" }],
    };
  }
  // The halt is a mainnet sync bug, so other networks don't get the note.
  if (n === 182 && (!network || network === "mainnet")) {
    return {
      hint:
        "If a node syncing mainnet from genesis stops at block #1788979 with this error (\"Intent TTL has expired\"), " +
        "that's a known bug in node 1.0.300 (midnight-node#2229), fixed in node 1.0.400: upgrade, and the node resumes without a resync.",
      next: [{ command: `midnight-cast versions ${network ?? "<network>"}`, reason: "Compare the node version with the support matrix" }],
    };
  }
  if (n >= 0 && n <= 11) {
    return {
      hint:
        "Since ledger 8.1.2 the node rejects non-canonical encodings and values that break their type's rules. " +
        "Since ledger 8.1.3 (node 1.0.400), contract call transcripts must also hold canonical field values (below the field order) and no `noop 0`; " +
        "compactc and midnight-js never produce these, so a hand-built or modified transaction is the usual cause. " +
        "Make sure the ledger and SDK packages that built this match the network.",
      next: [{ command: "midnight-cast explain versions", reason: "Which package versions the network expects" }],
    };
  }
  return undefined;
}

function palletTransactionHint(variantName: string): string | undefined {
  if (variantName !== "Transaction") return undefined;
  return (
    "Pallet Transaction wraps an inner Custom(N) ledger error — " +
    "find Custom error: N in the full message, then: midnight-cast decode ledger N"
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

/** A warning when the network runs a ledger none of the bundled maps covers, so the code may mean something else. */
function ledgerMapMismatch(options: DecodeOptions, data: ErrorCodesFile): string | undefined {
  if (!options.network || !noMapForNetwork(options.network)) return undefined;
  const row = loadSupportMatrix().networks[options.network];
  return (
    `Warning: the bundled error maps cover ledgers ${ledgerMaps().map((m) => m.ledger).join(" and ")}, but ${options.network} ` +
    `runs ledger ${row?.ledger}. This uses ledger ${data.ledger}'s map, so code names and fixes may be wrong; ` +
    `refresh from ${data.docUrl}`
  );
}

/** What a code means on the other ledgers' maps, where that differs: another name, or no such code. */
function otherLedgers(code: string, data: ErrorCodesFile): Array<{ ledger: string; nodeTag?: string; name: string | null }> {
  const own = data.codes[code]!.name;
  return ledgerMaps()
    .filter((map) => map !== data)
    .flatMap((map) => {
      const other = map.codes[code]?.name;
      if (other && lastPart(other) === lastPart(own)) return [];
      return [{ ledger: map.ledger, ...(map.nodeTag ? { nodeTag: map.nodeTag } : {}), name: other ?? null }];
    });
}

const nodeOf = (map: ErrorCodesFile) => (map.nodeTag ? `node ${map.nodeTag.replace(/^node-/, "")}` : `ledger ${map.ledger}`);

function ledgerMapMeta(options: DecodeOptions, data: ErrorCodesFile, chosen = false): string | undefined {
  if (!data.updated) return undefined;

  if (options.network) {
    const matrix = loadSupportMatrix();
    const row = matrix.networks[options.network];
    if (row?.ledger) {
      // A map chosen on purpose for a code the network's ledger doesn't use isn't a mismatch: the Ledger line says why.
      const mismatch =
        !chosen && data.ledger && data.ledger !== row.ledger
          ? ` — matrix expects ${row.ledger}`
          : "";
      return `Map:    ledger ${data.ledger ?? row.ledger} (${options.network}, updated ${data.updated})${mismatch}`;
    }
  }

  if (options.network) {
    return `Map:    ledger ${data.ledger} (the newest map; the support matrix doesn't say which ledger ${options.network} runs; updated ${data.updated})`;
  }

  if (data.ledger) {
    const networks = Object.entries(loadSupportMatrix().networks)
      .filter(([name, row]) => row.ledger === data.ledger && name !== "local")
      .map(([name]) => name);
    const on = networks.length ? `the ledger ${runs(networks)}` : "no public network's ledger";
    return `Map:    ledger ${data.ledger} (${on}; updated ${data.updated}; pass --network to check yours)`;
  }

  return undefined;
}

function decodeLedger(input: string, options: DecodeOptions): EmitResult {
  const networkMap = ledgerMapFor(options.network);
  const numericKey = parseLedgerCodeInput(input);
  let code: string | null = numericKey;
  let data = networkMap;

  const byName = !code;
  if (!code) {
    code = findLedgerByName(input, networkMap);
    // A name only another ledger's map has, such as TransactionApplicationError, Ledger 9 retired.
    if (!code) {
      for (const map of ledgerMaps().filter((m) => m !== networkMap)) {
        code = findLedgerByName(input, map);
        if (code) break;
      }
    }
  }

  // A code the network's ledger doesn't use is read with the map that does: one it retired, such as 182 on Ledger 9,
  // with the codes that replace it, or one only another ledger has, such as 228 on Ledger 8, saying so.
  const retired = code ? networkMap.retired?.[code] : undefined;
  if (code && !networkMap.codes[code]) {
    const older = ledgerMaps().find((map) => map !== networkMap && map.codes[code!]);
    if (older) data = older;
  }
  const fromOtherMap = data !== networkMap;

  if (!code || !data.codes[code]) {
    return fail(`Unknown ledger error code: ${input}`);
  }

  const entry = data.codes[code]!;
  const retiredNote = retired
    ? `Ledger ${networkMap.ledger} (${nodeOf(networkMap)}) doesn't return ${code}: it retired ${retired.name}, and returns ${retired.replacedBy.length > 1 ? `${retired.replacedBy.slice(0, -1).join(", ")} or ${retired.replacedBy.at(-1)}` : retired.replacedBy[0]} instead, each for one of its cases. This is what ${code} meant on ledger ${data.ledger} (${nodeOf(data)}).`
    : fromOtherMap
      ? `Ledger ${networkMap.ledger} (${nodeOf(networkMap)}) doesn't use ${code}. This is what it means on ledger ${data.ledger} (${nodeOf(data)}).`
      : undefined;
  // Without a network, or for one whose ledger the matrix doesn't give, say where the other ledger reads it differently.
  const unknownLedger = !options.network || !knowsLedger(options.network);
  const elsewhere = unknownLedger && !fromOtherMap ? otherLedgers(code, data) : [];
  // A name looked up is the same code on the other ledger too, or another one: say which.
  const sameName = byName
    ? ledgerMaps()
        .filter((map) => map !== data)
        .flatMap((map) => {
          const there = findLedgerByName(input, map);
          return there && there !== code ? [`On ledger ${map.ledger} (${nodeOf(map)}), ${input} is ${there}.`] : [];
        })
    : [];
  const elsewhereNote = [
    ...elsewhere.map((o) => `On ledger ${o.ledger}${o.nodeTag ? ` (${o.nodeTag.replace(/^node-/, "node ")})` : ""}, ${o.name ? `${code} is ${o.name}` : `${code} isn't used`}.`),
    ...sameName,
  ];
  const elsewhereText = elsewhereNote.length
    ? `${elsewhereNote.join(" ")}${options.network ? "" : " Pass --network for the ledger your network runs."}`
    : "";
  const ledgerMeta = ledgerMapMeta(options, data, fromOtherMap);
  const mapMismatch = ledgerMapMismatch(options, data);
  const related = relatedNoteFor(code, options.network);
  const examples = examplesForLedgerCode(Number(code));
  const examplesNote = examples.length ? examplesLedgerNote(options.network) : undefined;
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
    ...(retired ? { retired: { on: networkMap.ledger, replacedBy: retired.replacedBy, note: retiredNote! } } : {}),
    ...(fromOtherMap && !retired ? { notOnLedger: { ledger: networkMap.ledger, note: retiredNote! } } : {}),
    ...(elsewhereText ? { ...(elsewhere.length ? { otherLedgers: elsewhere } : {}), otherLedgersNote: elsewhereText } : {}),
    ...(related ? { relatedHint: related.hint } : {}),
    ...(examples.length ? { examples } : {}),
    ...(examplesNote ? { examplesNote } : {}),
  };
  const next = related?.next ?? [];

  if (options.json) {
    return { ...success(payload), next };
  }

  const meta = ledgerMeta;

  const text = [
    `Kind:   ledger (Custom ${code})`,
    `Name:   ${entry.name}`,
    `Desc:   ${entry.description}`,
    `Fix:    ${entry.fix}`,
    ...(retiredNote ? [`Ledger: ${retiredNote}`] : []),
    ...(elsewhereText ? [`Ledger: ${elsewhereText}`] : []),
    ...(related ? [`Hint:   ${related.hint}`] : []),
    ...describeLinks(examples).map((l) => `Code:   ${l}`),
    ...(examplesNote ? [`Note:   ${examplesNote}`] : []),
    ...(mapMismatch ? [`Warn:   ${mapMismatch}`] : []),
    ...(meta ? [meta] : []),
    `Docs:   ${data.docUrl}`,
  ].join("\n");

  return { ...success(text), next };
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
  const next: NextStep[] = innerHint
    ? [{ command: 'midnight-cast decode --raw "<full error message>"', reason: "Decode the inner Custom(N) ledger error" }]
    : [];

  if (options.json) {
    return { ...success(payload), next };
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

  return { ...success(text), next };
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

const NEXT_AFTER_1010: NextStep[] = [
  { command: "midnight-cast decode ledger <N>", reason: "Decode the Custom error: N inside the rejection" },
  { command: "midnight-cast explain 1010", reason: "How to read a 1010 rejection" },
];

function decode1010(options: DecodeOptions): EmitResult {
  if (options.json) {
    return { ...success(SUBSTRATE_1010), next: NEXT_AFTER_1010 };
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

  return { ...success(text), next: NEXT_AFTER_1010 };
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
  // Names from the network's map, and from the older map for the names its ledger retired, such as TransactionApplicationError.
  const networkMap = ledgerMapFor(options.network);
  const nameCodes = [
    ...new Set([
      ...findCodesInText(raw, networkMap),
      ...ledgerMaps()
        .filter((map) => map !== networkMap)
        .flatMap((map) => findCodesInText(raw, map).filter((code) => networkMap.retired?.[code])),
    ]),
  ];
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

  for (const message of matchKnownMessages(raw, options.network)) {
    appendDecodeResult(parts, sections, decodeKnownMessage(message, options), options.json);
  }

  // The service desk's runbook for each error string it lists, beside whatever decoded.
  const runbooks = matchRunbooks(raw, { network: options.network });

  // Only a single token can be a bare code or ledger name; a sentence isn't one.
  if (parts.length === 0 && /^\S+$/.test(raw.trim())) {
    const fallbackLedger = decodeLedger(raw.trim(), options);
    if (fallbackLedger.ok) {
      appendDecodeResult(parts, sections, fallbackLedger, options.json);
    } else if (fallbackLedger.error && runbooks.length === 0) {
      // A word a runbook knows, such as EBADENGINE, isn't an unknown ledger code.
      failures.push(fallbackLedger.error);
    }
  }

  // When only a runbook knows the error, the routing hint it would otherwise get still applies: a runbook string
  // can match text from another tool, and some rows hold only in a context, such as on a faucet page.
  if (parts.length === 0 && runbooks.length > 0) {
    const hint = otherErrorRouterHint(raw) ?? normalOnNetwork(raw, options.network);
    if (hint) failures.push(hint);
  }

  if (parts.length === 0 && runbooks.length === 0) {
    return fail(
      // Text that is only a Ledger 9 marker is answered as such; in a longer error, the real error is routed first.
      (/^\S+$/.test(raw.trim()) ? normalOnNetwork(raw, options.network) : undefined) ??
        otherErrorRouterHint(raw) ??
        normalOnNetwork(raw, options.network) ??
        failures[0] ??
        "No Midnight error recognised in this message. decode reads 1010 rejections, Custom(N) ledger codes, " +
          "pallet errors (DispatchError::Module), JSON-RPC codes, known tooling messages and the error strings the service desk's runbooks list, or a bare code such as 170",
    );
  }

  const next = followUpsAfterRaw(parts);

  if (options.json) {
    return {
      ...success({
        raw,
      parsed: { ...parsed, ledgerCodes, ledgerNames: nameCodes },
        decodings: parts.map((p) => p.data),
        ...(runbooks.length > 0 ? { runbooks } : {}),
        ...(failures.length > 0 ? { warnings: failures } : {}),
      }),
      next,
    };
  }

  if (runbooks.length > 0) sections.push(...describeRunbooks(runbooks), "");

  if (failures.length > 0) {
    sections.push(
      "Note:",
      ...failures.map((f) => `  - ${f}`),
    );
  }

  // Each decoding that links the examples carries the same ledger note; say it once.
  const seen = new Set<string>();
  const text = sections
    .join("\n")
    .split("\n")
    .filter((line) => !line.startsWith("Note:   This code targets") || (!seen.has(line) && seen.add(line)))
    .join("\n");
  return { ...success(text.trimEnd()), next };
}

/** Each matched row: the runbook to read, the others it names, and when the row applies. */
function describeRunbooks(matches: RunbookMatch[]): string[] {
  const lines = ["Midnight's service desk has a runbook for this. Symptoms overlap, so confirm the runbook's cause before acting:"];
  for (const match of matches) {
    const [first, ...others] = match.runbooks;
    if (!first) continue;
    lines.push(`  "${match.matched}": ${first.title}`, `    ${first.url}`);
    for (const other of others) lines.push(`    also ${other.title}: ${other.url}`);
    if (match.advice) lines.push(`    ${match.advice}`);
    if (match.when) lines.push(`    For: ${match.when}`);
  }
  return lines;
}

function decodeKnownMessage(message: KnownMessage, options: DecodeOptions): EmitResult {
  const next = message.next.map((step) =>
    options.network ? { ...step, command: step.command.replace("<network>", options.network) } : step,
  );
  const examples = resolveLinks(message.examples ?? []);
  const examplesNote = examples.length ? examplesLedgerNote(options.network) : undefined;
  if (options.json) {
    const { next: _, examples: __, ...rest } = message;
    return {
      ...success({ kind: "message" as const, ...rest, ...(examples.length ? { examples } : {}), ...(examplesNote ? { examplesNote } : {}) }),
      next,
    };
  }
  const text = [
    `Kind:   message (${message.name})`,
    `Desc:   ${message.description}`,
    `Fix:    ${message.fix}`,
    ...describeLinks(examples).map((l) => `Code:   ${l}`),
    ...(examplesNote ? [`Note:   ${examplesNote}`] : []),
  ].join("\n");
  return { ...success(text), next };
}

// The raw decoder has already tried every decode route, so suggesting one again would loop.
function followUpsAfterRaw(parts: EmitResult[]): NextStep[] {
  const steps = parts.flatMap((p) => p.next ?? []).filter((s) => !s.command.startsWith("midnight-cast decode"));
  return steps.filter((s, i) => steps.findIndex((t) => t.command === s.command) === i);
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
    return fail(err);
  }

  if (options.raw) {
    return decodeRaw(options.raw, options);
  }

  if (args.length === 0) {
    return fail(
      "Usage: midnight-cast decode <code> | decode --raw \"<error>\" | decode ledger <code> | decode pallet <index> <variant> | decode 1010 | decode jsonrpc <code>",
    );
  }

  const [head, ...rest] = args;

  if (head === "1010" || head === "substrate") {
    return decode1010(options);
  }

  if (head === "ledger") {
    if (!rest[0]) return fail("Usage: midnight-cast decode ledger <code>");
    return decodeLedger(rest[0], options);
  }

  if (head === "pallet") {
    if (rest.length < 2) {
      return fail("Usage: midnight-cast decode pallet <index|name> <variant|name>");
    }
    return decodePallet(rest[0]!, rest[1]!, options);
  }

  if (head === "jsonrpc") {
    if (!rest[0]) return fail("Usage: midnight-cast decode jsonrpc <code>");
    return decodeJsonRpc(rest[0], options);
  }

  return decodeLedger(head, options);
}
