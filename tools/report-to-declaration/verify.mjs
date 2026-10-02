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

export const ENUMS = {
  "energy-unit": ["Wh", "kWh", "MWh", "GWh"],
  "carbon-unit": ["gCO2e", "kgCO2e", "mtCO2e"],
  "carbon-accounting": ["location-based", "market-based"],
};
const NUMERIC = new Set([
  "energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
  "renewable-energy", "carbon-intensity-gCO2e-per-kWh",
]);
const SCOPES = new Set(["scope-1", "scope-2", "scope-3"]);
const MAX_QUOTE = 300;

/** The members a model may propose. `measurement-method` is not one: it is the human's to state. */
export const EXTRACTABLE = [
  "reporting-period", "energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit",
  "carbon-accounting", "scope-1", "scope-2", "scope-3", "renewable-energy",
  "carbon-intensity-gCO2e-per-kWh",
];

/** Methods this tool writes. Never `hardware-metered`: a figure read from a report is not a meter reading. */
export const ALLOWED_METHODS = ["third-party-modeled", "hardware-estimated", "cloud-billing"];

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
    mtCO2e: /(\bt\s*CO[2₂]|\btonnes?\b|\bmetric tons?\b|\btons?\s+of\s+CO[2₂]|\bmtCO[2₂])/i,
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

/** End of a calendar period as a UTC instant, or undefined when the date does not exist. */
function periodEnd(p) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(p);
  if (!m) return undefined;
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : undefined, d = m[3] ? Number(m[3]) : undefined;
  if (mo !== undefined && (mo < 1 || mo > 12)) return undefined;
  if (d !== undefined) {
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
    return Date.UTC(y, mo - 1, d + 1);
  }
  if (mo !== undefined) return Date.UTC(y, mo, 1);
  return Date.UTC(y + 1, 0, 1);
}

export function verifyFigures(figures, sourceText, { now = new Date() } = {}) {
  const haystack = squash(sourceText);
  const candidates = [];
  const rejected = [];

  for (const f of Array.isArray(figures) ? figures : []) {
    const member = f?.member;
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
      candidates.push({ ...f, member, value, quote, page, checks, flags });
    } else if (ENUMS[member]) {
      if (!ENUMS[member].includes(f.value)) { reject(`not one of ${ENUMS[member].join(", ")}`); continue; }
      const written = UNIT_IN_QUOTE[member][f.value];
      if (!written.test(quote) || (member === "carbon-unit" && f.value === "mtCO2e" && NOT_TONNES.test(quote))) {
        reject(`the quote does not write ${f.value}`);
        continue;
      }
      checks.push(`${f.value} is written in the quote`);
      candidates.push({ ...f, member, value: f.value, quote, page, checks, flags });
    } else if (member === "reporting-period") {
      const value = String(f.value);
      const end = periodEnd(value);
      if (end === undefined) { reject("not a real calendar YYYY, YYYY-MM or YYYY-MM-DD period"); continue; }
      if (!quote.includes(value.slice(0, 4))) { reject("the year does not appear in its own quote"); continue; }
      if (end > now.getTime()) { reject("the period has not ended: a year in the future or in progress is a target, not a reported figure"); continue; }
      if (/\b(baseline|target|goal|aim|by 20\d\d|commit)/i.test(quote)) {
        flags.push("the quote speaks of a baseline or a target — CHECK BY HAND that this is the reporting period");
      }
      checks.push("real calendar period, already ended", "year appears in the quote");
      candidates.push({ ...f, member, value, quote, page, checks, flags });
    }
  }

  // One member, one value; different values for one member are left to the person.
  const accepted = [];
  const byMember = new Map();
  for (const c of candidates) {
    if (!byMember.has(c.member)) byMember.set(c.member, []);
    byMember.get(c.member).push(c);
  }
  for (const [member, list] of byMember) {
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

  const period = accepted.find((f) => f.member === "reporting-period");
  if (period) {
    const y = String(period.value).slice(0, 4);
    for (const f of accepted) {
      if (NUMERIC.has(f.member) && !f.quote.includes(y)) {
        f.flags.push(`the quote does not name ${y}: confirm it is that year's figure — CHECK BY HAND`);
      }
    }
  }
  return { accepted: crossCheck(accepted), rejected };
}

function crossCheck(accepted) {
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
    const toG = { gCO2e: 1, kgCO2e: 1e3, mtCO2e: 1e6 }[by["carbon-unit"].value];
    const implied = (by["scope-2"].value * toG) / (by["energy-consumption"].value * toKwh);
    by["carbon-intensity-gCO2e-per-kWh"].flags.push(
      `scope 2 over energy gives ${implied.toFixed(1)}; that is the intensity only if the energy figure is electricity alone`,
    );
  }
  return accepted;
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
    accepted.map((f) => [f.member, f.value, f.quote, f.page ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
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
  const by = Object.fromEntries(accepted.map((f) => [f.member, f.value]));
  const problems = [];

  const method = opts.measurementMethod ?? "third-party-modeled";
  if (!ALLOWED_METHODS.includes(method)) problems.push(`measurement-method "${method}" is not one this tool writes (${ALLOWED_METHODS.join(", ")})`);
  if (opts.provider && CLAIMS_REVIEW.test(opts.provider)) {
    problems.push("--provider may name the publisher but may not claim a review: that sentence is added only by --approve --reviewer");
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

  const document = {
    updated: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    capabilities: "basic",
    provider,
    "measurement-method": method,
    "methodology-uri": opts.methodologyUri,
    "reporting-period": by["reporting-period"] ?? "",
    target: opts.target,
  };
  for (const m of ["energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit", "carbon-accounting",
                   "scope-1", "scope-2", "scope-3", "renewable-energy", "carbon-intensity-gCO2e-per-kWh"]) {
    if (by[m] !== undefined) document[m] = by[m];
  }
  if (opts.targetType) document["target-type"] = opts.targetType;

  if (!document["reporting-period"]) problems.push("no reporting period was found in the source");
  if (document["energy-unit"] !== undefined && document["energy-consumption"] === undefined) delete document["energy-unit"];
  const hasMetric = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
    "renewable-energy", "carbon-intensity-gCO2e-per-kWh"].some((m) => document[m] !== undefined);
  if (!hasMetric) problems.push("no metric survived verification, and this tool adds no evidence link of its own");
  if (["carbon-footprint", "scope-1", "scope-2", "scope-3"].some((m) => document[m] !== undefined) && document["carbon-unit"] === undefined) {
    problems.push("a carbon figure was found but no unit was quoted — the format would read it as gCO2e, which would be a guess");
  }
  if (document["energy-consumption"] !== undefined && document["energy-unit"] === undefined) {
    problems.push("an energy figure was found but no unit was quoted — the format would read it as kWh, which would be a guess");
  }
  return { document, conformant: problems.length === 0, problems };
}
