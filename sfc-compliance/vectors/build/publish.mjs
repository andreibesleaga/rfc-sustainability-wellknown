/**
 * What a publisher writes from a ledger read (sections 7.3 to 7.5): the figures of a declaration and its
 * `ledger-evidence-2` value. The derivation itself is the checker's (../../lib/derive.mjs); this module
 * only turns it into published numbers, so the vectors and the checker never hold two derivations.
 */
import { deriveFor, ENERGY_SHIFT, CARBON_SHIFT, convert, round6, locationFigures } from "../../lib/derive.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { eq, fromNumber, toText, add, divRound, mulInt, shift, isZero } from "../../lib/decimal.mjs";

/** The JSON number published for an exact decimal; throws unless its RFC 8785 text equals the value. */
function toPublished(a) {
  const text = toText(a);
  const x = Number(text);
  if (!eq(fromNumber(x), a)) throw new Error(`value ${text} is not representable as an RFC 8785 number text`);
  return x;
}
const pub = (x) => toPublished(round6(x));

/** `ledger-evidence-2` value computed from a derivation. */
export function evidenceValue(d, { level = "network", access = "https://ledger.example/sfc/read" } = {}) {
  const value = {
    "profile-version": "2.0",
    "ledger-access-uri": access,
    operators: d.ops.map((o) => ({
      operator: o.operator, origin: o.origin,
      "energy-head": o.energyHead, "carbon-head": o.carbonHead,
      "energy-events": o.energyEvents, "carbon-events": o.carbonEvents,
      kwh: pub(o.kwh), "scope1-kgco2e": pub(o.s1), "scope2-kgco2e": pub(o.s2), "scope3-kgco2e": pub(o.s3),
      "offsets-kgco2e": pub(o.off), "offset-coverage-every-period": o.coverage,
    })),
  };
  if (level === "network") value["network-offset-coverage"] = d.networkCoverage;
  return value;
}

/** The carbon member group of 7.4 (`scope-1` only when the operators have any), in publication order. */
function carbonMembers(d, cc, carbonUnit) {
  const out = {};
  if (d.hasS1) out["scope-1"] = cc(d.S1);
  out["scope-2"] = cc(d.S2); out["scope-3"] = cc(d.S3); out["carbon-footprint"] = cc(d.footprint);
  out["carbon-unit"] = carbonUnit; out["carbon-accounting"] = "market-based";
  return out;
}

/** The `network-topology` value of a network declaration; the node count only when the energy group is complete. */
function topologyOf(d, consensus, level) {
  if (level !== "network") return {};
  const topology = { "consensus-mechanism": consensus };
  if (!d.incompleteEnergy) {
    topology["validated-node-count"] = d.nodes;
    topology["node-count-validation-method"] = "maximum over the months of the period of the sum of the operators' monthly peak node counts";
  }
  return topology;
}

/** Top-level members 7.4 derives, omitting what 7.5 omits. Values are published numbers. */
export function topLevel(d, { energyUnit = "MWh", carbonUnit = "tCO2e", consensus = "proof-of-authority", level = "network" } = {}) {
  const ce = (x) => pub(convert(x, ENERGY_SHIFT[energyUnit]));
  const cc = (x) => pub(convert(x, CARBON_SHIFT[carbonUnit]));
  const out = {};
  if (d.leastDirect) out["measurement-method"] = d.leastDirect;
  if (!d.incompleteEnergy) { out["energy-consumption"] = ce(d.E); out["energy-unit"] = energyUnit; }
  if (!d.incompleteCarbon) Object.assign(out, carbonMembers(d, cc, carbonUnit));
  if (!d.incompleteEnergy && !d.incompleteCarbon && !isZero(d.E)) out["carbon-intensity-gCO2e-per-kWh"] = pub(divRound(mulInt(d.S2, 1000), d.E, 6));
  const neutrality = { "net-zero-status": d.status };
  if (!d.incompleteCarbon) neutrality["offsets-retired-tCO2e"] = pub(shift(d.Off, 3));
  return { top: out, carbonNeutrality: neutrality, networkTopology: topologyOf(d, consensus, level) };
}

const silentList = (d) => [
  ...d.silentEnergy.map((x) => `${x.operator} ${x.month.slice(0, 7)} EnergyAttested`),
  ...d.silentCarbon.map((x) => `${x.operator} ${x.month.slice(0, 7)} CarbonAttested`),
  ...d.noOperator.map((m) => `no operator ${m.slice(0, 7)}`),
].sort();

/** Figures a publisher writes, from the read: spec = { period, cutoff, level, operator?, energyUnit, carbonUnit, consensus }. */
export function derivedFor(ctx, spec) {
  const level = spec.level ?? "network";
  const decl = level === "operator" ? { extensions: { [`${EXT}ledger-evidence-2`]: { operators: [{ operator: spec.operator }] } } } : null;
  const d = deriveFor(ctx, spec.cutoff, spec.period, decl, level);
  const t = topLevel(d, spec);
  return {
    spec,
    incomplete: { energy: d.incompleteEnergy, carbon: d.incompleteCarbon },
    silent: silentList(d),
    evidence: evidenceValue(d, { level }),
    top: t.top, carbonNeutrality: t.carbonNeutrality, networkTopology: t.networkTopology,
    location: locationFigures(d, spec),
  };
}
