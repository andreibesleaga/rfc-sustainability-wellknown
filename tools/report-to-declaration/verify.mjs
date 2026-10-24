/**
 * The part that does not trust the model.
 *
 * `verifyFigures` keeps a proposed figure only when its quote exists in the
 * source text (on a page this file locates itself) and a whole number token in
 * that quote, read with its own sign and scale, equals the proposed value. A
 * unit or accounting basis must be written in its quote. A member the report
 * gives two different values for is not chosen between. `buildDeclaration`
 * assembles what survived; only an approval naming a reviewer lets a document
 * say it was checked.
 */

import {
  ALLOWED_METHODS, CARBON_ACCOUNTING, CARBON_UNITS, ENERGY_UNITS, LEGACY_CARBON_UNIT, TARGET_TYPES,
} from "./tokens.mjs";
import { PeriodError, hasEnded, isYearLabel, labelYears, periodFromLabel } from "./period.mjs";

export { ALLOWED_METHODS, TARGET_TYPES };

export const ENUMS = {
  "energy-unit": ENERGY_UNITS,
  "carbon-unit": CARBON_UNITS,
  "carbon-accounting": CARBON_ACCOUNTING,
};
const NUMERIC = new Set([
  "energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
  "renewable-energy", "carbon-intensity-gCO2e-per-kWh",
]);
const SCOPES = new Set(["scope-1", "scope-2", "scope-3"]);
// The members a report can give once per accounting basis; each basis becomes its own object.
const BY_BASIS = new Set(["carbon-footprint", "scope-2"]);
const MAX_QUOTE = 300;

/** The members a model may propose. `measurement-method` is not one: it is the human's to state. */
export const EXTRACTABLE = [
  "period", "energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit",
  "carbon-accounting", "scope-1", "scope-2", "scope-3", "renewable-energy",
  "carbon-intensity-gCO2e-per-kWh",
];

// Replies recorded before the draft replaced reporting-period still replay.
const MEMBER_ALIAS = { "reporting-period": "period" };

// Words that make a whole-year label doubtful: the report may cover only part of the year.
const PARTIAL_YEAR = /\b(?:half[\s-]?year|first half|second half|H[12]|Q[1-4]|(?:[1-4](?:st|nd|rd|th)|first|second|third|fourth)\s+quarter|quarterly|year[\s-]to[\s-]date|YTD|interim|first\s+(?:\d+|three|four|five|six|seven|eight|nine|ten|eleven)\s+months)\b|(?<!twelve |12 |twelve-|12-)\bmonths?\s+(?:ended|ending)\b/i;

/** Normalize invisible and typographic spaces, then collapse whitespace. */
export function squash(s) {
  return String(s)
    .replace(/[­​‌‍⁠﻿]/g, "")
    .replace(/[    ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** pdftotext separates pages with form feeds; the 1-based pages a quote is on. */
export function locatePages(sourceText, quote) {
  const q = squash(quote);
  const pages = String(sourceText).split("\f");
  if (pages.length < 2) return [];
  const out = [];
  for (let i = 0; i < pages.length; i++) if (squash(pages[i]).includes(q)) out.push(i + 1);
  return out;
}
export const locatePage = (text, quote) => locatePages(text, quote)[0];

/**
 * Every number written in a quote, as maximal tokens with their sign and every
 * reading a reader could give them. "1 120" is one token (1120), never "120";
 * "(180)" and "−180" are negative; "1,234" and "1.234" are ambiguous between a
 * thousands group and a decimal, and are flagged as such.
 */
export function numberTokens(quote) {
  const re = /(\()?([-−–])?(\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(\))?/g;
  const out = [];
  let m;
  while ((m = re.exec(quote))) {
    const [whole, open, dash, body, close] = m;
    const start = m.index + (open ? 1 : 0) + (dash ? 1 : 0);
    const before = quote.slice(0, m.index);
    // A hyphen joined to a word or a digit is not a minus: "Scope-1", "1-3".
    const dashIsMinus = !!dash && !/[\p{L}\p{N}]$/u.test(before);
    const negative = (open && close) || dashIsMinus;
    const readings = new Set();
    const ambiguous = [];
    const seps = body.match(/[ ,.]/g) ?? [];
    if (seps.length === 0) readings.add(Number(body));
    else {
      // Grouped with spaces: groups are thousands; a final [.,]d+ is the decimal part.
      const spaced = /^\d{1,3}( \d{3})+([.,]\d+)?$/.test(body);
      if (spaced) readings.add(Number(body.replace(/ /g, "").replace(",", ".")));
      // English: commas group, a dot is the decimal point.
      if (/^\d{1,3}(,\d{3})*(\.\d+)?$/.test(body)) readings.add(Number(body.replace(/,/g, "")));
      // European: dots group, a comma is the decimal point.
      if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(body)) readings.add(Number(body.replace(/\./g, "").replace(",", ".")));
      // A single separator followed by exactly three digits reads both ways.
      if (/^\d{1,3}[.,]\d{3}$/.test(body)) ambiguous.push(body);
    }
    out.push({
      text: whole,
      start,
      negative: !!negative,
      values: [...readings].filter(Number.isFinite).map((v) => (negative ? -v : v)),
      ambiguous: ambiguous.length > 0,
      yearLike: seps.length === 0 && /^(19|20)\d{2}$/.test(body) && !negative,
      afterScope: /scope[\s-]*$/i.test(before),
    });
  }
  return out;
}

const SCALE_IN_QUOTE = /\b(thousands?|millions?|billions?|mn|bn)\b|'000|\(000\b|\b000s\b|\b[kMG]t\s*CO|\b\d+(?:[.,]\d+)?\s*(?:k|m)\s*(?:tonnes?|t)\b/i;
const SCALE_NEARBY = /\b(thousands?|millions?)\b|'000|\(000\b|\b000s\b|\b[kMG]t\s*CO/i;

const UNIT_IN_QUOTE = {
  "energy-unit": { Wh: /(^|[^kMGm])\bWh\b/, kWh: /\bkWh\b/, MWh: /\bMWh\b/, GWh: /\bGWh\b/ },
  "carbon-unit": {
    gCO2e: /(^|[^kKmM])\bg\s*CO[2₂]/,
    kgCO2e: /\bkg\s*CO[2₂]/i,
    // Metric tonnes. Megatonnes (MtCO2e) and kilotonnes (ktCO2e) are NOT this unit.
    tCO2e: /(\bt\s*CO[2₂]|\btonnes?\b|\bmetric tons?\b|\btons?\s+of\s+CO[2₂]|\bmtCO[2₂])/i,
  },
  "carbon-accounting": { "location-based": /location[\s-]?based/i, "market-based": /market[\s-]?based/i },
};
const NOT_TONNES = /\b[MK]t\s*CO|\bkt\b|\bMt\b/;

/** Parse a proposed value: a number, or a string that is one number token and nothing else. */
function proposedNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const s = squash(v);
  const toks = numberTokens(s);
  if (toks.length !== 1 || toks[0].text !== s || toks[0].values.length !== 1) return undefined;
  return toks[0].values[0];
}

/**
 * `offset` is the fixed offset (`Z` or ±hh:mm) the period's bounds are written in;
 * `wholePeriod` confirms that a report speaking of a quarter or half-year still
 * covers the whole calendar year it names.
 */
export function verifyFigures(figures, sourceText, { now = new Date(), offset = "Z", wholePeriod = false } = {}) {
  const haystack = squash(sourceText);
  const candidates = [];
  const rejected = [];

  for (const f of Array.isArray(figures) ? figures : []) {
    const member = MEMBER_ALIAS[f?.member] ?? f?.member;
    const reject = (reason) => rejected.push({ member: typeof member === "string" ? member : String(member), value: f?.value, quote: f?.quote, reason });

    if (typeof member !== "string" || !EXTRACTABLE.includes(member)) { reject("not a member this tool extracts"); continue; }
    if (typeof f.quote !== "string" || squash(f.quote).length < 8) { reject("no usable quote"); continue; }
    const quote = squash(f.quote);
    if (quote.length > MAX_QUOTE) { reject(`the quote is longer than ${MAX_QUOTE} characters; a figure needs a precise quote`); continue; }
    if (!haystack.includes(quote)) { reject("the quote is not in the source text"); continue; }

    const pages = locatePages(sourceText, quote);
    const checks = ["quote found in source"];
    const flags = [];
    if (pages.length === 1) checks.push(`located on page ${pages[0]}`);
    if (pages.length > 1) flags.push(`the quote appears on pages ${pages.join(", ")} — CHECK BY HAND which one is meant`);
    const page = pages[0];

    if (NUMERIC.has(member)) {
      const value = proposedNumber(f.value);
      if (value === undefined) { reject("the value is not one plain number"); continue; }
      const basis = accountingOf(f, member);
      if (basis === null) { reject(`accounting must be ${CARBON_ACCOUNTING.join(" or ")} or absent`); continue; }
      if (basis && !UNIT_IN_QUOTE["carbon-accounting"][basis].test(quote)) { reject(`the quote does not write ${basis}`); continue; }
      if (value < 0 && !SCOPES.has(member)) { reject("a negative value is not allowed for this member"); continue; }
      if (member === "renewable-energy" && (value < 0 || value > 100)) { reject("renewable-energy must be between 0 and 100"); continue; }
      if (SCALE_IN_QUOTE.test(quote)) { reject("the quote states the figure in thousands, millions or kt/Mt: convert it by hand, this tool does not"); continue; }

      const tokens = numberTokens(quote);
      const hits = tokens.filter((t) => t.values.some((v) => v === value));
      if (hits.length === 0) {
        const signFlip = tokens.some((t) => t.values.some((v) => v === -value));
        reject(signFlip ? "the quote shows the opposite sign" : "the number does not appear in its own quote");
        continue;
      }
      const usable = hits.filter((t) => !t.afterScope && !(t.yearLike && tokens.length > 1));
      if (usable.length === 0) { reject("the number matches only a year or a scope label in the quote"); continue; }
      checks.push("number appears in the quote");
      if (usable.some((t) => t.ambiguous)) {
        flags.push(`"${usable[0].text}" reads as either a thousands group or a decimal — CHECK BY HAND which the report means`);
      }
      // A scale stated in a table header above the quoted row.
      const at = haystack.indexOf(quote);
      if (SCALE_NEARBY.test(haystack.slice(Math.max(0, at - 1000), at))) {
        flags.push("the text just before this quote mentions thousands or kt/Mt — CHECK BY HAND whether a table header scales this figure");
      }
      if (member === "renewable-energy" && /electricit/i.test(quote)) {
        flags.push("the quote may give a share of electricity, while renewable-energy is a share of all energy — CHECK BY HAND");
      }
      candidates.push({ ...f, member, value, quote, page, checks, flags, accounting: basis });
    } else if (ENUMS[member]) {
      // The unit of earlier revisions is read as the metric tonne it meant; the quote must still write it.
      const unit = member === "carbon-unit" && f.value === LEGACY_CARBON_UNIT ? "tCO2e" : f.value;
      if (!ENUMS[member].includes(unit)) { reject(`not one of ${ENUMS[member].join(", ")}`); continue; }
      if (!UNIT_IN_QUOTE[member][unit].test(quote) || (unit === "tCO2e" && NOT_TONNES.test(quote))) {
        reject(`the quote does not write ${unit}`);
        continue;
      }
      checks.push(`${unit} is written in the quote`);
      if (unit !== f.value) checks.push(`${f.value} is the spelling of earlier revisions for ${unit}`);
      candidates.push({ ...f, member, value: unit, quote, page, checks, flags });
    } else if (member === "period") {
      const value = String(f.value);
      let period;
      try {
        period = periodFromLabel(value, offset);
      } catch (e) {
        if (!(e instanceof PeriodError)) throw e;
        reject(e.message);
        continue;
      }
      if (!labelYears(value).some((y) => quote.includes(y))) { reject("the year does not appear in its own quote"); continue; }
      if (!hasEnded(period, now)) { reject("the period has not ended: a year in the future or in progress is a target, not a reported figure"); continue; }
      if (isYearLabel(value) && !wholePeriod && PARTIAL_YEAR.test(quote)) {
        reject("the quote speaks of part of a year (a quarter, a half-year, year to date): the period would claim the whole year; use a YYYY-MM-DD/YYYY-MM-DD range, or --period-is-whole if the report covers all of it");
        continue;
      }
      if (/\b(baseline|target|goal|aim|by 20\d\d|commit)/i.test(quote)) {
        flags.push("the quote speaks of a baseline or a target — CHECK BY HAND that this is the reporting period");
      }
      if (value.includes("/")) flags.push("the dates of this range are the model's reading of the report — CHECK BY HAND the first and last day");
      checks.push("real calendar period, already ended", "year appears in the quote");
      candidates.push({ ...f, member, value, period, quote, page, checks, flags });
    }
  }

  // One member, one value; different values for one member are left to the person.
  const accepted = [];
  const byMember = new Map();
  const tagged = new Set(candidates.filter((c) => c.accounting).map((c) => c.member));
  for (const c of candidates) {
    if (tagged.has(c.member) && !c.accounting) {
      rejected.push({ member: c.member, value: c.value, quote: c.quote,
        reason: "the report gives this member by accounting basis; this figure does not say which one" });
      continue;
    }
    const key = `${c.member}|${c.accounting ?? ""}`;
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(c);
  }
  for (const list of byMember.values()) {
    const { member } = list[0];
    const values = [...new Set(list.map((c) => String(c.value)))];
    if (values.length === 1) {
      const keep = list[0];
      // Keep every distinct supporting quote, so the evidence shows all of them.
      keep.alsoQuoted = [...new Set(list.slice(1).map((c) => c.quote))].filter((q) => q !== keep.quote);
      accepted.push(keep);
    } else {
      for (const c of list) {
        rejected.push({ member, value: c.value, quote: c.quote,
          reason: `the report gives ${values.length} different values for this member (${values.join(", ")}): choose by hand` });
      }
    }
  }

  const period = accepted.find((f) => f.member === "period");
  if (period) {
    const years = labelYears(period.value);
    for (const f of accepted) {
      if (NUMERIC.has(f.member) && !years.some((y) => f.quote.includes(y))) {
        f.flags.push(`the quote does not name ${years.join(" or ")}: confirm it is that period's figure — CHECK BY HAND`);
      }
    }
  }
  return { accepted: crossCheck(accepted), rejected };
}

/** The accounting basis a figure is tagged with: undefined for none, null for a tag outside the set. */
function accountingOf(figure, member) {
  const tag = figure.accounting;
  if (!BY_BASIS.has(member) || tag === undefined || tag === null || tag === "" || tag === "not-stated") return undefined;
  return CARBON_ACCOUNTING.includes(tag) ? tag : null;
}

/** The figures that belong in the object of one accounting basis (all of them when there is none). */
const figuresOf = (accepted, basis) => accepted.filter((f) => !f.accounting || f.accounting === basis);

/** The distinct accounting bases the figures are tagged with, in the order of the draft. */
const basesOf = (accepted) => CARBON_ACCOUNTING.filter((b) => accepted.some((f) => f.accounting === b));

function crossCheck(accepted) {
  const bases = basesOf(accepted);
  for (const basis of bases.length ? bases : [undefined]) crossCheckOne(figuresOf(accepted, basis));
  return accepted;
}

function crossCheckOne(accepted) {
  const by = Object.fromEntries(accepted.map((f) => [f.member, f]));
  const scopes = ["scope-1", "scope-2", "scope-3"].filter((s) => by[s]);
  if (by["carbon-footprint"] && scopes.length === 3) {
    const sum = scopes.reduce((t, s) => t + by[s].value, 0);
    const total = by["carbon-footprint"].value;
    const ok = Math.abs(sum - total) <= Math.max(Math.abs(total) * 0.01, 0.5);
    for (const s of [...scopes, "carbon-footprint"]) {
      if (ok) by[s].checks.push("scopes sum to the total");
      else by[s].flags.push(`scopes sum to ${sum}, the total says ${total} — CHECK BY HAND`);
    }
  }
  if (by["carbon-intensity-gCO2e-per-kWh"] && by["energy-consumption"] && by["scope-2"] && by["energy-unit"] && by["carbon-unit"]) {
    const toKwh = { Wh: 1e-3, kWh: 1, MWh: 1e3, GWh: 1e6 }[by["energy-unit"].value];
    const toG = { gCO2e: 1, kgCO2e: 1e3, tCO2e: 1e6 }[by["carbon-unit"].value];
    const implied = (by["scope-2"].value * toG) / (by["energy-consumption"].value * toKwh);
    by["carbon-intensity-gCO2e-per-kWh"].flags.push(
      `scope 2 over energy gives ${implied.toFixed(1)}; that is the intensity only if the energy figure is electricity alone`,
    );
  }
}

/** Refuse a model whose price is unknown, negative (a router) or above the budget. */
export function assessPrice(modelEntry, maxCostUsd, { promptTokens, completionTokens, calls = 1 }) {
  if (!modelEntry) throw new Error("the model is not in OpenRouter's model list; refusing to call an unpriced model");
  const read = (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : typeof v === "number" ? v : NaN);
  const pIn = read(modelEntry.pricing?.prompt);
  const pOut = read(modelEntry.pricing?.completion);
  const pReq = modelEntry.pricing?.request === undefined ? 0 : read(modelEntry.pricing.request);
  if (![pIn, pOut, pReq].every((p) => Number.isFinite(p) && p >= 0)) {
    throw new Error(`${modelEntry.id} has no fixed price (a router or an unpriced model); name a concrete model`);
  }
  const estimate = pIn * promptTokens + pOut * completionTokens + pReq * calls;
  if (estimate > maxCostUsd) {
    throw new Error(`${modelEntry.id} would cost about $${estimate.toFixed(4)} for this report, above --max-cost-usd $${maxCostUsd}`);
  }
  return { estimateUsd: Number(estimate.toFixed(6)), free: pIn === 0 && pOut === 0 && pReq === 0, pricePerToken: { prompt: pIn, completion: pOut } };
}

/** A stable fingerprint of what a reviewer approves: the accepted figures and their evidence. */
export function figuresFingerprint(accepted) {
  return JSON.stringify(
    accepted.map((f) => [f.member, f.value, f.quote, f.page ?? null, f.accounting ?? null, f.period ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

const CLAIMS_REVIEW = /\b(checked|reviewed?|audited?|verified|assured|approved)\b/i;

/**
 * Assemble the surviving members into a declaration. Without `approval` the
 * result is a CANDIDATE and says so, whatever `opts.provider` contains; with
 * one, the reviewer's sentence is always appended. `opts.provider` names the
 * publisher and may not itself claim a review.
 */
export function buildDeclaration({ accepted, opts, meta, approval, now = new Date() }) {
  const problems = new Set();

  const method = opts.measurementMethod ?? "third-party-modeled";
  if (!ALLOWED_METHODS.includes(method)) problems.add(`measurement-method "${method}" is not one this tool writes (${ALLOWED_METHODS.join(", ")})`);
  if (opts.targetType && !TARGET_TYPES.includes(opts.targetType)) problems.add(`target-type "${opts.targetType}" is not one of ${TARGET_TYPES.join(", ")}`);
  if (opts.provider && CLAIMS_REVIEW.test(opts.provider)) {
    problems.add("--provider may name the publisher but may not claim a review: that sentence is added only by --approve --reviewer");
  }
  const extractedBy = meta?.replayed ? "a recorded model reply" : `the model ${meta?.model ?? "unknown"}`;
  const who = opts.provider ? `${opts.provider}. ` : "";
  const base =
    `${who}${opts.target}: figures transcribed from the source document named in methodology-uri. ` +
    `Machine-assisted transcription by ${extractedBy} with report-to-declaration; every figure matched ` +
    `to a verbatim quote in the source. Nothing is estimated or converted.`;
  const provider = approval
    ? `${base} Each figure checked by ${approval.reviewer} on ${approval.date}.`
    : `CANDIDATE, NOT REVIEWED — must not be published. ${base}`;

  // Figures that differ only in their accounting basis are separate objects for the same target and period.
  const tagged = basesOf(accepted);
  const stated = accepted.find((f) => f.member === "carbon-accounting")?.value;
  if (stated && tagged.length && (tagged.length > 1 || tagged[0] !== stated)) {
    problems.add(`carbon-accounting says ${stated}, but the carbon figures are given for ${tagged.join(" and ")}`);
  }
  const objects = (tagged.length ? tagged : [undefined]).map((basis) => {
    return objectFor(figuresOf(accepted, basis), { opts, method, provider, now, basis, problems });
  });
  const document = objects.length === 1 ? objects[0] : objects;
  return { document, conformant: problems.size === 0, problems: [...problems] };
}

const METRICS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "renewable-energy", "carbon-intensity-gCO2e-per-kWh"];

function objectFor(figures, { opts, method, provider, now, basis, problems }) {
  const by = Object.fromEntries(figures.map((f) => [f.member, f]));
  const value = (member) => by[member]?.value;

  const object = {
    updated: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    capabilities: "basic",
    provider,
    "measurement-method": method,
    "methodology-uri": opts.methodologyUri,
  };
  if (by.period) object.period = by.period.period;
  object.target = opts.target;
  if (opts.targetType) object["target-type"] = opts.targetType;
  for (const m of ["energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit", "carbon-accounting",
                   "scope-1", "scope-2", "scope-3", "renewable-energy", "carbon-intensity-gCO2e-per-kWh"]) {
    if (value(m) !== undefined) object[m] = value(m);
  }
  if (basis) object["carbon-accounting"] = basis;

  if (!object.period) problems.add("no reporting period was found in the source");
  if (object["energy-unit"] !== undefined && object["energy-consumption"] === undefined) delete object["energy-unit"];
  if (object["carbon-unit"] !== undefined && !["carbon-footprint", "scope-1", "scope-2", "scope-3"].some((m) => object[m] !== undefined)) {
    delete object["carbon-unit"];
  }
  if (!METRICS.some((m) => object[m] !== undefined)) {
    problems.add("no metric survived verification, and this tool adds no evidence link of its own");
  }
  if (["carbon-footprint", "scope-1", "scope-2", "scope-3"].some((m) => object[m] !== undefined) && object["carbon-unit"] === undefined) {
    problems.add("a carbon figure was found but no unit was quoted — the format would read it as gCO2e, which would be a guess");
  }
  if (object["energy-consumption"] !== undefined && object["energy-unit"] === undefined) {
    problems.add("an energy figure was found but no unit was quoted — the format would read it as kWh, which would be a guess");
  }
  return object;
}
