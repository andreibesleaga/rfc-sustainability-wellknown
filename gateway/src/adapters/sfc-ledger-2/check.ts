/**
 * One run of the profile's checks over what a caller holds: a served
 * declaration (one object or an array), a ledger read, and the pins and
 * parameters the caller supplies out of band. Rows are in the result words of
 * 9.1. The shallow rows are S2 to S6 with C-SFC-2 (disclosure form) and C-SFC-5;
 * the deep rows are D1 to D8, C-SFC-1 to C-SFC-4, C-SFC-6 and C-SFC-7.
 *
 * Two readings of each served object are held (8.1): the object as served, which S2, S3 and the URI rows
 * read, and the same object with a member of the wrong JSON type read as absent, which every figure
 * check reads, so a mistyped figure is reported and never reaches arithmetic.
 *
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (sections 9.1 to 9.4)
 */
import { validateDocument } from "sustainability-wellknown-consumer";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE, type SfcLimits } from "../sfc-ledger-profile";
import { bodyShapeRows, claimsSfc, EXT, extOf, hasEvidence, labelOf, levelOf, mistypedMembers, objectsOf, readAsAbsent, samePeriodTarget, usablePeriod } from "./decl";
import { evidenceValue, locationFigures, topLevel, type TopLevelOptions } from "./derive";
import { deepCheck, deriveFor, stageRows } from "./deep";
import { readIJson, type ElementIssues, type IJsonIssues, type ReadError } from "./ijson";
import { withLimits } from "./limits";
import { CheckLimit } from "./deadline";
import { buildContext, replay, type CheckInput, type Ctx } from "./ledger";
import { csfc2Disclosure, csfc5, declarationUriRows, eventUriRows, s6, selectAnnual } from "./shallow";
import { s3 } from "./signed";
import { timeInfo, type TimeInfo } from "./window";
import { DECLARED, epochOf, FAIL, INFO, isHost, isInstant, isObject, NE, NOT_DECLARED, PASS, row, sameHost, type Json, type Row } from "./primitives";

const WORDS = [PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO];

/** Everything a run can be given. A `declarationText` or `excerptText` is read as I-JSON so duplicate members and lone surrogates are seen. */
export interface RunInput extends Partial<Omit<CheckInput, "excerpt">> {
  excerpt?: Json;
  excerptText?: string;
  declarations?: Json;
  declarationText?: string;
  /** The consumer library's strict verdict per object (S2); when absent it is computed here. */
  consumer?: { valid: boolean[] };
  retrievalUri?: string | null;
  /** The origin host for S4; else the first network declaration's target. */
  network?: string;
  /** Report only rows with these ids (or id prefixes). */
  select?: string[];
}

export interface Report {
  rows: Row[];
  summary: Record<string, number>;
}

export function summaryOf(rows: Row[]): Record<string, number> {
  const s: Record<string, number> = Object.fromEntries(WORDS.map((w) => [w, 0]));
  for (const r of rows) if (r.result in s) s[r.result]++;
  return s;
}

const carbonOmitted = (o: Json): boolean => hasEvidence(o) && ["scope-2", "scope-3", "carbon-footprint"].every((k) => o[k] === undefined);
const energyOmitted = (o: Json): boolean => hasEvidence(o) && o["energy-consumption"] === undefined;
/** INCOMPLETE when a 7.5 member group is omitted, judged from the object alone. */
const isIncomplete = (o: Json): boolean => energyOmitted(o) || carbonOmitted(o);

/** COMPLETE or INCOMPLETE (7.5): from the ledger when a read is held, else from the omitted member groups. */
function verdictRow(ctx: Ctx | null, o: Json, level: string): Row {
  const label = labelOf(o);
  const period = usablePeriod(o);
  if (ctx && hasEvidence(o) && isInstant(o.updated) && period) {
    const d = deriveFor(ctx, o.updated, period, o, level);
    const parts = [
      ...d.silentEnergy.map((x) => `silent: ${x.operator}, ${x.month.slice(0, 7)}, EnergyAttested`),
      ...d.silentCarbon.map((x) => `silent: ${x.operator}, ${x.month.slice(0, 7)}, CarbonAttested`),
      ...d.noOperator.map((m) => `no operator: ${m.slice(0, 7)}`),
    ];
    return row("VERDICT", parts.length ? "INCOMPLETE" : "COMPLETE", parts.sort().join("; ") || undefined, label);
  }
  return row("VERDICT", isIncomplete(o) ? "INCOMPLETE" : "COMPLETE", undefined, label);
}

/** 7.3 pairing: a location object with no market-based SFC primary, or whose primary is incomplete for carbon, gets S2 only. */
function pairRows(objs: Json[]): Map<Json, Row> {
  const out = new Map<Json, Row>();
  for (const o of objs) {
    if (o["carbon-accounting"] !== "location-based") continue;
    // the primary may have omitted `carbon-accounting` with the rest of its carbon members (7.5)
    const primary = objs.find((p) => p !== o && samePeriodTarget(p, o) && p["carbon-accounting"] !== "location-based" && claimsSfc(p) && (p["carbon-accounting"] === "market-based" || carbonOmitted(p)));
    if (!primary) out.set(o, row("PAIR", INFO, "unpaired object", labelOf(o)));
    else if (carbonOmitted(primary)) out.set(o, row("PAIR", INFO, "location object not applicable (incomplete)", labelOf(o)));
  }
  return out;
}

const isObjectArray = (v: unknown): boolean => Array.isArray(v) && v.every(isObject);
/** An absent list is empty; a present one, `null` included, must be an array of objects. */
const isOptionalObjectArray = (v: unknown): boolean => v === undefined || isObjectArray(v);

/** Why a value cannot be read as an excerpt (5.8) at all, or null: the structure the checks walk, not its content rules. */
export function excerptProblem(ex: Json): string | null {
  if (!isObject(ex)) return "not an object";
  if (!isHost(ex.network)) return "network is not a host";
  if (!isInstant(ex["read-at"])) return "read-at is not an instant";
  if (!isObjectArray(ex.registry)) return "registry is not an array of objects";
  if (!isOptionalObjectArray(ex.voids)) return "voids is not an array of objects";
  if (ex.checkpoint !== undefined && !isObject(ex.checkpoint)) return "checkpoint is not an object";
  if (ex.registrar !== undefined && !isObject(ex.registrar)) return "registrar is not an object";
  if (!isObjectArray(ex.ledger)) return "ledger is not an array of entries";
  const bad = (ex.ledger as Json[]).findIndex((l) => !isInstant(l.commit) || typeof l.hash !== "string" || !isObject(l.event));
  return bad >= 0 ? `ledger entry ${bad} lacks a commit instant, a hash or an event object` : null;
}

interface Parsed {
  input: RunInput;
  /** The objects as served: S2, S3 and the URI rows read these. */
  served: Json[];
  /** The served objects with a wrongly typed member read as absent (8.1): every figure check reads these. */
  objs: Json[];
  /** The duplicate-member and lone-surrogate findings of each served object's own text, or null when the body came as objects. */
  objectIssues: ElementIssues[] | null;
  /** S2 FAIL rows for a body that is not a declaration object or an array of them. */
  bodyShapeRows: Row[];
  rawClaims: boolean;
  /** Set when the served text could not be read (S2): a syntax error or a limit. */
  declarationError?: { syntax?: string; limit?: string };
  /** Set when the read is not usable: not JSON, over a limit, or not a well-formed excerpt. The excerpt is then dropped (D1). */
  excerptError?: string;
}

const LITERAL_LIMIT = "characters in a number literal";

type TextRead = { value: Json; issues: IJsonIssues } | { error: string } | { limit: string };

/**
 * Read text as I-JSON. A syntax error is `{ error }` with the reader's own fixed wording. A limit that
 * stopped the reading, and a number no binary64 value holds whose literal is over the literal limit of
 * section 10, are `{ limit }`: never expanded, never FAIL.
 */
function parseText(text: string, limits: SfcLimits): TextRead {
  try {
    return readIJson(text);
  } catch (e) {
    const err = e as ReadError;
    if (err.limit) return { limit: err.limit };
    if ((err.literalLength ?? 0) > limits.literalChars) return { limit: LITERAL_LIMIT };
    return { error: err.message };
  }
}

const SIGNED_NAME = new RegExp(`"${EXT}ledger-evidence-2"\\s*:`);

interface DeclarationText {
  /** The body the text holds, when it could be read (`null` is a body: a served `null` is not "no declaration"). */
  read?: { value: Json };
  bodyIssues: IJsonIssues | null;
  rawClaims: boolean;
  declarationError?: Parsed["declarationError"];
}

/** The served text read into a body, or the reason it could not be. */
function readDeclarationText(text: string, limits: SfcLimits): DeclarationText {
  if (Buffer.byteLength(text) > limits.declarationBytes) return { bodyIssues: null, rawClaims: false, declarationError: { limit: "bytes per declaration" } };
  // a body that is not I-JSON claims SFC when the name appears in its text, in any duplicate (3.2)
  const rawClaims = SIGNED_NAME.test(text);
  const read = parseText(text, limits);
  if ("error" in read) return { bodyIssues: null, rawClaims, declarationError: { syntax: read.error } };
  if ("limit" in read) return { bodyIssues: null, rawClaims, declarationError: { limit: read.limit } };
  if (read.issues.maxLiteral > limits.literalChars) return { bodyIssues: null, rawClaims, declarationError: { limit: LITERAL_LIMIT } };
  return { read: { value: read.value }, bodyIssues: read.issues, rawClaims };
}

/** The reader's per-element findings aligned with `objectsOf(doc)` (items that are not objects are left out), or null without served text. */
function objectIssuesOf(doc: Json, issues: IJsonIssues | null): ElementIssues[] | null {
  if (!issues) return null;
  if (!Array.isArray(doc)) return [issues.elements[0]];
  return doc.flatMap((x: Json, i: number) => (isObject(x) ? [issues.elements[i]] : []));
}

/** The cause shown by D1 and C-SFC-7 when the read cannot be used. */
const excerptErrorText = (read: { error: string } | { limit: string }): string => ("limit" in read ? `limit: ${read.limit}` : `read is not valid JSON: ${read.error}`);

/** The excerpt of the input, read from its text when given and dropped when it cannot be used. */
function excerptOf(sc: RunInput, limits: SfcLimits): { input: RunInput; excerptError?: string } {
  let input = sc;
  let excerptError: string | undefined;
  if (typeof sc.excerptText === "string") {
    const r = parseText(sc.excerptText, limits);
    if ("issues" in r) input = { ...sc, excerpt: r.value, excerptMaxLiteral: r.issues.maxLiteral };
    else {
      excerptError = excerptErrorText(r);
      input = { ...sc, excerpt: undefined };
    }
  }
  const problem = input.excerpt === undefined || (isObject(input.excerpt) && input.excerpt["excerpt-version"] !== 2) ? null : excerptProblem(input.excerpt);
  if (problem) {
    excerptError = `read is not a well-formed excerpt: ${problem}`;
    input = { ...input, excerpt: undefined };
  }
  return { input, ...(excerptError ? { excerptError } : {}) };
}

function parseInputs(sc: RunInput, limits: SfcLimits): Parsed {
  const { input, excerptError } = excerptOf(sc, limits);
  let doc: Json | undefined = "declarations" in sc ? sc.declarations : undefined;
  let body: DeclarationText = { bodyIssues: null, rawClaims: false };
  if (typeof sc.declarationText === "string") {
    body = readDeclarationText(sc.declarationText, limits);
    if (body.read) doc = body.read.value;
  }
  const served = doc !== undefined ? objectsOf(doc) : [];
  return {
    input, served, objs: served.map(readAsAbsent), rawClaims: body.rawClaims,
    objectIssues: doc !== undefined ? objectIssuesOf(doc, body.bodyIssues) : null,
    bodyShapeRows: doc !== undefined ? bodyShapeRows(doc) : [],
    ...(body.declarationError ? { declarationError: body.declarationError } : {}), ...(excerptError ? { excerptError } : {}),
  };
}

/** D1 and C-SFC-7 for each object that points to ledger evidence when the read cannot be used or none was given (9.2). */
const unusableReadRows = (objs: Json[], cause: string): Row[] => objs.filter(hasEvidence).flatMap((o) => [row("D1", NE, cause, labelOf(o)), row("C-SFC-7", NE, cause, labelOf(o))]);

/** S2: the consumer library's verdict (strict -10 wire: `validateDocument` takes no compatibility option, so the reading is the one 9.3 prescribes), as recorded by the caller or computed here. */
const s2Valid = (input: RunInput, o: Json, i: number): boolean => input.consumer?.valid?.[i] ?? validateDocument(o).valid;

/** S2 for each served object; `valid` is empty over the object limit. */
function s2Rows(p: Parsed, limits: SfcLimits): { rows: Row[]; valid: boolean[] } {
  const { input, served } = p;
  if (served.length > limits.declarationObjects) return { rows: [row("S2", NE, "limit: objects in a declaration array")], valid: [] };
  const valid = served.map((o, i) => s2Valid(input, o, i));
  return { rows: served.map((o, i) => row("S2", valid[i] ? PASS : FAIL, undefined, labelOf(o))), valid };
}

/** What the shallow rows established about each object, for the per-object rows. */
interface ShallowFacts {
  rows: Row[];
  valid: boolean[];
  pairs: Map<Json, Row>;
  s3rows: Map<Json, Row[]>;
}

/** The shallow rows for every object. */
function shallowRows(p: Parsed, T: string | null, limits: SfcLimits): ShallowFacts {
  const { input, served, objs, objectIssues, rawClaims } = p;
  const s2 = s2Rows(p, limits);
  const rows: Row[] = [...s2.rows, ...declarationUriRows(served, input.retrievalUri ?? null)];
  const pairs = pairRows(objs);
  const s3rows = new Map<Json, Row[]>();
  objs.forEach((o, i) => {
    if (pairs.has(o)) return;
    const claims = claimsSfc(o) || (rawClaims && objs.length === 1);
    const r = s3(served[i], levelOf(o), claims, input.pins ?? {}, objectIssues?.[i] ?? null);
    s3rows.set(o, r);
    rows.push(...r);
  });
  if (objs.length && T) rows.push(...selectionRows(objs, input, T));
  return { rows, valid: s2.valid, pairs, s3rows };
}

const isNetworkObject = (o: Json): boolean => o["target-type"] === "service" && typeof extOf(o, "network-topology")?.["member-of-network"] !== "string";
const hostOfUri = (uri: unknown): string | null => {
  try {
    return typeof uri === "string" ? new URL(uri).hostname : null;
  } catch {
    return null;
  }
};

/** When the document was fetched, each network object whose `target` is not the retrieval host is noted (9.3 S4). */
function retrievalHostRows(network: Json[], retrievalUri: unknown): Row[] {
  const host = hostOfUri(retrievalUri);
  if (host === null) return [];
  return network.filter((o) => !sameHost(o.target, host)).map((o) => row("S4.info", INFO, "target differs from retrieval host", labelOf(o)));
}

/** S4 and C-SFC-2 disclosure form. */
function selectionRows(objs: Json[], input: RunInput, T: string): Row[] {
  const network = objs.filter(isNetworkObject);
  const target = input.network ?? network[0]?.target;
  if (target === undefined) return [];
  const sel = selectAnnual(objs, target, T);
  const rows = [...retrievalHostRows(network, input.retrievalUri), ...sel.rows];
  if (sel.selected) rows.push(csfc2Disclosure(sel.selected, sel.primary, sel.primary ? isIncomplete(sel.primary) : false));
  return rows;
}

const hasOnlyOldEvidence = (o: Json): boolean => extOf(o, "ledger-evidence") !== undefined && extOf(o, "ledger-evidence-2") === undefined;

/** The rows of one object: pairing note, legacy reading, or C-SFC-5, S6 and the verdict. */
function objectRowsOf(p: Parsed, ctx: Ctx | null, T: string | null, skew: number, facts: ShallowFacts, i: number): Row[] {
  const { objs, served, rawClaims } = p;
  const o = objs[i];
  const level = levelOf(o);
  const pair = facts.pairs.get(o);
  if (pair) return [pair];
  const s2valid = facts.valid[i];
  if (hasOnlyOldEvidence(o)) {
    const detail = s2valid === false ? "profile 1.1 evidence, pre-10 wire" : "profile 1.1 evidence, not an SFC 2.0 declaration";
    return [row("LEGACY", INFO, detail, labelOf(o)), row("VERDICT", "NOT-APPLICABLE", undefined, labelOf(o))];
  }
  const claims = claimsSfc(o) || (rawClaims && objs.length === 1);
  if (!claims) return [row("VERDICT", "NOT-APPLICABLE", undefined, labelOf(o))];
  const rows: Row[] = [];
  if (T) rows.push(csfc5(o, level, objs, T, skew, s2valid !== false, facts.s3rows.get(o) ?? []));
  rows.push(...s6(o, level, objs, labelOf(o), mistypedMembers(served[i])), verdictRow(ctx, o, level));
  return rows;
}

/** The deep rows: one run per object that carries `ledger-evidence-2`, else one for the read alone. Each run is a stage of its own. */
function deepRows(p: Parsed, ctx: Ctx, ti: TimeInfo): Row[] {
  const rows = stageRows("event URI check", () => eventUriRows(ctx));
  const withEv = p.objs.filter(hasEvidence);
  const deep = (o: Json | null): Row[] => stageRows("deep check", () => deepCheck(ctx, ti, o, p.objs));
  if (withEv.length) for (const o of withEv) rows.push(...deep(o));
  else rows.push(...deep(null));
  return rows;
}

/** The rows of a served text that could not be read (a syntax error is FAIL, a limit NOT-EVALUABLE), then the body-shape rows (S2). */
function declarationErrorRows(p: Parsed): Row[] {
  const e = p.declarationError;
  const rows: Row[] = [];
  if (e?.syntax) rows.push(row("S2", FAIL, `not valid JSON: ${e.syntax}`));
  if (e?.limit) rows.push(row("S2", NE, `limit: ${e.limit}`));
  return [...rows, ...p.bodyShapeRows];
}

/** Run one stage. An unexpected failure becomes one NOT-EVALUABLE ERROR row with a fixed message (the exception text is never echoed: it may carry hostile input), never a crash and never a pass. */
function safely(stage: string, fn: () => Row[], limitRowId: string): Row[] {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CheckLimit) return [row(limitRowId, NE, e.message)];
    return [row("ERROR", NE, `${stage} stopped`)];
  }
}

const selectRows = (rows: Row[], select?: string[]): Row[] => (select ? rows.filter((r) => select.some((s) => r.id === s || r.id.startsWith(`${s}.`))) : rows);
const reportOf = (rows: Row[], ctx: Ctx | null): Report & { ctx: Ctx | null } => ({ rows, summary: summaryOf(rows), ctx });

/** What a usable read gives the checks, or why it gives nothing: the cause D1 and C-SFC-7 print, and an ERROR row when building the context stopped. */
interface ReadState {
  ctx: Ctx | null;
  ti: TimeInfo | null;
  rows: Row[];
  unusable: string;
}

/** The context and time facts of the read; building them can hit the time limit or stop on a hostile read. */
function readState(p: Parsed, limits: SfcLimits): ReadState {
  if (!p.input.excerpt) return { ctx: null, ti: null, rows: [], unusable: p.excerptError ?? "no ledger read given" };
  try {
    const ctx = buildContext({ ...p.input, excerpt: p.input.excerpt }, limits);
    ctx.served = p.served;
    ctx.objectIssues = p.objectIssues;
    return { ctx, ti: timeInfo(ctx), rows: [], unusable: "" };
  } catch (e) {
    if (e instanceof CheckLimit) return { ctx: null, ti: null, rows: [], unusable: e.message };
    return { ctx: null, ti: null, rows: [row("ERROR", NE, "read context stopped")], unusable: "no ledger read given" };
  }
}

/** The inputs read, or one ERROR row when a hostile value stopped the reading (a getter that throws, say): never an exception. */
function readInputs(input: RunInput, limits: SfcLimits): { p?: Parsed; rows: Row[] } {
  try {
    return { p: parseInputs(input, limits), rows: [] };
  } catch {
    return { rows: [row("ERROR", NE, "input reading stopped")] };
  }
}

/** The shallow rows, then the per-object rows, for every served object. */
function shallowStage(p: Parsed, ctx: Ctx | null, T: string | null, limits: SfcLimits): Row[] {
  const facts = shallowRows(p, T, limits);
  return [...facts.rows, ...p.objs.flatMap((_o, i) => objectRowsOf(p, ctx, T, limits.skewSeconds, facts, i))];
}

/** Run every check the inputs allow. Never throws on a document it cannot read: an unreadable text is an S2 or D1 row, a stage that stops is an ERROR row. */
export function runChecks(input: RunInput): Report & { ctx: Ctx | null } {
  const limits = withLimits(input.limits);
  const { p, rows: inputRows } = readInputs(input, limits);
  if (!p) return reportOf(selectRows(inputRows, input.select), null);
  const read = readState(p, limits);
  const T = p.input.T ?? p.input.now ?? p.input.excerpt?.["read-at"] ?? null;
  const rows = [...declarationErrorRows(p), ...read.rows, ...safely("shallow check", () => shallowStage(p, read.ctx, T, limits), "VERDICT")];
  if (read.ctx && read.ti) rows.push(...safely("deep check", () => deepRows(p, read.ctx as Ctx, read.ti as TimeInfo), "D1"));
  else rows.push(...unusableReadRows(p.objs, read.unusable));
  return reportOf(selectRows(rows, input.select), read.ctx);
}

/** The shallow rows alone (9.3): S2 to S6 with C-SFC-2 (disclosure form) and C-SFC-5, over the served objects; no read is consulted. */
export function runShallowChecks(input: RunInput): Report {
  const limits = withLimits(input.limits);
  const { p, rows: inputRows } = readInputs({ ...input, excerpt: undefined, excerptText: undefined }, limits);
  if (!p) return { rows: selectRows(inputRows, input.select), summary: summaryOf(inputRows) };
  const T = p.input.T ?? p.input.now ?? null;
  const rows = selectRows([...declarationErrorRows(p), ...safely("shallow check", () => shallowStage(p, null, T, limits), "VERDICT")], input.select);
  return { rows, summary: summaryOf(rows) };
}

/** The deep rows alone (9.4), over a declaration that carries `ledger-evidence-2` and a read, or over the read alone; without a usable read, D1 and C-SFC-7 say why. */
export function runDeepChecks(input: RunInput): Report & { ctx: Ctx | null } {
  const limits = withLimits(input.limits);
  const { p, rows: inputRows } = readInputs(input, limits);
  if (!p) return reportOf(selectRows(inputRows, input.select), null);
  const read = readState(p, limits);
  if (!read.ctx || !read.ti) return reportOf(selectRows([...read.rows, ...unusableReadRows(p.objs, read.unusable)], input.select), null);
  const { ctx, ti } = read;
  return reportOf(selectRows(safely("deep check", () => deepRows(p, ctx, ti), "D1"), input.select), ctx);
}

// ---- S1 and S7 (9.3) --------------------------------------------------------------------------

/** What the caller fetched: where from and the media type it was served as (S1). */
export interface FetchedFrom {
  url: string;
  contentType: string | null;
  /** The caller accepts plain http for this run (a local instance); the row says so instead of refusing. */
  httpAllowed?: boolean;
}

/** S1: `application/sustainability-data+json` is PASS, `application/json` INFO, any other type FAIL; plain http is refused (NOT-EVALUABLE) unless the caller allowed it. */
export function fetchRow(f: FetchedFrom): Row {
  const type = (f.contentType ?? "").split(";")[0].trim().toLowerCase();
  const named = `${f.url} answered ${type || "no media type"}`;
  if (!f.url.startsWith("https:") && !f.httpAllowed) return row("S1", NE, `plain http refused (https only): ${f.url}`);
  const how = f.url.startsWith("https:") ? "" : " over plain http (allowed by the caller for a local instance)";
  if (type === "application/sustainability-data+json") return row("S1", PASS, `${named}${how}`);
  if (type === "application/json") return row("S1", INFO, `generic media type: ${named}${how}`);
  return row("S1", FAIL, `${named}${how}`);
}

/** The exact version of the consumer library that gave the S2 verdicts (S7). */
function consumerVersion(): string {
  try {
    return (require("sustainability-wellknown-consumer/package.json") as { version: string }).version;
  } catch {
    return "unknown";
  }
}

/** S7: what the shallow check did and did not establish (9.3 step 7). */
export function recordRow(objs: Json[], rows: Row[], T: string | null, readAt: string | undefined): Row {
  const first = objs[0];
  const verified = rows.some((r) => r.id === "S3" && r.result === PASS);
  const selected = rows.find((r) => r.id === "S4" && r.result === PASS)?.detail;
  const age = first && T && isInstant(first.updated) && isInstant(T) ? `${Math.round((epochOf(T) - epochOf(first.updated)) / 1000)} s` : "unknown";
  const parts = [
    `attributed to the origin; target evaluated: ${first?.target ?? "none"}`,
    `integrity ${verified ? "verified with a pinned key" : "not verified"}`,
    "figures self-asserted",
    "accuracy unknown",
    `T ${T ?? "none"}`,
    ...(readAt ? [`read-at ${readAt}`] : []),
    `period selected ${selected ?? "none"}`,
    `age of updated at T ${age}`,
    `profile ${PROFILE.version}`,
    `consumer library sustainability-wellknown-consumer ${consumerVersion()}`,
  ];
  return row("S7", INFO, parts.join("; "));
}

/** The effective attestations at a cut-off (5.6), sorted. */
export function effectiveList(ctx: Ctx, cutoff: string): { operator: string; type: string; month: string; hash: string }[] {
  return [...replay(ctx, cutoff).E.entries()]
    .map(([k, v]) => {
      const [operator, type, month] = k.split("|");
      return { operator, type, month, hash: v.hash };
    })
    .sort((a, b) => (`${a.operator}${a.type}${a.month}` < `${b.operator}${b.type}${b.month}` ? -1 : 1));
}

/** What to publish for a period: spec = { period, cutoff, level, operator?, energyUnit, carbonUnit, consensus }. */
export interface DeriveSpec extends TopLevelOptions {
  period: { start: string; end: string };
  cutoff: string;
  operator?: string;
}

export function derivedFor(ctx: Ctx, spec: DeriveSpec): Json {
  const level = spec.level ?? "network";
  const decl = level === "operator" ? { extensions: { [`${EXT}ledger-evidence-2`]: { operators: [{ operator: spec.operator }] } } } : null;
  const d = deriveFor(ctx, spec.cutoff, spec.period, decl, level);
  const t = topLevel(d, spec);
  return {
    spec,
    incomplete: { energy: d.incompleteEnergy, carbon: d.incompleteCarbon },
    silent: [
      ...d.silentEnergy.map((x) => `${x.operator} ${x.month.slice(0, 7)} EnergyAttested`),
      ...d.silentCarbon.map((x) => `${x.operator} ${x.month.slice(0, 7)} CarbonAttested`),
      ...d.noOperator.map((m) => `no operator ${m.slice(0, 7)}`),
    ].sort(),
    evidence: evidenceValue(d, { level }),
    top: t.top,
    carbonNeutrality: t.carbonNeutrality,
    networkTopology: t.networkTopology,
    location: locationFigures(d, spec as { carbonUnit?: string }),
  };
}
