/**
 * Reading profile 1.x (section 12.1): events, Registry entries and declarations written before 2.0.
 * A 1.x item is read, never rewritten, and judged by the 1.x rules of Appendix C.
 */
import { isObject, isHex64, isDid, isInstant, isFullDate, isInt, isNum } from "./forms.mjs";
import { collect, isSig, METHODS } from "./shapes.mjs";
import { addDays, addMonths } from "./time.mjs";
import { row, INFO } from "./rows.mjs";
import { extOf, labelOf } from "./declaration.mjs";

// ---- events -------------------------------------------------------------------------------

/** A 1.x event has `payload.period` with `from` and `to` (12.1 rule 1). */
export const is1xEvent = (e) => isObject(e) && isObject(e.payload) && isObject(e.payload.period)
  && ("from" in e.payload.period || "to" in e.payload.period);

/** Shape of a 1.x event: only what 12.1 needs to read it. */
export function event1xShape(e) {
  const c = collect();
  if (!isObject(e)) { c.need(false, "event"); return c.done(); }
  c.need(e.type === "EnergyAttested" || e.type === "CarbonAttested", "type");
  c.need(isDid(e.subject), "subject");
  c.need(isDid(e.actor), "actor");
  c.need(e.prev === null || isHex64(e.prev), "prev");
  c.need(isInstant(e.ts), "ts");
  c.need(isObject(e.payload), "payload");
  c.need(isSig(e.sig), "sig");
  if (isObject(e.payload)) {
    const p = e.payload;
    c.need(isObject(p.period) && typeof p.period.from === "string" && typeof p.period.to === "string", "payload.period");
    c.need(p.supersedes === undefined || isHex64(p.supersedes), "payload.supersedes");
  }
  return c.done();
}

/** The month (start instant) a 1.x event maps to: its dates are the first and last day of one UTC month. */
export function month1x(period) {
  if (!isObject(period) || !isFullDate(period.from) || !isFullDate(period.to)) return null;
  const start = `${period.from.slice(0, 7)}-01T00:00:00Z`;
  const last = addDays(addMonths(start, 1), -1).slice(0, 10);
  return period.from === start.slice(0, 10) && period.to === last ? start : null;
}

/** [start, end) of a 1.x period as instants: `from` 00:00Z to 00:00Z after `to`; null when invalid. */
export function span1x(period) {
  if (!isObject(period) || !isFullDate(period.from) || !isFullDate(period.to) || period.to < period.from) return null;
  return [`${period.from}T00:00:00Z`, addDays(`${period.to}T00:00:00Z`, 1)];
}

/** Basis of a Scope 2 figure: 2.0 is market-based; 1.x says so itself, else the parameter, else unknown. */
export const scope2Basis1x = (params, payload) => payload.scope2Method ?? params["scope2-basis-1x"] ?? null;

/** A missing or out-of-set `measurementMethod` counts as `third-party-modeled` (12.1 rule 1). */
export const methodOf = (payload) => (METHODS.includes(payload.measurementMethod) ? payload.measurementMethod : "third-party-modeled");

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * L8 for a 1.x event: the 1.2 figure members are present with their types (`nodeCount` and `kWhConsumed`;
 * `scope2KgCO2e`, `scope3KgCO2e`, `offsetsKgCO2e`, `netZero`), and `kWhConsumed`, `nodeCount` and
 * `offsetsKgCO2e` are not negative. A negative Scope 2 or 3 is read as is (12.1); the digit limits of 3.3 do not apply.
 */
export function figures1xOk(e) {
  const p = e.payload;
  if (e.type === "EnergyAttested") return isInt(p.nodeCount) && isNum(p.kWhConsumed);
  return isNumber(p.scope2KgCO2e) && isNumber(p.scope3KgCO2e) && isNum(p.offsetsKgCO2e) && typeof p.netZero === "boolean";
}

// ---- Registry entries ---------------------------------------------------------------------

/** A 1.x entry has `keys[].public-jwk` and no `sig` (12.1 rule 6). */
export const is1xEntry = (en) => isObject(en) && !("sig" in en) && Array.isArray(en.keys)
  && en.keys.some((k) => isObject(k) && "public-jwk" in k);

/** Intervals as instants with an exclusive `to` (the 1.x `to` is an inclusive date) and keys with the 2.0 names. */
export function normalise1xEntry(raw) {
  return {
    intervals: (Array.isArray(raw.active) ? raw.active : []).filter((a) => isObject(a) && isFullDate(a.from) && (a.to === null || isFullDate(a.to))).map((a) => ({
      from: `${a.from}T00:00:00Z`,
      to: a.to === null ? null : addDays(`${a.to}T00:00:00Z`, 1),
    })),
    keys: (Array.isArray(raw.keys) ? raw.keys : []).filter(isObject).map((k) => ({
      x: k["public-jwk"]?.x, from: k["valid-from-commit"], to: k["valid-to-commit"],
    })),
  };
}

// ---- declarations -------------------------------------------------------------------------

/** An object with the old name `ledger-evidence` and not `ledger-evidence-2` (12.1 rule 3a and 3b). */
export const hasOnlyOldEvidence = (obj) => extOf(obj, "ledger-evidence") !== undefined && extOf(obj, "ledger-evidence-2") === undefined;

/** The rows for such an object: it is not an SFC 2.0 declaration, and no 2.0 check can pass on it. */
export function legacyRows(obj, failsS2) {
  const label = labelOf(obj);
  const detail = failsS2 ? "profile 1.1 evidence, pre-10 wire" : "profile 1.1 evidence, not an SFC 2.0 declaration";
  return [row("LEGACY", INFO, detail, label), row("VERDICT", "NOT-APPLICABLE", undefined, label)];
}

// ---- report notes -------------------------------------------------------------------------

const NEGATIVE_MEMBERS = ["scope2KgCO2e", "scope3KgCO2e"];

/** INFO rows for one 1.x event (D5): what is read differently, and why. */
export function notes1x(ctx, st, ev, chainEvents, evScope) {
  const verdict = st.verdicts.get(ev.i);
  const p = ev.event.payload ?? {};
  const out = [];
  const note = (text) => out.push(row("D5.1x", INFO, text, evScope(ev)));
  if (verdict.month === null) note("profile 1.x event, period not a month");
  if (ev.event.type === "EnergyAttested" && !METHODS.includes(p.measurementMethod)) {
    note(`measurementMethod ${p.measurementMethod === undefined ? "absent" : p.measurementMethod} counts as third-party-modeled`);
  }
  if (ev.event.type === "CarbonAttested") {
    const basis = scope2Basis1x(ctx.params, p);
    if (basis === null) note("scope 2 basis undeterminable");
    else if (basis === "location-based") note("scope 2 on the location basis");
    for (const k of NEGATIVE_MEMBERS) if (typeof p[k] === "number" && p[k] < 0) note(`negative ${k} read as is`);
    note("retirement rules L8b to L10 not applied");
  }
  if (verdict.month !== null) {
    const sameMonth = chainEvents.filter((o) => o.kind === "1x" && st.verdicts.get(o.i).month === verdict.month);
    if (sameMonth.length > 20 && sameMonth[0] === ev) note(`more than 20 1.x events in month ${verdict.month.slice(0, 7)}`);
  }
  return out;
}
