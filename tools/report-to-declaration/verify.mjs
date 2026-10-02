/**
 * The part that does not trust the model.
 *
 * `verifyFigures` keeps a proposed figure only when the quote behind it exists
 * in the source text and the number exists inside that quote. `buildDeclaration`
 * then assembles the members that survived into a declaration object and checks
 * the rules the format states, so a run cannot produce a document that would be
 * rejected by a consumer.
 */

const ENUMS = {
  "energy-unit": ["Wh", "kWh", "MWh", "GWh"],
  "carbon-unit": ["gCO2e", "kgCO2e", "mtCO2e"],
  "carbon-accounting": ["location-based", "market-based"],
};
const NUMERIC = new Set([
  "energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
  "renewable-energy", "carbon-intensity-gCO2e-per-kWh",
]);
const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** Whitespace in PDFs is arbitrary; compare with runs of space collapsed. */
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** The ways a number can be written in a report: 1234.5, 1,234.5, 1 234,5. */
function numberVariants(n) {
  const plain = String(n);
  const fixed = Number.isInteger(n) ? plain : plain.replace(/0+$/, "");
  const grouped = Number(n).toLocaleString("en-US");
  const spaced = grouped.replace(/,/g, " ");
  const comma = grouped.replace(/,/g, ".").replace(/\.(\d+)$/, ",$1");
  return [...new Set([plain, fixed, grouped, spaced, comma, plain.replace(".", ",")])];
}

export function verifyFigures(figures, sourceText) {
  const haystack = squash(sourceText);
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const f of figures) {
    const member = f?.member;
    const reject = (reason) => rejected.push({ member: member ?? "(none)", value: f?.value, quote: f?.quote, reason });

    if (typeof member !== "string") { reject("no member name"); continue; }
    if (seen.has(member)) { reject("the model returned this member twice"); continue; }
    if (typeof f.quote !== "string" || squash(f.quote).length < 8) { reject("no usable quote"); continue; }

    const quote = squash(f.quote);
    if (!haystack.includes(quote)) { reject("the quote is not in the source text"); continue; }

    const checks = ["quote found in source"];

    if (NUMERIC.has(member)) {
      const value = typeof f.value === "number" ? f.value : Number(String(f.value).replace(/[\s,]/g, ""));
      if (!Number.isFinite(value)) { reject("value is not a finite number"); continue; }
      if (value < 0 && !/^scope-[123]$/.test(member)) { reject("a negative value is not allowed for this member"); continue; }
      if (member === "renewable-energy" && (value < 0 || value > 100)) { reject("renewable-energy must be between 0 and 100"); continue; }
      if (!numberVariants(value).some((v) => quote.includes(v))) { reject("the number does not appear in its own quote"); continue; }
      checks.push("number appears in the quote");
      accepted.push({ ...f, member, value, quote, checks });
    } else if (ENUMS[member]) {
      if (!ENUMS[member].includes(f.value)) { reject(`not one of ${ENUMS[member].join(", ")}`); continue; }
      checks.push("value is one the format defines");
      accepted.push({ ...f, member, value: f.value, quote, checks });
    } else if (member === "reporting-period") {
      const value = String(f.value);
      if (!PERIOD_RE.test(value)) { reject("not a calendar YYYY, YYYY-MM or YYYY-MM-DD period"); continue; }
      if (!quote.includes(value.slice(0, 4))) { reject("the year does not appear in its own quote"); continue; }
      checks.push("calendar period", "year appears in the quote");
      accepted.push({ ...f, member, value, quote, checks });
    } else if (member === "measurement-method") {
      checks.push("free text, carried as published");
      accepted.push({ ...f, member, value: String(f.value), quote, checks });
    } else {
      reject("not a member this tool extracts");
      continue;
    }
    seen.add(member);
  }

  return { accepted: crossCheck(accepted), rejected };
}

/** Relations between members that can be checked arithmetically. */
function crossCheck(accepted) {
  const by = Object.fromEntries(accepted.map((f) => [f.member, f]));
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  const scopes = ["scope-1", "scope-2", "scope-3"].filter((s) => by[s]);
  if (by["carbon-footprint"] && scopes.length === 3) {
    const sum = scopes.reduce((t, s) => t + by[s].value, 0);
    const total = by["carbon-footprint"].value;
    const ok = near(sum, total, Math.max(Math.abs(total) * 0.01, 0.5));
    for (const s of [...scopes, "carbon-footprint"]) {
      by[s].checks.push(ok ? "scopes sum to the total" : `scopes sum to ${sum}, total says ${total} — CHECK BY HAND`);
    }
  }
  if (by["carbon-intensity-gCO2e-per-kWh"] && by["energy-consumption"] && by["scope-2"] && by["energy-unit"] && by["carbon-unit"]) {
    const toKwh = { Wh: 1e-3, kWh: 1, MWh: 1e3, GWh: 1e6 }[by["energy-unit"].value];
    const toG = { gCO2e: 1, kgCO2e: 1e3, mtCO2e: 1e6 }[by["carbon-unit"].value];
    const implied = (by["scope-2"].value * toG) / (by["energy-consumption"].value * toKwh);
    const stated = by["carbon-intensity-gCO2e-per-kWh"].value;
    const ok = near(implied, stated, Math.max(stated * 0.05, 1));
    by["carbon-intensity-gCO2e-per-kWh"].checks.push(
      ok ? "intensity matches scope 2 over energy" : `scope 2 over energy gives ${implied.toFixed(1)} — CHECK BY HAND`,
    );
  }
  return accepted;
}

/**
 * Assemble the surviving members into a declaration and apply the format's own
 * rules. `conformant` false means the run produced nothing publishable.
 */
export function buildDeclaration({ accepted, opts, meta }) {
  const by = Object.fromEntries(accepted.map((f) => [f.member, f.value]));
  const problems = [];

  const method = by["measurement-method"] ?? "third-party-modeled";
  const extractedBy = meta?.replayed ? "a recorded model reply" : `the model ${meta?.model ?? "unknown"}`;
  const provider = opts.provider
    ?? `${opts.target} figures as published in the source document named in methodology-uri. ` +
       `Read from that document by ${extractedBy} with report-to-declaration, every figure checked ` +
       `against a verbatim quote and reviewed by the operator before publication. Nothing is estimated or converted.`;

  const document = {
    updated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
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

  // The format's own rules, applied here so a bad candidate never leaves the tool.
  if (!document["reporting-period"]) problems.push("no reporting period was found in the source");
  if (document["energy-unit"] !== undefined && document["energy-consumption"] === undefined) {
    delete document["energy-unit"];
  }
  const hasMetric = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3",
    "renewable-energy", "carbon-intensity-gCO2e-per-kWh"].some((m) => document[m] !== undefined);
  if (!hasMetric) problems.push("no metric survived verification, and this tool adds no evidence link of its own");
  if (document["carbon-footprint"] !== undefined && document["carbon-unit"] === undefined) {
    problems.push("a carbon figure was found but no unit was quoted — the format would read it as gCO2e, which would be a guess");
  }
  if (document["energy-consumption"] !== undefined && document["energy-unit"] === undefined) {
    problems.push("an energy figure was found but no unit was quoted — the format would read it as kWh, which would be a guess");
  }

  return { document, conformant: problems.length === 0, problems };
}
