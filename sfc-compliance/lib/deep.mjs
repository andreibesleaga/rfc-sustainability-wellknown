/** The deep check (9.4): D1 to D9 with the window checks of D5 and C-SFC-7. */
import { add, cmp, ZERO, isZero } from "./decimal.mjs";
import { replay } from "./replay.mjs";
import { eKey, decOf } from "./rules.mjs";
import { deriveFor } from "./derive.mjs";
import { windowRows, csfc4, windowFacts, c6FollowsLedger, CAP_KWH } from "./window.mjs";
import { scanLimits, stopsDeepCheck } from "./limits.mjs";
import { monthOfEvent } from "./ledger.mjs";
import { voidInfos } from "./replay.mjs";
import { d2 } from "./deep-registry.mjs";
import { d3, d4, d5, ledgerOrderRow, evScope } from "./deep-chains.mjs";
import { csfc7 } from "./bridge.mjs";
import { registrySignedRows } from "./registry-signed.mjs";
import { addMonths, atOrBefore, before, isInstant, monthsBetween } from "./time.mjs";
import { row, PASS, FAIL, NE, INFO, list } from "./rows.mjs";
import { CheckLimit } from "./deadline.mjs";
import { debugNote } from "./debug.mjs";
import { extOf, levelOf, labelOf, usablePeriod } from "./declaration.mjs";

/**
 * Run one stage of the deep check. A stage that throws becomes one ERROR row and the rows of the other stages
 * stay, so a hostile read cannot turn a FAIL found by another stage into a bare error. The time limit is not
 * swallowed here: `safely` in check.mjs turns it into a NOT-EVALUABLE row naming the limit.
 */
export function stageRows(stage, fn) {
  try { return fn(); } catch (e) {
    if (e instanceof CheckLimit) throw e;
    debugNote(stage, e);
    return [row("ERROR", NE, `${stage} stopped`)];
  }
}

const PROFILE_VERSION = /^2\.[0-9]+$/;

/** The excerpt version as D1 names it: a number as it is, a short string quoted, anything else by kind. */
function versionText(v) {
  if (v === undefined) return "absent";
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.length <= 16 ? JSON.stringify(v) : `of type ${Array.isArray(v) ? "array" : typeof v}`;
}

/** Why a declaration cannot be checked against this read (`updated` unreadable, the read older than it, or stale), or undefined. */
function declarationCause(ctx, ti, decl) {
  if (!decl) return undefined;
  if (!isInstant(decl.updated)) return "updated is not an instant";
  if (before(ctx.readAt, decl.updated)) return "read-at before updated";
  return ti.stale ? "stale read" : undefined;
}

/** D1 access: can the read be used at all? Returns { result, detail, stop }; `stop` ends the deep check. */
function d1(ctx, ti, decl, hits) {
  const version = ctx.ex["excerpt-version"];
  const cause = declarationCause(ctx, ti, decl);
  const detail = version !== 2 ? `excerpt version ${versionText(version)}` : hits.length ? `limit: ${list(hits.map((h) => h.limit))}` : cause;
  const stop = version !== 2 || stopsDeepCheck(hits) || cause !== undefined;
  return { result: detail ? NE : PASS, detail, stop };
}

const findConsensus = (siblings) => siblings.map((o) => extOf(o, "network-topology")?.["consensus-mechanism"]).find((x) => typeof x === "string");
/** With a limit hit, the window rows that need the unread data are NOT-EVALUABLE. */
const limitWindow = (rows, names) => rows.map((r) => (["C-SFC-1", "C-SFC-2", "C-SFC-4"].includes(r.id) ? { ...r, result: NE, detail: `limit: ${names}` } : r));

/**
 * Run the whole deep check for one declaration object, or for the read alone (`decl` null).
 * `siblings` are the other objects of the served body. Returns rows in report order.
 */
export function deepCheck(ctx, ti, decl, siblings) {
  const label = decl ? labelOf(decl) : "read";
  const hits = scanLimits(ctx.ex, ctx.limits, ctx.input.excerptIssues, ctx.params);
  const access = d1(ctx, ti, decl, hits);
  const rows = [row("D1", access.result, access.detail, label)];
  if (access.stop) return decl ? [...rows, row("C-SFC-7", NE, access.detail, label)] : rows;
  return [...rows, ...stageRows("deep check", () => checkRows(ctx, ti, decl, siblings, hits, label, rows))];
}

/** The rows after D1 for a read that can be used. `rows` holds D1; C-SFC-7 reads the rows before it. */
function checkRows(ctx, ti, decl, siblings, hits, label, first) {
  const ev2 = decl ? extOf(decl, "ledger-evidence-2") : undefined;
  const level = decl ? levelOf(decl) : null;
  const cutoff = decl?.updated ?? ti.anchor;
  const st = replay(ctx, cutoff);
  const period = usablePeriod(decl);
  const profileNotRead = ev2 && !(PROFILE_VERSION.test(String(ev2["profile-version"])) && PROFILE_VERSION.test(String(ctx.ex["profile-version"])));
  const rows = [...first];
  const run = (stage, fn) => rows.push(...stageRows(stage, fn));
  run("D2", () => [ledgerOrderRow(ctx), ...d2(ctx, period ? decl : null, level, ev2, label)]);
  if (decl) run("D2 signed", () => registrySignedRows(ctx, decl, level, siblings, rows, label));
  run("D3", () => d3(ctx, st, cutoff, hits));
  run("D4", () => d4(ctx, cutoff, decl, level, label));
  run("D5", () => d5(ctx, st, cutoff, hits));
  run("window checks", () => windowAndPeriodRows(ctx, ti, decl, siblings, period, hits));
  if (decl) run("D7", () => d7(ctx, ti, decl, period, label));
  rows.push(row("D8", NE, "not performed", label));
  if (decl && period && ev2 && !profileNotRead) run("D6", () => noEmissionsInfo(ctx, decl, period, level, label));
  if (decl) run("C-SFC-7", () => [csfc7(ctx, decl, level, ev2, period, siblings, rows, hits, profileNotRead, label)]);
  return markUnauthenticated(rows.slice(first.length), ctx, ti);
}

const UNAUTHENTICATED = "consistent but not authenticated";

/**
 * 9.4 D2: with no registrar key pinned the Registry is the source's word, so no row computed from it may read as
 * a PASS. When a D2.entry row is NOT-EVALUABLE, a PASS of C-SFC-1, 2 and 4 becomes NOT-EVALUABLE (these are gate
 * rows, so the overall result follows), and so does a PASS of C-SFC-6 when its test 2 takes the result of C-SFC-2.
 * FAIL and NOT-EVALUABLE rows stay as they are. This runs last, after C-SFC-7 read the rows without it.
 */
function markUnauthenticated(rows, ctx, ti) {
  if (!rows.some((r) => r.id === "D2.entry" && r.result === NE)) return rows;
  const fromRegistry = new Set(["C-SFC-1", "C-SFC-2", "C-SFC-4"]);
  if (c6FollowsLedger(ctx, windowFacts(ctx, ti))) fromRegistry.add("C-SFC-6");
  return rows.map((r) => (r.result === PASS && fromRegistry.has(r.id) ? { ...r, result: NE, detail: UNAUTHENTICATED } : r));
}

/** C-SFC-4 over the declaration's period, and the window rows C-SFC-1, 2, 3, 6. */
function windowAndPeriodRows(ctx, ti, decl, siblings, period, hits) {
  const names = list(hits.map((h) => h.limit));
  const consensus = extOf(decl ?? {}, "network-topology")?.["consensus-mechanism"] ?? (siblings ? findConsensus(siblings) : undefined);
  const w = windowRows(ctx, ti, consensus, !decl);
  const rows = [];
  if (decl) {
    const scope = period ? `period ${period.start.slice(0, 7)}..${addMonths(period.end, -1).slice(0, 7)}` : null;
    rows.push(...(period ? csfc4(ctx, monthsBetween(period.start, period.end), decl.updated, scope, hits.length ? `limit: ${names}` : null)
      : [row("C-SFC-4", NE, "period not one month or one calendar year", labelOf(decl))]));
  }
  rows.push(...(hits.length ? limitWindow(w.rows, names) : w.rows));
  return rows;
}

function noEmissionsInfo(ctx, decl, period, level, label) {
  const d = deriveFor(ctx, decl.updated, period, decl, level);
  return d.status === "achieved" && !d.incompleteCarbon && isZero(d.footprint) && isZero(d.Off) ? [row("D6.info", INFO, "no emissions to cover", label)] : [];
}

// ---- D7 -----------------------------------------------------------------------------------

/** C-SFC-2 ledger form over the window at another cut-off. */
function c2At(ctx, facts, cutoff) {
  const st = replay(ctx, cutoff);
  let sum = ZERO, silent = false;
  for (const { en, m } of facts.opMonths) {
    const e = st.E.get(eKey(en.operator, "EnergyAttested", m));
    if (e) sum = add(sum, decOf(e.ev.event.payload.kWhConsumed)); else silent = true;
  }
  if (!facts.opMonths.length) return NE;
  if (cmp(sum, CAP_KWH) >= 0) return FAIL;
  return silent || facts.uncovered.length ? NE : PASS;
}

/** Events and void acts committed after `updated` and at or before `read-at` that touch the declared period. */
function laterCorrectionRows(ctx, decl, months) {
  const rows = [];
  const later = replay(ctx, ctx.readAt);
  const inPeriod = (m) => m !== null && months.includes(m);
  for (const ev of ctx.events) {
    if (!isInstant(ev.commit) || !before(decl.updated, ev.commit) || !atOrBefore(ev.commit, ctx.readAt)) continue;
    const v = later.verdicts.get(ev.i);
    if (v && !v.skipped && v.month !== null && inPeriod(v.month)) rows.push(row("D7", INFO, "superseded since publication", evScope(ev)));
  }
  const infos = voidInfos(ctx);
  ctx.voids.forEach((v, k) => {
    if (!infos[k].ok || !before(decl.updated, v.commit) || !atOrBefore(v.commit, ctx.readAt)) return;
    const target = infos[k].target;
    if (inPeriod(monthOfEvent(target)) && before(target.commit, decl.updated)) rows.push(row("D7", INFO, "superseded since publication", `void @${v.commit}`));
  });
  return rows;
}

function d7(ctx, ti, decl, period, label) {
  if (!period) return [];
  const months = monthsBetween(period.start, period.end);
  const rows = laterCorrectionRows(ctx, decl, months);
  const c4 = (cutoff) => csfc4(ctx, months, cutoff, "period", null)[0].result;
  rows.push(row("D7.C-SFC-4", INFO, `as of updated: ${c4(decl.updated)}; as of read-at: ${c4(ctx.readAt)}`, label));
  const facts = windowFacts(ctx, ti);
  rows.push(row("D7.C-SFC-2", INFO, `as of updated: ${c2At(ctx, facts, decl.updated)}; as of read-at: ${c2At(ctx, facts, ctx.readAt)}`, label));
  return rows;
}
