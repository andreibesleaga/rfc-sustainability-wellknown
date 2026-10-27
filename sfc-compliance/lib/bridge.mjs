/** C-SFC-7: the declaration agrees with the ledger read (9.2, D6). */
import { eq, shift, isZero, fromNumber, divRound, mulInt } from "./decimal.mjs";
import { round6, convert, shiftOf, ENERGY_SHIFT, CARBON_SHIFT, locationFigures, deriveFor, headAndCountTokens } from "./derive.mjs";
import { extOf, samePeriodTarget } from "./declaration.mjs";
import { row, PASS, FAIL, NE, list } from "./rows.mjs";
import { l9Gaps } from "./deep-chains.mjs";

const FAIL_PREFIXES = ["D2", "D3", "D4", "D5"];
const num = (x) => fromNumber(x);
/** The published number equals the exact value rounded half to even to 6 decimals. */
const equalsRounded = (declared, exact) => typeof declared === "number" && Number.isFinite(declared) && eq(num(declared), round6(exact));

function operatorTokens(declaredOperators, d) {
  const bad = headAndCountTokens(declaredOperators, d);
  for (const o of d.ops) {
    const x = declaredOperators.find((y) => y?.operator === o.operator);
    if (!x) continue;
    const check = (name, ok) => { if (!ok) bad.push(`${o.operator}:${name}`); };
    check("kwh", equalsRounded(x.kwh, o.kwh));
    check("scope1-kgco2e", equalsRounded(x["scope1-kgco2e"], o.s1));
    check("scope2-kgco2e", equalsRounded(x["scope2-kgco2e"], o.s2));
    check("scope3-kgco2e", equalsRounded(x["scope3-kgco2e"], o.s3));
    check("offsets-kgco2e", equalsRounded(x["offsets-kgco2e"], o.off));
    if (!d.has1x) check("offset-coverage-every-period", x["offset-coverage-every-period"] === o.coverage);
  }
  return bad;
}

/** True when a published figure in `unitShift` does not equal the recomputed exact value (an unknown unit or an incomplete read never matches). */
const figureMismatch = (value, exact, unitShift, incomplete) => unitShift === undefined || incomplete || !equalsRounded(value, convert(exact, unitShift));

/** Mismatch tokens of the energy figure of an object or its pair. */
const energyTokens = (obj, d, token) => (obj["energy-consumption"] !== undefined && figureMismatch(obj["energy-consumption"], d.E, shiftOf(ENERGY_SHIFT, obj["energy-unit"]), d.incompleteEnergy) ? [token] : []);

const intensityMismatch = (value, d) => d.incompleteEnergy || d.incompleteCarbon || isZero(d.E) || !eq(num(value), divRound(mulInt(d.S2, 1000), d.E, 6));

/** The top-level members that are compared, each with the test that says it does not match. */
function topLevelChecks(obj, d, level) {
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  const neutrality = extOf(obj, "carbon-neutrality") ?? {}, topology = extOf(obj, "network-topology") ?? {};
  const carbon = [["scope-1", d.S1], ["scope-2", d.S2], ["scope-3", d.S3], ["carbon-footprint", d.footprint]]
    .map(([name, exact]) => ({ token: name, value: obj[name], mismatch: () => figureMismatch(obj[name], exact, cs, d.incompleteCarbon) }));
  return [
    ...carbon,
    { token: "offsets-retired-tCO2e", value: neutrality["offsets-retired-tCO2e"], mismatch: () => d.incompleteCarbon || !equalsRounded(neutrality["offsets-retired-tCO2e"], shift(d.Off, 3)) },
    { token: "carbon-intensity-gCO2e-per-kWh", value: obj["carbon-intensity-gCO2e-per-kWh"], mismatch: () => intensityMismatch(obj["carbon-intensity-gCO2e-per-kWh"], d) },
    { token: "net-zero-status", value: d.has1x ? undefined : neutrality["net-zero-status"], mismatch: () => neutrality["net-zero-status"] !== d.status },
    { token: "validated-node-count", value: level === "network" ? topology["validated-node-count"] : undefined, mismatch: () => d.incompleteEnergy || topology["validated-node-count"] !== d.nodes },
  ];
}

function topLevelTokens(obj, d, level) {
  const bad = energyTokens(obj, d, "top:energy-consumption");
  for (const c of topLevelChecks(obj, d, level)) if (c.value !== undefined && c.mismatch()) bad.push(`top:${c.token}`);
  return bad;
}

function pairedTokens(obj, d, siblings) {
  const carbonOmitted = ["scope-2", "scope-3", "carbon-footprint"].every((k) => obj[k] === undefined);
  const paired = carbonOmitted ? undefined : (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based");
  if (!paired) return [];
  const location = locationFigures(d, { carbonUnit: paired["carbon-unit"] });
  const bad = location ? locationTokens(paired, location) : ["paired:not publishable"];
  return [...bad, ...energyTokens(paired, d, "paired:energy-consumption")];
}

function locationTokens(paired, location) {
  return ["scope-2", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"]
    .filter((name) => paired[name] !== undefined && (!(name in location) || !eq(num(paired[name]), num(location[name]))))
    .map((name) => `paired:${name}`);
}

/** Compare every figure a declaration publishes with the recomputed value. Returns mismatch tokens. */
export function compareDeclared(obj, ev2, d, level, siblings) {
  const bad = operatorTokens(Array.isArray(ev2.operators) ? ev2.operators : [], d);
  if (level === "network") { if (!d.has1x && ev2["network-offset-coverage"] !== d.networkCoverage) bad.push("network-offset-coverage"); }
  else if ("network-offset-coverage" in ev2) bad.push("network-offset-coverage present");
  return [...bad, ...topLevelTokens(obj, d, level), ...pairedTokens(obj, d, siblings)];
}

/** Causes that make C-SFC-7 NOT-EVALUABLE before the figures are compared. */
function blockers(ctx, decl, level, period, rows, hits, profileNotRead) {
  const ne = [];
  if (profileNotRead) ne.push("profile-version not read");
  if (!period) ne.push("period not one month or one calendar year");
  if (level === "operator" && typeof extOf(decl, "network-topology")?.["member-of-network"] !== "string") ne.push("member-of-network missing");
  if (hits.length) ne.push(`limit: ${list(hits.map((h) => h.limit))}`);
  const l9 = rows.some((r) => r.id === "D5.event" && r.result === NE && String(r.detail).includes("L8b")) || l9Gaps(ctx).length > 0;
  if (l9) ne.push("L9 not evaluable");
  if (ctx.unverifiedTakeovers?.length) ne.push(`takeover not verified: ${ctx.unverifiedTakeovers.join(", ")}`);
  if (rows.some((r) => r.id === "ERROR")) ne.push("a stage stopped");
  return ne;
}

/** The C-SFC-7 row, from the rows of D2 to D5 and the comparison of figures. */
export function csfc7(ctx, decl, level, ev2, period, siblings, rows, hits, profileNotRead, label) {
  if (!ev2) return row("C-SFC-7", NE, "no ledger-evidence-2", label);
  const ne = blockers(ctx, decl, level, period, rows, hits, profileNotRead);
  const failed = rows.filter((r) => FAIL_PREFIXES.some((p) => r.id === p || r.id.startsWith(`${p}.`)) && r.result === FAIL);
  let tokens = [];
  if (period && !profileNotRead) {
    const d = deriveFor(ctx, decl.updated, period, decl, level);
    tokens = compareDeclared(decl, ev2, d, level, siblings);
    if (d.has1x) ne.push(`1.x-form event in counted months: ${list(d.events1x)}`);
  }
  const fails = [...failed.map((r) => `${r.id} ${r.scope ?? ""}`.trim()), ...tokens];
  if (fails.length) return row("C-SFC-7", FAIL, list(fails), label);
  if (ne.length) return row("C-SFC-7", NE, list(ne), label);
  const unauthenticated = rows.some((r) => (r.id === "D2.entry" || r.id === "D4.checkpoint") && r.result === NE);
  return unauthenticated ? row("C-SFC-7", NE, "consistent but not authenticated", label) : row("C-SFC-7", PASS, undefined, label);
}
