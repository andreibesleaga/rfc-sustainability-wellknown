/**
 * The report: rows, the count line, the overall verdict, the S7 and D9 record, and the two output forms.
 * Section 9.1: a summary MUST NOT read as a pass while an applicable row of C-SFC-1, 2, 4, 5, 6 or 7 is
 * FAIL or NOT-EVALUABLE, and NOT-DECLARED is counted and named.
 */
import { createRequire } from "node:module";
import { epoch, isInstant } from "./time.mjs";
import { PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO, COMPLETE, INCOMPLETE, NOT_APPLICABLE } from "./rows.mjs";
import { registrarKeys } from "./parameters.mjs";

export const CHECKER_VERSION = "2.0.0";
const WORDS = [PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO];
const GATE_ROWS = ["C-SFC-1", "C-SFC-2", "C-SFC-4", "C-SFC-5", "C-SFC-6", "C-SFC-7"];

/** Rows counted by result word. */
export function summaryOf(rows) {
  const counts = Object.fromEntries(WORDS.map((w) => [w, 0]));
  for (const r of rows) if (r.result in counts) counts[r.result]++;
  return counts;
}

/**
 * The overall verdict: FAIL when any row FAILs; else NOT-EVALUABLE when an applicable gate row is
 * NOT-EVALUABLE, a stage stopped (an ERROR row) or the S1 fetch gave no document (an S1 row that is
 * NOT-EVALUABLE: the site was never read, so it is not out of scope); else NOT-APPLICABLE when no object
 * claims SFC and no gate row ran; else PASS.
 */
const stopsTheRun = (r) => r.id === "ERROR" || (r.result === NE && (r.id === "S1" || GATE_ROWS.includes(r.id)));

export function overallVerdict(rows) {
  if (rows.some((r) => r.result === FAIL)) return FAIL;
  if (rows.some(stopsTheRun)) return NE;
  const applicable = rows.some((r) => GATE_ROWS.includes(r.id) || (r.id === "VERDICT" && (r.result === COMPLETE || r.result === INCOMPLETE)));
  return applicable ? PASS : NOT_APPLICABLE;
}

/**
 * Exit status: 1 when any row FAILs (non-conformance, a failed check, a figure at or above CAP); else 2 when a
 * stage stopped (an ERROR row: the run is incomplete, so 0 would read as clean); else 0. Other NOT-EVALUABLE rows
 * leave it at 0.
 */
export function exitCodeOf(rows) {
  if (rows.some((r) => r.result === FAIL)) return 1;
  return rows.some((r) => r.id === "ERROR") ? 2 : 0;
}

export function consumerVersion() {
  try { return createRequire(import.meta.url)("sustainability-wellknown-consumer/package.json").version; } catch { return "unknown"; }
}

/** True when a registrar key is pinned for some network: an empty list pins nothing. */
const hasRegistrarKey = (pins) => Object.values(pins?.registrar ?? {}).some((xs) => Array.isArray(xs) && xs.length > 0);
/** True when a pinned methodology document lists at least one registrar key. */
const listsRegistrarKey = (input) => input.pins?.methodology === true && (input.parameters?.["registrar-keys"] ?? []).length > 0;
/** The record's "registrar key pinned": with a read, a key D2 could use (the pin must name the read's network); without one, what the caller gave. */
const registrarKeyPinned = (input, ctx) => (ctx ? registrarKeys(ctx).length > 0 : hasRegistrarKey(input.pins) || listsRegistrarKey(input));

const objectVerdicts = (rows) => rows.filter((r) => r.id === "VERDICT").map((r) => ({ object: r.scope, verdict: r.result, detail: r.detail }));

/** Section 10: the address rule this checker applies, and what it cannot report. */
const ADDRESS_RULE = "fetches refuse addresses by the consumer library's rule (an approximation of the IANA Globally Reachable test); connected address not reported";

/** S7 and D9: what the run knew and did, and what it does not show. */
function recordOf({ input, ctx, ti, T, objs, rows }) {
  const ages = objs.filter((o) => isInstant(o.updated) && T).map((o) => ({ object: `${o.target} ${o["carbon-accounting"] ?? "-"}`, updated: o.updated, ageSeconds: epoch(T) - epoch(o.updated) }));
  const selected = rows.find((r) => r.id === "S4" && r.result === PASS)?.detail ?? null;
  return {
    checker: { name: "sfc-check", version: CHECKER_VERSION }, profile: "SFC profile 2.0",
    consumerLibrary: { name: "sustainability-wellknown-consumer", version: consumerVersion() },
    T: T ?? null, tSource: ti ? ti.tSource : input.T ? "explicit" : input.now ? "checker clock" : null,
    readAt: ctx ? ctx.readAt : null, maxReadAgeSeconds: ctx ? ctx.limits.maxReadAgeSeconds : null,
    selectedPeriod: selected, updatedAge: ages,
    registrarKeyPinned: registrarKeyPinned(input, ctx),
    methodologyPinned: input.pins?.methodology === true, registryRecordsChecked: false,
    addressRule: ADDRESS_RULE,
    notEstablished: "Figures are the publisher's claims; the operator set is the Registry's; completeness against the real network and the readings are not established.",
  };
}

/** Assemble the report of one run. */
export function buildReport({ rows, input, ctx, ti, T, objs }) {
  return {
    rows, summary: summaryOf(rows), verdict: overallVerdict(rows), objects: objectVerdicts(rows),
    notDeclared: rows.filter((r) => r.result === NOT_DECLARED).map((r) => ({ id: r.id, scope: r.scope, detail: r.detail })),
    record: recordOf({ input, ctx, ti, T, objs, rows }),
  };
}

// ---- output -------------------------------------------------------------------------------

/**
 * Escape text taken from untrusted data for a terminal (section 10): control characters, line breaks, bidi and
 * invisible format characters (U+061C, U+200B-U+200F, U+2028-U+202E, U+2060-U+2069, U+FEFF) and lone surrogates.
 * Written with \u escapes so that no invisible character sits in this source.
 */
const UNSAFE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff\\ud800-\\udfff]", "g");
export const escapeText = (s) => String(s).replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

const pad = (s, n) => String(s).padEnd(n);

const VERDICT_NOTES = {
  [PASS]: "no applicable check failed or was not evaluable; figures are the publisher's claims",
  [FAIL]: "at least one check failed",
  [NE]: "at least one applicable check could not be evaluated, or the document was not read; this is not a pass",
  [NOT_APPLICABLE]: "no object claims SFC",
};
const yesNo = (flag) => (flag ? "yes" : "no");

/** The S7 and D9 record as text lines. */
function recordLines(r) {
  const read = r.readAt ? `; read-at ${r.readAt}; MAX_READ_AGE ${r.maxReadAgeSeconds} s` : "";
  const period = r.selectedPeriod ? `; period selected ${r.selectedPeriod}` : "";
  return [
    `checker ${r.checker.name} ${r.checker.version}, ${r.profile}; consumer library ${r.consumerLibrary.name} ${r.consumerLibrary.version}`,
    `T ${r.T ?? "none"} (${r.tSource ?? "no clock"})${read}${period}`,
    ...r.updatedAge.map((a) => `updated ${a.updated} (${a.ageSeconds} s before T) for ${escapeText(a.object)}`),
    `registrar key pinned: ${yesNo(r.registrarKeyPinned)}; methodology document pinned: ${yesNo(r.methodologyPinned)}; registry records (D8) not checked`,
    `address rule: ${r.addressRule}`,
    r.notEstablished,
  ];
}

/** The report as text: one line per row, the count line, the verdict line and the record. */
export function formatText(report) {
  const rowLine = (r) => [pad(r.result, 16), pad(r.id, 20), [r.scope, r.detail].filter(Boolean).map(escapeText).join("  ")].join("").trimEnd();
  const counts = WORDS.filter((w) => report.summary[w]).map((w) => `${report.summary[w]} ${w}`).join(", ");
  const lines = [...report.rows.map(rowLine), "", `rows: ${counts || "none"}`];
  if (report.notDeclared.length) lines.push(`not declared: ${report.notDeclared.map((n) => escapeText(`${n.scope ?? n.id}`)).join("; ")}`);
  lines.push(`result: ${report.verdict} (${VERDICT_NOTES[report.verdict]})`, "", ...recordLines(report.record));
  return `${lines.join("\n")}\n`;
}

/** The report as JSON text (object keys as built; strings escaped by JSON itself). */
export const formatJson = (report) => `${JSON.stringify(report, null, 2)}\n`;
