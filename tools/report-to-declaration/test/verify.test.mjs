/**
 * The verifier decides what a model is allowed to put into a document, and
 * buildDeclaration decides what the document may claim about its own review.
 * Offline and deterministic: a fixed clock, recorded fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assessPrice, buildDeclaration, figuresFingerprint, locatePage, squash, verifyFigures } from "../verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "fixtures", "demo-report.txt"), "utf8");
const recorded = JSON.parse(readFileSync(join(here, "..", "fixtures", "demo-model-reply.json"), "utf8"));
const NOW = new Date("2026-10-02T12:00:00Z");
const run = () => verifyFigures(recorded.reply.figures, source, { now: NOW });
const OPTS = { target: "Example Hosting Ltd", methodologyUri: "https://hosting.example/reports/2025.pdf", targetType: "organization" };

test("the demo: what survives, and why the rest does not", () => {
  const { accepted, rejected } = run();
  assert.deepEqual(accepted.map((f) => f.member).sort(), [
    "carbon-accounting", "carbon-footprint", "carbon-unit", "energy-unit", "period",
    "renewable-energy", "scope-1", "scope-2", "scope-3",
  ]);
  const reasons = Object.fromEntries(rejected.map((r) => [`${r.member}:${r.value}`, r.reason]));
  assert.match(reasons["carbon-intensity-gCO2e-per-kWh:250"], /does not appear in its own quote/);
  assert.match(reasons["measurement-method:hardware-metered"], /not a member this tool extracts/);
  // The prior year's 11,900 MWh and the reporting year's 12,480 MWh: the tool does not choose.
  assert.match(reasons["energy-consumption:12480"], /2 different values/);
  assert.match(reasons["energy-consumption:11900"], /2 different values/);
});

test("a fabricated quote is refused however plausible it reads", () => {
  const { accepted, rejected } = verifyFigures(
    [{ member: "carbon-footprint", value: 999, quote: "Total emissions in 2025 were 999 tCO2e." }], source, { now: NOW });
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "the quote is not in the source text");
});

test("a real quote with a number that is not in it is refused, including a near miss", () => {
  for (const value of [121, 12, 20]) {
    const { accepted } = verifyFigures([{ member: "scope-1", value, quote: "comprising Scope 1 of 120 tCO2e" }], source, { now: NOW });
    assert.equal(accepted.length, 0, `scope-1 ${value} must not match "120"`);
  }
});

test("numbers are matched however the report groups them", () => {
  const text = "Energy 12,480 MWh. Also 1 234,5 kWh in Brussels and 1.234,5 kWh in Berlin.";
  for (const [value, quote] of [[12480, "Energy 12,480 MWh."], [1234.5, "Also 1 234,5 kWh in Brussels"], [1234.5, "1.234,5 kWh in Berlin."]]) {
    const { accepted } = verifyFigures([{ member: "energy-consumption", value, quote }], text, { now: NOW });
    assert.equal(accepted.length, 1, quote);
  }
});

test("invisible characters inside a number do not defeat the match", () => {
  const text = "Emissions were 3 120 tCO2e in 2025, soft­hyphen here.";
  assert.equal(squash(text).includes("3 120"), true);
  const { accepted } = verifyFigures([{ member: "carbon-footprint", value: 3120, quote: "Emissions were 3 120 tCO2e in 2025" }], text, { now: NOW });
  assert.equal(accepted.length, 1);
});

test("a target year or a period still in progress is not a reporting period", () => {
  const text = "We aim to reach net zero by 2050. Our 2026 report will follow.";
  for (const [value, quote] of [["2050", "We aim to reach net zero by 2050."], ["2026", "Our 2026 report will follow."]]) {
    const { accepted, rejected } = verifyFigures([{ member: "period", value, quote }], text, { now: NOW });
    assert.equal(accepted.length, 0, value);
    assert.match(rejected[0].reason, /has not ended/);
  }
});

test("a figure stated in thousands is refused, not multiplied", () => {
  const text = "Gross emissions were 30.31 thousand tCO2e in 2025.";
  const { accepted, rejected } = verifyFigures(
    [{ member: "carbon-footprint", value: 30310, quote: "Gross emissions were 30.31 thousand tCO2e in 2025." }], text, { now: NOW });
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /thousands, millions/);
});

test("a negative scope is accepted only where the quote shows the sign", () => {
  const text = "Scope 1 was (180) tCO2e after removals. Scope 3 was 700 tCO2e.";
  assert.equal(verifyFigures([{ member: "scope-1", value: -180, quote: "Scope 1 was (180) tCO2e after removals." }], text, { now: NOW }).accepted.length, 1);
  assert.equal(verifyFigures([{ member: "scope-3", value: -700, quote: "Scope 3 was 700 tCO2e." }], text, { now: NOW }).accepted.length, 0);
});

test("the page is located by the tool, from the form feeds pdftotext writes", () => {
  const text = "Cover page\fEnergy\nIn 2025 we used 12,480 MWh.\fAppendix";
  assert.equal(locatePage(text, "In 2025 we used 12,480 MWh."), 2);
  const { accepted } = verifyFigures([{ member: "energy-consumption", value: 12480, quote: "In 2025 we used 12,480 MWh.", page: 9 }], text, { now: NOW });
  assert.equal(accepted[0].page, 2); // the model said 9; the tool says 2
});

test("a share of electricity is flagged before it is published as a share of all energy", () => {
  const { accepted } = run();
  const renewable = accepted.find((f) => f.member === "renewable-energy");
  assert.ok(renewable.flags.some((f) => /share of electricity/.test(f)));
});

test("scopes that do not sum to the total are flagged rather than dropped", () => {
  const text = "In 2025 emissions were 1,000 tCO2e: Scope 1 of 100 tCO2e, Scope 2 of 200 tCO2e and Scope 3 of 300 tCO2e.";
  const { accepted } = verifyFigures([
    { member: "carbon-footprint", value: 1000, quote: "In 2025 emissions were 1,000 tCO2e" },
    { member: "scope-1", value: 100, quote: "Scope 1 of 100 tCO2e" },
    { member: "scope-2", value: 200, quote: "Scope 2 of 200 tCO2e" },
    { member: "scope-3", value: 300, quote: "Scope 3 of 300 tCO2e" },
  ], text, { now: NOW });
  assert.equal(accepted.length, 4);
  assert.ok(accepted.some((f) => f.flags.some((c) => c.includes("CHECK BY HAND"))));
});

test("an unapproved candidate says so; only a named reviewer turns it into a checked document", () => {
  const { accepted } = run();
  const candidate = buildDeclaration({ accepted, opts: OPTS, meta: { replayed: true }, now: NOW });
  assert.equal(candidate.conformant, true);
  assert.match(candidate.document.provider, /^CANDIDATE, NOT REVIEWED — must not be published\./);
  assert.doesNotMatch(candidate.document.provider, /checked by/);

  const approved = buildDeclaration({ accepted, opts: OPTS, meta: { replayed: true }, approval: { reviewer: "A. Reviewer", date: "2026-10-02" }, now: NOW });
  assert.match(approved.document.provider, /checked by A\. Reviewer on 2026-10-02/);
  assert.doesNotMatch(approved.document.provider, /NOT REVIEWED/);
  assert.equal(approved.document["measurement-method"], "third-party-modeled");
});

test("the tool never writes hardware-metered", () => {
  const { accepted } = run();
  const out = buildDeclaration({ accepted, opts: { ...OPTS, measurementMethod: "hardware-metered" }, meta: {}, now: NOW });
  assert.equal(out.conformant, false);
  assert.match(out.problems.join(" "), /not one this tool writes/);
});

test("a missing unit stops the run, and so does a run with no metric", () => {
  const { accepted } = run();
  const noUnit = buildDeclaration({ accepted: accepted.filter((f) => f.member !== "carbon-unit"), opts: OPTS, meta: {}, now: NOW });
  assert.equal(noUnit.conformant, false);
  assert.match(noUnit.problems.join(" "), /no unit was quoted/);
  const nothing = buildDeclaration({ accepted: accepted.filter((f) => f.member === "period"), opts: OPTS, meta: {}, now: NOW });
  assert.equal(nothing.conformant, false);
  assert.match(nothing.problems.join(" "), /no metric survived/);
});

test("the price check fails closed", () => {
  const tokens = { promptTokens: 40_000, completionTokens: 4_000 };
  assert.throws(() => assessPrice(undefined, 0.1, tokens), /not in OpenRouter's model list/);
  assert.throws(() => assessPrice({ id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } }, 0.1, tokens), /no fixed price/);
  assert.throws(() => assessPrice({ id: "x/costly", pricing: { prompt: "0.00001", completion: "0.00003" } }, 0.1, tokens), /above --max-cost-usd/);
  assert.deepEqual(assessPrice({ id: "x/free", pricing: { prompt: "0", completion: "0" } }, 0.1, tokens), { estimateUsd: 0, free: true, pricePerToken: { prompt: 0, completion: 0 } });
});

// ---- the -10 form: period object, closed tokens, accounting twins ----

const one = (figure, text, options = {}) => verifyFigures([figure], text, { now: NOW, ...options });
const YEAR_QUOTE = "In 2025 Example Hosting Ltd consumed 12,480 MWh of electricity across its data centres.";

test("the period member carries the label the report states and the date-times that will be written", () => {
  const { accepted } = run();
  const period = accepted.find((f) => f.member === "period");
  assert.equal(period.value, "2025");
  assert.deepEqual(period.period, { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  const doc = buildDeclaration({ accepted, opts: OPTS, meta: { replayed: true }, now: NOW }).document;
  assert.deepEqual(doc.period, period.period);
  assert.equal("reporting-period" in doc, false);
});

test("the stated offset is on both bounds", () => {
  const { accepted } = one({ member: "period", value: "2025", quote: YEAR_QUOTE }, YEAR_QUOTE, { offset: "+02:00" });
  assert.deepEqual(accepted[0].period, { start: "2025-01-01T00:00:00+02:00", end: "2026-01-01T00:00:00+02:00" });
});

test("a recorded reply that says reporting-period still replays, as period", () => {
  const { accepted } = one({ member: "reporting-period", value: "2025", quote: YEAR_QUOTE }, YEAR_QUOTE);
  assert.equal(accepted[0].member, "period");
});

test("a fiscal year from inclusive dates ends at the first instant of the next day, and is flagged for the dates", () => {
  const text = "Our fiscal year ended 31 March 2026 and began on 1 April 2025.";
  const { accepted } = one({ member: "period", value: "2025-04-01/2026-03-31", quote: text }, text);
  assert.equal(accepted[0].period.end, "2026-04-01T00:00:00Z");
  assert.ok(accepted[0].flags.some((f) => /first and last day/.test(f)));
});

test("error: a period that is not a real calendar unit is refused with the reason", () => {
  const text = "Reporting year 2025-02-30 is shown here.";
  const { accepted, rejected } = one({ member: "period", value: "2025-02-30", quote: text }, text);
  assert.equal(accepted.length, 0);
  assert.match(rejected[0].reason, /not a real calendar date/);
});

test("error: a period whose year is not in its quote, or has not ended in the stated offset, is refused", () => {
  assert.match(one({ member: "period", value: "2024", quote: YEAR_QUOTE }, YEAR_QUOTE).rejected[0].reason, /year does not appear/);
  const text = "The figures cover the whole of 2026.";
  // 2026 ends at 2026-12-31T22:00:00Z in +02:00, still ahead of the fixed clock.
  assert.match(one({ member: "period", value: "2026", quote: text }, text, { offset: "+02:00" }).rejected[0].reason, /has not ended/);
});

test("edge: the period is complete from the instant its end passes, in the stated offset", () => {
  const text = "The report covers 2025.";
  const figure = { member: "period", value: "2025", quote: text };
  assert.equal(one(figure, text, { now: new Date("2025-12-31T21:59:59Z"), offset: "+02:00" }).accepted.length, 0);
  assert.equal(one(figure, text, { now: new Date("2025-12-31T22:00:00Z"), offset: "+02:00" }).accepted.length, 1);
});

test("error: a quarter or half-year is not a calendar year unless the operator says it is", () => {
  for (const quote of ["Emissions for the first half of 2025 were 40 tCO2e.", "Results for Q3 2025 are below.", "Year to date 2025 figures follow.", "For the nine months ended 30 September 2025."]) {
    const refused = one({ member: "period", value: "2025", quote }, quote);
    assert.equal(refused.accepted.length, 0, quote);
    assert.match(refused.rejected[0].reason, /part of a year/);
    assert.equal(one({ member: "period", value: "2025", quote }, quote, { wholePeriod: true }).accepted.length, 1, `${quote} confirmed`);
  }
  const whole = "Figures for the twelve months ended 31 December 2025.";
  assert.equal(one({ member: "period", value: "2025", quote: whole }, whole).accepted.length, 1);
  // A month or an inclusive range states its own dates.
  const range = "First half of 2025 (1 January to 30 June 2025).";
  assert.equal(one({ member: "period", value: "2025-01-01/2025-06-30", quote: range }, range).accepted.length, 1);
});

test("the carbon unit is tCO2e; the earlier spelling mtCO2e is read as the same unit and says so", () => {
  const text = "Our gross emissions for 2025 were 3,120 tonnes CO2e.";
  const modern = one({ member: "carbon-unit", value: "tCO2e", quote: text }, text);
  assert.equal(modern.accepted[0].value, "tCO2e");
  const legacy = one({ member: "carbon-unit", value: "mtCO2e", quote: text }, text);
  assert.equal(legacy.accepted[0].value, "tCO2e");
  assert.ok(legacy.accepted[0].checks.some((c) => /earlier revisions/.test(c)));
});

test("error: megatonnes and kilotonnes are not tCO2e, and a unit outside the set is refused with the set", () => {
  const text = "Our emissions were 3.1 MtCO2e in 2025 and 120 ktCO2e elsewhere.";
  assert.match(one({ member: "carbon-unit", value: "tCO2e", quote: text }, text).rejected[0].reason, /does not write tCO2e/);
  assert.match(one({ member: "carbon-unit", value: "MtCO2e", quote: text }, text).rejected[0].reason, /not one of gCO2e, kgCO2e, tCO2e/);
  const energy = "Consumption was 4 TWh in 2025.";
  assert.match(one({ member: "energy-unit", value: "TWh", quote: energy }, energy).rejected[0].reason, /not one of Wh, kWh, MWh, GWh/);
});

const TWINS_TEXT =
  "Location-based emissions for 2025 were 520 tCO2e, with Scope 2 (location-based) of 330 tCO2e. " +
  "Market-based emissions for 2025 were 410 tCO2e, with Scope 2 (market-based) of 220 tCO2e. " +
  "Scope 1 was 90 tCO2e and Scope 3 was 100 tCO2e. In 2025 we consumed 1,800 MWh.";
const TWINS = [
  { member: "period", value: "2025", quote: "Location-based emissions for 2025 were 520 tCO2e" },
  { member: "carbon-footprint", value: 520, accounting: "location-based", quote: "Location-based emissions for 2025 were 520 tCO2e" },
  { member: "carbon-footprint", value: 410, accounting: "market-based", quote: "Market-based emissions for 2025 were 410 tCO2e" },
  { member: "scope-2", value: 330, accounting: "location-based", quote: "Scope 2 (location-based) of 330 tCO2e" },
  { member: "scope-2", value: 220, accounting: "market-based", quote: "Scope 2 (market-based) of 220 tCO2e" },
  { member: "scope-1", value: 90, accounting: "not-stated", quote: "Scope 1 was 90 tCO2e" },
  { member: "scope-3", value: 100, quote: "Scope 3 was 100 tCO2e" },
  { member: "carbon-unit", value: "tCO2e", quote: "Scope 1 was 90 tCO2e" },
];

test("golden: a location-based and a market-based figure are two objects, each with its own totals", () => {
  const { accepted, rejected } = verifyFigures(TWINS, TWINS_TEXT, { now: NOW });
  assert.deepEqual(rejected, []);
  const built = buildDeclaration({ accepted, opts: OPTS, meta: {}, now: NOW });
  assert.equal(built.conformant, true, built.problems.join("; "));
  assert.equal(built.document.length, 2);
  const [location, market] = built.document;
  assert.deepEqual([location["carbon-accounting"], location["carbon-footprint"], location["scope-2"]], ["location-based", 520, 330]);
  assert.deepEqual([market["carbon-accounting"], market["carbon-footprint"], market["scope-2"]], ["market-based", 410, 220]);
  for (const o of built.document) {
    assert.deepEqual([o["scope-1"], o["scope-3"], o["carbon-unit"], o["target"]], [90, 100, "tCO2e", "Example Hosting Ltd"]);
    assert.deepEqual(o.period, { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  }
  // Each object's scopes are checked against that object's total.
  assert.ok(accepted.filter((f) => f.checks.includes("scopes sum to the total")).length >= 4);
});

test("error: the quote of a tagged figure must write its basis, and a tag outside the set is refused", () => {
  const wrongBasis = one({ member: "carbon-footprint", value: 410, accounting: "location-based", quote: "Market-based emissions for 2025 were 410 tCO2e" }, TWINS_TEXT);
  assert.match(wrongBasis.rejected[0].reason, /does not write location-based/);
  const badTag = one({ member: "carbon-footprint", value: 410, accounting: "net", quote: "Market-based emissions for 2025 were 410 tCO2e" }, TWINS_TEXT);
  assert.match(badTag.rejected[0].reason, /location-based or market-based or absent/);
});

test("error: when the report gives a member by basis, a figure that does not say which is refused", () => {
  const figures = TWINS.filter((f) => f.member !== "carbon-unit").concat({ member: "scope-2", value: 330, quote: "Scope 2 (location-based) of 330 tCO2e" });
  const { rejected } = verifyFigures(figures, TWINS_TEXT, { now: NOW });
  assert.match(rejected.find((r) => r.member === "scope-2").reason, /does not say which one/);
});

test("error: one basis stated twice with different values is not chosen between", () => {
  const text = "Market-based emissions for 2025 were 410 tCO2e. Market-based emissions for 2024 were 400 tCO2e.";
  const figures = [
    { member: "carbon-footprint", value: 410, accounting: "market-based", quote: "Market-based emissions for 2025 were 410 tCO2e" },
    { member: "carbon-footprint", value: 400, accounting: "market-based", quote: "Market-based emissions for 2024 were 400 tCO2e" },
  ];
  const { accepted, rejected } = verifyFigures(figures, text, { now: NOW });
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 2);
});

test("error: a plain carbon-accounting that contradicts the tagged figures stops the run", () => {
  const { accepted } = verifyFigures(TWINS.concat({ member: "carbon-accounting", value: "market-based", quote: "Market-based emissions for 2025 were 410 tCO2e" }), TWINS_TEXT, { now: NOW });
  const built = buildDeclaration({ accepted, opts: OPTS, meta: {}, now: NOW });
  assert.equal(built.conformant, false);
  assert.match(built.problems.join(" "), /carbon-accounting says market-based/);
});

test("the fingerprint a reviewer approves changes with the offset and the basis", () => {
  const at = (offset) => figuresFingerprint(one({ member: "period", value: "2025", quote: YEAR_QUOTE }, YEAR_QUOTE, { offset }).accepted);
  assert.notEqual(at("Z"), at("+02:00"));
  const tagged = (accounting) => figuresFingerprint(one({ member: "carbon-footprint", value: 410, accounting, quote: "Market-based emissions for 2025 were 410 tCO2e" }, TWINS_TEXT).accepted);
  assert.notEqual(tagged("market-based"), tagged("not-stated"));
});

test("a target-type outside the nine tokens stops the run; facility is one of them", () => {
  const { accepted } = run();
  const bad = buildDeclaration({ accepted, opts: { ...OPTS, targetType: "company" }, meta: {}, now: NOW });
  assert.equal(bad.conformant, false);
  assert.match(bad.problems.join(" "), /target-type "company" is not one of origin, path, organization, facility/);
  assert.equal(buildDeclaration({ accepted, opts: { ...OPTS, targetType: "facility" }, meta: {}, now: NOW }).conformant, true);
});

test("each of the three methods is written as given; the most direct token is not offered", () => {
  const { accepted } = run();
  for (const measurementMethod of ["hardware-estimated", "cloud-billing", "third-party-modeled"]) {
    assert.equal(buildDeclaration({ accepted, opts: { ...OPTS, measurementMethod }, meta: {}, now: NOW }).document["measurement-method"], measurementMethod);
  }
  assert.equal(buildDeclaration({ accepted, opts: { ...OPTS, measurementMethod: "metered" }, meta: {}, now: NOW }).conformant, false);
});

test("no period found, or an empty source, gives no declaration", () => {
  const { accepted } = run();
  const noPeriod = buildDeclaration({ accepted: accepted.filter((f) => f.member !== "period"), opts: OPTS, meta: {}, now: NOW });
  assert.equal(noPeriod.conformant, false);
  assert.match(noPeriod.problems.join(" "), /no reporting period/);
  const empty = buildDeclaration({ accepted: [], opts: OPTS, meta: {}, now: NOW });
  assert.equal(empty.conformant, false);
  assert.equal(empty.problems.length, 2);
});

test("a carbon unit whose figure was refused is not left behind on its own", () => {
  const text = "In 2025 the period ran from 1 January to 31 December. Emissions were 3.2 mtCO2e in total.";
  const { accepted } = verifyFigures([
    { member: "period", value: "2025", quote: "In 2025 the period ran from 1 January to 31 December" },
    { member: "carbon-footprint", value: 3.2, quote: "Emissions were 3.2 mtCO2e" },
    { member: "carbon-unit", value: "tCO2e", quote: "Emissions were 3.2 mtCO2e" },
  ], text, { now: NOW });
  const out = buildDeclaration({ accepted, opts: OPTS, meta: {}, now: NOW });
  assert.equal(out.document["carbon-footprint"], undefined, "the figure quoted in mtCO2e is refused");
  assert.equal(out.document["carbon-unit"], undefined);
});
