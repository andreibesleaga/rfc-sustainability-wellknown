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
import { assessPrice, buildDeclaration, locatePage, squash, verifyFigures } from "../verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "fixtures", "demo-report.txt"), "utf8");
const recorded = JSON.parse(readFileSync(join(here, "..", "fixtures", "demo-model-reply.json"), "utf8"));
const NOW = new Date("2026-10-02T12:00:00Z");
const run = () => verifyFigures(recorded.reply.figures, source, { now: NOW });
const OPTS = { target: "Example Hosting Ltd", methodologyUri: "https://hosting.example/reports/2025.pdf", targetType: "organization" };

test("the demo: what survives, and why the rest does not", () => {
  const { accepted, rejected } = run();
  assert.deepEqual(accepted.map((f) => f.member).sort(), [
    "carbon-accounting", "carbon-footprint", "carbon-unit", "energy-unit", "renewable-energy",
    "reporting-period", "scope-1", "scope-2", "scope-3",
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
    const { accepted, rejected } = verifyFigures([{ member: "reporting-period", value, quote }], text, { now: NOW });
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
  const nothing = buildDeclaration({ accepted: accepted.filter((f) => f.member === "reporting-period"), opts: OPTS, meta: {}, now: NOW });
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
