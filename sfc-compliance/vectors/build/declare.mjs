/** Declaration objects (draft -10 wire) built from a derivation, and their JWS. */
import { canonicalize } from "../../lib/canonical.mjs";
import { signWithSeed } from "./signing.mjs";
import { KEY1, b64u } from "./keys.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { derivedFor } from "./publish.mjs";

export const PROVIDER = "SYNTHETIC EXAMPLE, not a real network and not a real measurement. Role contact: sustainability@ledger.example. Every figure is invented.";

/** JWS Compact, Ed25519, over the RFC 8785 text of the object without `signed`. */
export function jws(obj, { key = KEY1, header = { alg: "Ed25519", cty: "sustainability-data+json" }, payload } = {}) {
  const { signed, ...rest } = obj;
  const h = b64u(Buffer.from(canonicalize(header)));
  const p = b64u(Buffer.from(payload ?? canonicalize(rest)));
  const sig = signWithSeed(key.seed, Buffer.from(`${h}.${p}`, "ascii"));
  return `${h}.${p}.${b64u(sig)}`;
}
export const signDeclaration = (obj, opts) => ({ ...obj, signed: jws(obj, opts) });

/** The `extensions` of the primary object: hardware, carbon neutrality, topology and ledger evidence. */
function extensionsOf(spec, d, level) {
  const ext = {};
  if (spec.hardware !== false) ext[`${EXT}hardware-lifecycle`] = { "general-purpose-hardware": true, "single-use-asic-required": false, "expected-service-life-years": 6, "embodied-carbon-in-scope-3": true, "reuse-and-recycling-policy-uri": "https://ledger.example/sustainability/hardware-policy.html" };
  ext[`${EXT}carbon-neutrality`] = { ...d.carbonNeutrality, "renewable-procurement": "power-purchase-agreements", "offset-registry-uri": "https://registry.example/retirements" };
  const topo = { ...d.networkTopology };
  if (level === "operator") { topo["member-of-network"] = spec.memberOf ?? "ledger.example"; topo["network-declaration"] = "https://ledger.example/.well-known/sustainability-data"; }
  ext[`${EXT}network-topology`] = topo;
  ext[`${EXT}ledger-evidence-2`] = { ...d.evidence, "ledger-access-uri": spec.access ?? "https://ledger.example/sfc/read" };
  return ext;
}

/**
 * The primary (market-based) object for a derivation. `spec` as for derivedFor, plus
 * updated, target, targetType, access, extras (members to add or override), omit (members to drop).
 */
export function primaryObject(ctx, spec) {
  const d = derivedFor(ctx, spec);
  const level = spec.level ?? "network";
  const o = {
    updated: spec.updated, capabilities: "basic", provider: spec.provider ?? PROVIDER,
    "measurement-method": d.top["measurement-method"], "methodology-uri": spec.methodologyUri ?? "https://ledger.example/sustainability/METHODOLOGY.md",
    period: spec.period, target: spec.target, "target-type": level === "network" ? "service" : "origin",
    ...d.top,
  };
  delete o["measurement-method"];
  o["measurement-method"] = d.top["measurement-method"];
  if (spec.renewable !== undefined && !d.incomplete.energy) o["renewable-energy"] = spec.renewable;
  if (spec.disclosure !== false) o["disclosure-uri"] = spec.disclosure ?? "https://ledger.example/sustainability/disclosures.json";
  const ext = extensionsOf(spec, d, level);
  o.extensions = ext;
  for (const [k, v] of Object.entries(spec.extras ?? {})) o[k] = v;
  for (const k of spec.omit ?? []) delete o[k];
  return { obj: o, derived: d };
}

/** The paired location-based object for a primary object. */
export function locationObject(primary, ctx, spec) {
  const d = derivedFor(ctx, spec);
  const loc = locationFigures_(d, spec);
  const keep = ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target", "target-type", "energy-consumption", "energy-unit", "carbon-unit", "disclosure-uri"];
  const o = {};
  for (const k of keep) if (primary[k] !== undefined) o[k] = primary[k];
  o["carbon-accounting"] = "location-based";
  Object.assign(o, loc);
  return o;
}
function locationFigures_(d, spec) {
  const f = d.location;
  if (!f) throw new Error("location object not publishable for this derivation");
  return f;
}
