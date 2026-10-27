/**
 * The checker as a function: one input in, the report out. The command line (../sfc-check.mjs) builds the
 * input from files and fetches; the tests build it from the vector scenarios.
 *
 * Input members, all optional:
 *   declarations | declarationText   the served objects, or the served text
 *   excerpt | excerptText            the ledger read (5.8), or its text
 *   parameters                       the methodology parameters (7.6)
 *   pins                             what the caller pinned out of band: methodology (true when the methodology
 *                                    document is pinned), registrar { host: [x] }, publisherKeys, operatorKeys
 *                                    (JWKs or { x }), entries1x (digests of trusted 1.x entries)
 *   T | now                          an explicit check instant, or the checker's clock
 *   limits                           limits of section 10, overridden
 *   clock                            a function returning milliseconds, in place of performance.now (tests)
 *   prior, oldLedgers                an earlier verified entry version; reads of old ledgers (takeover)
 *   network, retrievalUri            the origin whose network object S4 selects; the URI the body came from
 *   preRows                          rows already made by fetching (S1)
 */
import { prepareInput } from "./input.mjs";
import { buildContext } from "./ledger.mjs";
import { timeInfo } from "./window.mjs";
import { shallowCheck } from "./shallow.mjs";
import { deepCheck, stageRows } from "./deep.mjs";
import { eventUriRows } from "./uris.mjs";
import { withLimits } from "./limits.mjs";
import { hasEvidence, labelOf, readAsAbsent } from "./declaration.mjs";
import { row, NE, FAIL } from "./rows.mjs";
import { CheckLimit } from "./deadline.mjs";
import { buildReport } from "./report.mjs";
import { debugNote } from "./debug.mjs";

/** Rows for an unreadable body or read. */
function inputErrorRows(input) {
  const rows = [];
  const e = input.declarationError;
  if (e?.syntax) rows.push(row("S2", FAIL, `not valid JSON: ${e.syntax}`));
  if (e?.limit) rows.push(row("S2", NE, `limit: ${e.limit}`));
  return [...rows, ...input.bodyShapeRows];
}

const excerptErrorText = (e) => (e.limit ? `limit: ${e.limit}` : e.syntax ? `read is not valid JSON: ${e.syntax}` : `read is not a well-formed excerpt: ${e.malformed}`);

/** D1 and C-SFC-7 for each object that points to ledger evidence when no read is held (9.2). */
function noReadRows(objs, cause) {
  return objs.filter(hasEvidence).flatMap((o) => [row("D1", NE, cause, labelOf(o)), row("C-SFC-7", NE, cause, labelOf(o))]);
}

/** The deep check: once per object with `ledger-evidence-2`, else once for the read alone. */
function deepRows(ctx, ti, objs) {
  const withEvidence = objs.filter(hasEvidence);
  const rows = stageRows("event URI check", () => eventUriRows(ctx));
  const deep = (o) => stageRows("deep check", () => deepCheck(ctx, ti, o, objs));
  if (withEvidence.length) for (const o of withEvidence) rows.push(...deep(o));
  else rows.push(...deep(null));
  return rows;
}

/** Run one stage; an unexpected failure becomes an ERROR row, never a crash and never a pass. */
function safely(stage, fn, limitRowId) {
  try { return fn(); } catch (e) {
    if (e instanceof CheckLimit) return [row(limitRowId, NE, e.message)];
    debugNote(stage, e);
    return [row("ERROR", NE, `${stage} stopped`)];
  }
}

/** The context and time info of the read, or nulls and an ERROR row when building them throws. */
function contextOf(input, rows) {
  if (!input.excerpt) return { ctx: null, ti: null };
  try {
    const ctx = buildContext(input);
    return { ctx, ti: timeInfo(ctx) };
  } catch (e) {
    debugNote("read context", e);
    rows.push(row("ERROR", NE, "read context stopped"));
    return { ctx: null, ti: null };
  }
}

/** Run every check that the input allows and return the report. */
export async function runChecks(rawInput) {
  const input = prepareInput(rawInput);
  const limits = withLimits(input.limits);
  const served = input.objs;
  const objs = served.map(readAsAbsent);
  const rows = [...(input.preRows ?? []), ...inputErrorRows(input)];
  const { ctx, ti } = contextOf(input, rows);
  const T = input.T ?? input.now ?? input.excerpt?.["read-at"] ?? null;
  rows.push(...safely("shallow check", () => shallowCheck({ served, objs, input, objectIssues: input.objectIssues, rawClaims: input.rawClaims, T, skew: limits.skewSeconds, limits, ctx }).rows, "VERDICT"));
  if (ctx) rows.push(...safely("deep check", () => deepRows(ctx, ti, objs), "D1"));
  else if (input.excerptError) rows.push(...noReadRows(objs, excerptErrorText(input.excerptError)));
  else if (input.excerptFetchError) rows.push(...noReadRows(objs, input.excerptFetchError));
  else rows.push(...noReadRows(objs, "no ledger read given"));
  return buildReport({ rows, input, ctx, ti, T, objs });
}

