/** S4 selection, C-SFC-2 disclosure form and C-SFC-5 (9.2, 9.3). */
import { fromNumber, mulInt, cmp, shift, sub, abs } from "./decimal.mjs";
import { isObject, isMonthBound, sameTarget, figureOk } from "./forms.mjs";
import { row, PASS, FAIL, NE, INFO, list } from "./rows.mjs";
import { extOf, labelOf, samePeriodTarget } from "./declaration.mjs";
import { shiftOf, ENERGY_SHIFT } from "./derive.mjs";
import { CAP_KWH } from "./window.mjs";
import { METRICS, missing74 } from "./coherence.mjs";
import { before, atOrBefore, addCalendarMonths, epoch, isInstant } from "./time.mjs";

const YEAR_START = /^(\d{4})-01-01T00:00:00(Z|[+-]\d{2}:\d{2})$/;

/** A whole calendar year: both bounds on 1 January 00:00 in one offset, the end a year after the start. */
export function calendarYear(period, ledgerBacked = false) {
  if (!isObject(period)) return null;
  const a = YEAR_START.exec(String(period.start)), b = YEAR_START.exec(String(period.end));
  if (!a || !b || (ledgerBacked && a[2] !== "Z") || a[2] !== b[2] || Number(b[1]) !== Number(a[1]) + 1) return null;
  if (!isInstant(period.start) || !isInstant(period.end)) return null;
  return { year: Number(a[1]), offset: a[2] };
}

const isNetworkObject = (o) => o["target-type"] === "service" && typeof extOf(o, "network-topology")?.["member-of-network"] !== "string";

/** Group the candidate objects by period, split into whole calendar years and the rest. */
function groupYears(candidates) {
  const groups = new Map();
  for (const o of candidates) {
    const key = `${o.period?.start ?? "(none)"}|${o.period?.end ?? "(none)"}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const rows = [], years = [];
  for (const [key, objects] of groups) {
    const [start, end] = key.split("|");
    const ledgerBacked = objects.some((o) => extOf(o, "ledger-evidence-2") !== undefined);
    if (calendarYear({ start, end }, ledgerBacked) === null) rows.push(row("S4.info", INFO, `period ${start} to ${end} excluded: not a whole calendar year`));
    else years.push({ start, end, os: objects });
  }
  return { rows, years };
}

/** S4: choose the annual network object. Returns { rows, primary, selected }. */
export function selectAnnual(objs, target, T) {
  const candidates = objs.filter((o) => sameTarget(o.target, target) && isNetworkObject(o));
  if (!candidates.length) return { rows: [row("S4", NE, `no network declaration for ${target}`)], primary: null };
  const { rows, years } = groupYears(candidates);
  const ended = years.filter((y) => atOrBefore(y.end, T)).sort((a, b) => (before(a.end, b.end) ? -1 : 1));
  for (const y of years.filter((x) => !atOrBefore(x.end, T))) rows.push(row("S4.info", INFO, `period not yet ended at T: ${y.start} to ${y.end}`));
  if (!ended.length) { rows.push(row("S4", NE, "no annual network object ended at or before T")); return { rows, primary: null }; }
  const selected = ended[ended.length - 1];
  for (const y of ended.slice(0, -1)) rows.push(row("S4.info", INFO, `other year: ${y.start} to ${y.end}`));
  const old = before(addCalendarMonths(selected.end, 18), T) ? "; ended more than 18 months before T" : "";
  rows.push(row("S4.info", INFO, `latest year selected: ${selected.start} to ${selected.end}${old}`));
  const primary = selected.os.find((o) => o["carbon-accounting"] === "market-based") ?? selected.os.find((o) => extOf(o, "ledger-evidence-2") !== undefined) ?? null;
  rows.push(primary ? row("S4", PASS, `${selected.start} to ${selected.end}`) : row("S4", NE, "no market-based object and none with ledger-evidence-2"));
  return { rows, primary, selected };
}

const unitShift = (o) => shiftOf(ENERGY_SHIFT, o["energy-unit"]);
const toKwh = (o) => { const x = fromNumber(o["energy-consumption"]); const k = unitShift(o); return k >= 0 ? mulInt(x, 10 ** k) : shift(x, -k); };

/** C-SFC-2 disclosure form on the selected annual object. */
export function csfc2Disclosure(selected, primary, incomplete) {
  const scope = "disclosure";
  if (!primary) return row("C-SFC-2", NE, "no primary object", scope);
  if (incomplete) return row("C-SFC-2", NE, "incomplete object", scope);
  if (primary["energy-consumption"] === undefined || unitShift(primary) === undefined) return row("C-SFC-2", NE, "figure or unit missing", scope);
  const readable = (o) => o["energy-consumption"] !== undefined && unitShift(o) !== undefined;
  if (selected.os.some((o) => readable(o) && cmp(toKwh(o), toKwh(primary)) !== 0)) {
    return row("C-SFC-2", NE, "annual objects of one target and period disagree", scope);
  }
  const kwh = toKwh(primary);
  const nearCap = cmp(abs(sub(kwh, CAP_KWH)), shift(CAP_KWH, 2)) <= 0; // |figure - CAP| <= 0.01 x CAP
  const detail = nearCap ? "INFO within 1% of CAP: the methodology document must say no perturbation was applied" : undefined;
  return row("C-SFC-2", cmp(kwh, CAP_KWH) < 0 ? PASS : FAIL, detail, scope);
}

const CARBON_FIGURES = ["carbon-footprint", "scope-1", "scope-2", "scope-3"];
const ROUNDED = ["energy-consumption", "scope-1", "scope-2", "scope-3", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"];

/** 3.3 rule 2 on a published value: at most 15 digits in all, at most 6 after the point; a sign is allowed (a 1.x Scope figure may be negative, 12.1). */
const figurePublishable = (x) => figureOk(Math.abs(x));

function levelTokens(obj, level, ev) {
  const t = [];
  if (level === "network") {
    for (const name of missing74(obj, ev).m) t.push(`missing:${name}`);
    if (obj["target-type"] !== "service") t.push("target-type");
    if (obj["disclosure-uri"] === undefined) t.push("disclosure-uri");
    return t;
  }
  const numeric = METRICS.some((k) => obj[k] !== undefined);
  if (!numeric && obj["disclosure-uri"] === undefined && obj["verifiable-attestation-uri"] === undefined) t.push("no evidence member");
  if (obj["target-type"] === "origin" && ev && typeof extOf(obj, "network-topology")?.["member-of-network"] !== "string") t.push("member-of-network");
  return t;
}

function evidenceTokens(obj, ev, s3rows) {
  const t = [];
  if (typeof obj.signed !== "string") t.push("signed absent");
  else if (s3rows.some((r) => r.id === "S3" && r.result === FAIL)) t.push("signed");
  if (!(isMonthBound(obj.period?.start) && isMonthBound(obj.period?.end))) t.push("period not month-bound");
  if (!/^2\.[0-9]+$/.test(String(ev["profile-version"]))) t.push("profile-version");
  for (const k of ROUNDED) if (typeof obj[k] === "number" && !figurePublishable(obj[k])) t.push(`figure:${k}`);
  return t;
}

/** What the paired location object must carry; the energy members only when the primary has them (7.5 rule 4). */
function pairedTokens(obj, paired) {
  const need = ["target-type", "carbon-unit", "scope-2", "carbon-footprint", "signed", "updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"];
  if (obj["energy-consumption"] !== undefined) need.push("energy-consumption", "energy-unit");
  if (obj["disclosure-uri"] !== undefined) need.push("disclosure-uri");
  return need.filter((k) => paired[k] === undefined).map((k) => `paired:${k}`);
}

/** C-SFC-5 on one object that claims SFC. `s2valid` is the consumer library's verdict; `s3rows` are searched for a rejection. */
export function csfc5(obj, level, siblings, T, skew, s2valid, s3rows) {
  const ev = extOf(obj, "ledger-evidence-2");
  const t = [];
  if (!s2valid) t.push("S2");
  t.push(...levelTokens(obj, level, ev));
  if (obj["energy-consumption"] !== undefined && obj["energy-unit"] === undefined) t.push("energy-unit");
  if (CARBON_FIGURES.some((k) => obj[k] !== undefined) && obj["carbon-unit"] === undefined) t.push("carbon-unit");
  if (ev) t.push(...evidenceTokens(obj, ev, s3rows));
  if (isInstant(obj.updated) && epoch(obj.updated) > epoch(T) + skew) t.push("updated after T");
  const paired = obj["carbon-accounting"] === "market-based"
    ? (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based") : undefined;
  if (paired) t.push(...pairedTokens(obj, paired));
  return row("C-SFC-5", t.length ? FAIL : PASS, list(t), labelOf(obj));
}
