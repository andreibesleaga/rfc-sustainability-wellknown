/**
 * The acceptance rules L1 to L12 (5.5), split in two: rules that need only the event and the Registry
 * (staticRules) and rules that read the replay state (stateRules). Each returns the rule names broken
 * (`reasons`) and the rules that could not be evaluated (`ne`).
 */
import { dec, fromNumber, add, cmp, mulInt, ZERO, eq } from "./decimal.mjs";
import { prepare, indexAdd, indexRemove, tonneReused } from "./tonne-index.mjs";
import { isObject, isHex64, sameHost, figureOk, tonnesOk } from "./forms.mjs";
import { firstActiveMonth, activeIn } from "./registry.mjs";
import { addMonths, atOrBefore, cmpInstant, dueOf, isInstant, parseInstant } from "./time.mjs";
import { eventShapeTokens, monthOfEvent, spanOfEvent, sigInfo } from "./ledger.mjs";
import { figures1xOk } from "./profile1x.mjs";
import { methodologyPinned, registryForms, formRules, takeoverOf, referenceCanonical } from "./parameters.mjs";

export const decOf = (x) => fromNumber(x);
const num = (payload, key) => (payload[key] === undefined ? ZERO : decOf(payload[key]));
export const eKey = (subject, type, month) => `${subject}|${type}|${month}`;
export const chainKey = (subject, type) => `${subject}|${type}`;

/** The offset-coverage comparison of section 6 for a carbon payload: S1 + S2 + S3 <= R, exact. */
export function coverageHolds(p) {
  const emissions = add(add(num(p, "scope1KgCO2e"), num(p, "scope2KgCO2e")), num(p, "scope3KgCO2e"));
  return cmp(emissions, num(p, "offsetsKgCO2e")) <= 0;
}

/** A citation the single-use and timing rules can read; a malformed one is reported by L8 and read by no other rule. */
const readableCitation = (r) => isObject(r) && typeof r.kg === "number" && Number.isFinite(r.kg) && Number.isInteger(r.tonnesRetired)
  && typeof r.registry === "string" && typeof r.reference === "string" && typeof r.retiredAt === "string";

const citations = (ev) => {
  const r = ev.event?.payload?.retirements;
  return ev.kind === "2x" && ev.event.type === "CarbonAttested" && Array.isArray(r) ? r.filter(readableCitation) : [];
};

// ---- static rules -------------------------------------------------------------------------

function brokenL1(ctx, ev, month) {
  const e = ev.event;
  const entry = isObject(e) ? ctx.byOperator.get(e.subject) : undefined;
  const typeOk = e?.type === "EnergyAttested" || e?.type === "CarbonAttested";
  const networkOk = ev.kind === "1x" || sameHost(e?.network, ctx.network);
  const activeOk = entry && (month === null || activeIn(entry, month));
  return !typeOk || !networkOk || e?.subject !== e?.actor || !entry || !activeOk;
}

function brokenL3(ev, month) {
  const e = ev.event;
  if (ev.kind === "1x" && month === null) return false;
  const end = ev.kind === "2x" ? e?.payload?.period?.end : addMonths(month, 1);
  return !(isInstant(end) && isInstant(e?.ts) && atOrBefore(end, e.ts) && atOrBefore(end, ev.commit));
}

/** L5 with the "encoding" and "weak key" findings of section 10 on their own: { reason, ne }. */
function signatureFinding(ctx, ev) {
  const sig = sigInfo(ctx, ev);
  if (!sig.alg) return ev.kind === "1x" ? { ne: "L5:alg" } : { reason: "L5" };
  if (!sig.encoding) return { reason: "encoding" };
  if (sig.weak) return { reason: "weak" };
  return sig.noKey || !sig.verified ? { reason: "L5" } : {};
}

const ENERGY_FIGURES = ["kWhConsumed"];
const CARBON_FIGURES = ["scope1KgCO2e", "scope2KgCO2e", "scope2LocationKgCO2e", "scope3KgCO2e", "offsetsKgCO2e"];

function retirementFiguresOk(retirements) {
  return retirements.every((r) => figureOk(r.kg) && tonnesOk(r.tonnesRetired) && cmp(decOf(r.kg), mulInt(dec(r.tonnesRetired), 1000)) <= 0);
}
function figuresOk(e) {
  const p = e.payload;
  const names = e.type === "EnergyAttested" ? ENERGY_FIGURES : CARBON_FIGURES;
  if (!names.every((k) => p[k] === undefined || figureOk(p[k]))) return false;
  return e.type !== "CarbonAttested" || !Array.isArray(p.retirements) || retirementFiguresOk(p.retirements);
}
/** `offsetsKgCO2e` equals the exact sum of `kg` over the retirements (L8). */
function offsetsMatch(e) {
  const p = e.payload;
  if (e.type !== "CarbonAttested" || !Array.isArray(p.retirements) || typeof p.offsetsKgCO2e !== "number") return true;
  const kg = p.retirements.filter(isObject).filter((r) => typeof r.kg === "number");
  return eq(kg.reduce((a, r) => add(a, decOf(r.kg)), ZERO), decOf(p.offsetsKgCO2e));
}
const brokenL8 = (ev, shape) => shape.length > 0 || (ev.kind === "2x" ? !figuresOk(ev.event) || !offsetsMatch(ev.event) : !figures1xOk(ev.event));

const FIGURE_MEMBERS = ["scope1KgCO2e", "scope2KgCO2e", "scope3KgCO2e", "offsetsKgCO2e"];
const figuresReadable = (e) => FIGURE_MEMBERS.every((k) => e.payload[k] === undefined || typeof e.payload[k] === "number");
const brokenL7 = (e, shape) => e?.type === "CarbonAttested" && !shape.length && figuresReadable(e) && e.payload.netZero !== coverageHolds(e.payload);

/** Rules that depend only on the event and the Registry: L1, L2, L3, L5, L7 and L8. */
export function staticRules(ctx, ev) {
  const reasons = [], ne = [];
  const shape = eventShapeTokens(ev);
  const month = monthOfEvent(ev);
  if (brokenL1(ctx, ev, month)) reasons.push("L1");
  if (ev.kind === "2x" && month === null) reasons.push("L2");
  if (brokenL3(ev, month)) reasons.push("L3");
  const sig = signatureFinding(ctx, ev);
  if (sig.reason) reasons.push(sig.reason);
  if (sig.ne) ne.push(sig.ne);
  if (brokenL8(ev, shape)) reasons.push("L8");
  if (brokenL7(ev.event, shape)) reasons.push("L7");
  return { reasons, ne, shape, month, span: spanOfEvent(ev) };
}

// ---- state rules --------------------------------------------------------------------------

const tipOf = (chain) => (chain.length ? chain[chain.length - 1].hash : null);

/** L4: `prev` is the tip; a takeover link is accepted when it equals the tip the methodology document lists. */
function brokenL4(ctx, ev, chain) {
  const e = ev.event;
  const tip = tipOf(chain);
  if (e.prev === tip) return false;
  if (tip !== null || !isHex64(e.prev)) return true;
  const listed = takeoverOf(ctx, e.subject, e.type)?.tip;
  return methodologyPinned(ctx) ? listed !== e.prev : listed !== undefined && listed !== e.prev;
}

/** L6: `supersedes` is absent, or equals the effective attestation of the month (1.x: an earlier event of the month). */
function brokenL6(ev, st, month) {
  const e = ev.event;
  const current = st.E.get(eKey(e.subject, e.type, month));
  const sup = e.payload?.supersedes;
  if (ev.kind === "2x") return current ? sup !== current.hash : sup !== undefined;
  return Boolean(current) && !st.monthHashes.has(`${chainKey(e.subject, e.type)}|${month}|${sup}`);
}

export const instantKey = (t) => { const p = parseInstant(t); return p ? `${p.sec}.${p.frac}` : `bad:${t}`; };

/** What the single-use index needs to read a citation of this read. */
const indexReader = (ctx) => ({ decOf, instantKey, ranged: (registry) => formRules(ctx, registry).includes("range-first-last") });

/** The L9 index entry of an event that becomes effective (called where `st.E` gains it). */
export function fileCitations(ctx, st, owner, ev) {
  indexAdd(st.L9, owner, citations(ev).map((c) => prepare(c, indexReader(ctx))));
}
/** Remove the L9 index entry of an event that leaves the effective set (superseded or voided). */
export const unfileCitations = (st, owner) => indexRemove(st.L9, owner);

/** L9: single use of each tonne over the effective set, this event in place of the one it supersedes. */
function brokenL9(ctx, st, ev, month) {
  const mine = citations(ev).map((c) => prepare(c, indexReader(ctx)));
  return tonneReused(st.L9, eKey(ev.event.subject, ev.event.type, month), mine);
}

/** L8b: each registry and reference is in the form the methodology document names. */
function retirementForms(ctx, ev) {
  const r = citations(ev);
  const regs = registryForms(ctx);
  if (r.length && regs === undefined) return { ne: "L8b:retirement-registries" };
  const bad = r.some((x) => !regs.includes(x.registry) || (typeof x.reference === "string" && !referenceCanonical(x.reference, formRules(ctx, x.registry))));
  return bad ? { reason: "L8b" } : {};
}

const brokenL10 = (ev, month) => citations(ev).some((x) => !(isInstant(x.retiredAt) && atOrBefore(x.retiredAt, dueOf(month)) && atOrBefore(x.retiredAt, ev.commit)));

/** L12: at most 20 2.0 events of one month in a chain, and the chain limit of section 10. */
function brokenL12(ctx, st, ev, chain, month) {
  const sameMonth = st.monthCounts.get(`${chainKey(ev.event.subject, ev.event.type)}|${month}`) ?? 0;
  return sameMonth >= 20 || chain.length >= ctx.limits.eventsPerChain;
}

/** Rules of a 2.0 event that need the replay state: L8b, L9, L10 and L12. */
function state2x(ctx, st, ev, chain, month) {
  const reasons = [], ne = [];
  if (ev.event.type === "CarbonAttested" && Array.isArray(ev.event.payload?.retirements)) {
    const forms = retirementForms(ctx, ev);
    if (forms.reason) reasons.push(forms.reason);
    if (forms.ne) ne.push(forms.ne);
    if (month !== null && brokenL9(ctx, st, ev, month)) reasons.push("L9");
    if (month !== null && brokenL10(ev, month)) reasons.push("L10");
  }
  if (month !== null && brokenL12(ctx, st, ev, chain, month)) reasons.push("L12");
  return { reasons, ne };
}

/** Rules of a 1.x event: L11 and L11b. */
function state1x(ctx, st, ev, month) {
  const reasons = [];
  if (st.twoXBySubject.has(ev.event.subject)) reasons.push("L11");
  const entry = ctx.byOperator.get(ev.event.subject);
  if (month !== null && entry && entry.form === "2x") {
    const switchMonth = entry.profile2From ?? firstActiveMonth(entry);
    if (switchMonth && cmpInstant(month, switchMonth) >= 0) reasons.push("L11b");
  }
  return { reasons, ne: [] };
}

/** Rules that read the replay state: L4, L6, L8b, L9, L10, L11, L11b, L12. */
export function stateRules(ctx, st, ev, month) {
  const e = ev.event;
  const chain = st.chains.get(chainKey(e.subject, e.type)) ?? [];
  const reasons = [];
  if (brokenL4(ctx, ev, chain)) reasons.push("L4");
  if (month !== null && brokenL6(ev, st, month)) reasons.push("L6");
  const rest = ev.kind === "2x" ? state2x(ctx, st, ev, chain, month) : state1x(ctx, st, ev, month);
  return { reasons: [...reasons, ...rest.reasons], ne: rest.ne };
}
