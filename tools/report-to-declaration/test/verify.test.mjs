/**
 * The verifier is the part that has to be right: it decides what a model is
 * allowed to put into a published document. Offline and deterministic.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildDeclaration, verifyFigures } from "../verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "fixtures", "demo-report.txt"), "utf8");
const recorded = JSON.parse(readFileSync(join(here, "..", "fixtures", "demo-model-reply.json"), "utf8"));
const run = () => verifyFigures(recorded.reply.figures, source);

test("keeps only figures whose quote is in the source and whose number is in the quote", () => {
  const { accepted, rejected } = run();
  assert.deepEqual(accepted.map((f) => f.member), [
    "reporting-period", "energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit",
    "carbon-accounting", "scope-1", "scope-2", "scope-3", "renewable-energy",
  ]);
  assert.deepEqual(rejected.map((f) => [f.member, f.reason]), [
    ["carbon-intensity-gCO2e-per-kWh", "the number does not appear in its own quote"],
    ["energy-consumption", "the model returned this member twice"],
    ["measurement-method", "the quote is not in the source text"],
  ]);
});

test("a fabricated quote is refused however plausible it reads", () => {
  const { accepted, rejected } = verifyFigures(
    [{ member: "carbon-footprint", value: 999, quote: "Total emissions in 2025 were 999 tCO2e." }],
    source,
  );
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0].reason, "the quote is not in the source text");
});

test("a real quote with a number that is not in it is refused", () => {
  const { accepted } = verifyFigures(
    [{ member: "scope-1", value: 121, quote: "comprising Scope 1 of 120 tCO2e" }],
    source,
  );
  assert.equal(accepted.length, 0);
});

test("numbers are matched however the report groups them", () => {
  const { accepted } = verifyFigures(
    [{ member: "energy-consumption", value: 12480, quote: "consumed 12,480 MWh of electricity" }],
    source,
  );
  assert.equal(accepted.length, 1);
});

test("scopes that do not sum to the total are flagged rather than dropped", () => {
  const text = "Emissions were 1,000 tCO2e: Scope 1 of 100 tCO2e, Scope 2 of 200 tCO2e and Scope 3 of 300 tCO2e.";
  const { accepted } = verifyFigures([
    { member: "carbon-footprint", value: 1000, quote: "Emissions were 1,000 tCO2e" },
    { member: "scope-1", value: 100, quote: "Scope 1 of 100 tCO2e" },
    { member: "scope-2", value: 200, quote: "Scope 2 of 200 tCO2e" },
    { member: "scope-3", value: 300, quote: "Scope 3 of 300 tCO2e" },
  ], text);
  assert.equal(accepted.length, 4);
  assert.ok(accepted.some((f) => f.checks.some((c) => c.includes("CHECK BY HAND"))));
});

test("the enumerated members accept only the values the format defines", () => {
  const text = "Our emissions were 5 tCO2e on a market-based basis.";
  const { accepted, rejected } = verifyFigures([
    { member: "carbon-unit", value: "tCO2e", quote: "Our emissions were 5 tCO2e" },
    { member: "carbon-accounting", value: "market-based", quote: "on a market-based basis" },
  ], text);
  assert.deepEqual(accepted.map((f) => f.member), ["carbon-accounting"]);
  assert.match(rejected[0].reason, /gCO2e, kgCO2e, mtCO2e/);
});

test("the candidate document is conformant, and a missing unit stops the run", () => {
  const { accepted } = run();
  const opts = { target: "Example Hosting Ltd", methodologyUri: "https://hosting.example/reports/2025.pdf", targetType: "organization" };
  const ok = buildDeclaration({ accepted, opts, meta: { model: "recorded", replayed: true } });
  assert.equal(ok.conformant, true);
  assert.equal(ok.document["carbon-unit"], "mtCO2e");
  assert.equal(ok.document["target-type"], "organization");
  assert.match(ok.document.provider, /Nothing is estimated or converted/);

  const noUnit = buildDeclaration({
    accepted: accepted.filter((f) => f.member !== "carbon-unit"),
    opts, meta: { model: "recorded", replayed: true },
  });
  assert.equal(noUnit.conformant, false);
  assert.match(noUnit.problems.join(" "), /no unit was quoted/);
});

test("a run that finds no metric produces nothing publishable", () => {
  const out = buildDeclaration({
    accepted: [{ member: "reporting-period", value: "2025", checks: [] }],
    opts: { target: "X", methodologyUri: "https://example.com/r.pdf" },
    meta: { model: "recorded", replayed: true },
  });
  assert.equal(out.conformant, false);
  assert.match(out.problems.join(" "), /no metric survived/);
});
