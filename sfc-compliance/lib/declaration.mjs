/** Reading a declaration object: its level, its extensions and the members the checks use (7.1, 8.1). */
import { isObject, isMonthBound, sameTarget } from "./forms.mjs";
import { addMonths } from "./time.mjs";
import { row, FAIL } from "./rows.mjs";

export const EXT = "https://andreibesleaga.com/sfc/extensions/";
export const OLD_EVIDENCE = `${EXT}ledger-evidence`;
const SFC_EXTENSIONS = ["hardware-lifecycle", "carbon-neutrality", "network-topology", "ledger-evidence-2"];

/** The value of one extension, if it is an object. */
export const extOf = (obj, name) => (isObject(obj?.extensions) && isObject(obj.extensions[EXT + name]) ? obj.extensions[EXT + name] : undefined);

/** An object whose `network-topology` carries `member-of-network` is an operator declaration whatever its `target-type` says. */
export function levelOf(obj) {
  if (typeof extOf(obj, "network-topology")?.["member-of-network"] === "string") return "operator";
  return obj?.["target-type"] === "origin" ? "operator" : "network";
}
/** An object claims SFC when its `extensions` carries a name of 8.1 other than the superseded one. */
export const claimsSfc = (obj) => isObject(obj?.extensions)
  && Object.keys(obj.extensions).some((k) => k.startsWith(EXT) && k !== OLD_EVIDENCE && SFC_EXTENSIONS.includes(k.slice(EXT.length)));
/**
 * The period of a declaration the deep check may work over: both bounds month-bound and the end one month or
 * twelve months after the start (8.1), else null. The work of the deep check grows with months times operators,
 * so no other length is walked; a longer period is NOT-EVALUABLE, never a format error.
 */
export function usablePeriod(decl) {
  const p = decl?.period;
  if (!isMonthBound(p?.start) || !isMonthBound(p?.end)) return null;
  return p.end === addMonths(p.start, 1) || p.end === addMonths(p.start, 12) ? p : null;
}
/** The objects of a body, which is one object or an array of them. */
export const objectsOf = (doc) => (Array.isArray(doc) ? doc : [doc]).filter(isObject);
/** S2 FAIL rows for a served body that is neither a declaration object nor an array of them (9.1): one for a scalar body, one per item that is not an object. */
export function bodyShapeRows(doc) {
  if (isObject(doc)) return [];
  if (!Array.isArray(doc)) return [row("S2", FAIL, "body is not a declaration object or an array of them")];
  return doc.flatMap((x, i) => (isObject(x) ? [] : [row("S2", FAIL, `item ${i} is not an object`)]));
}
/** Same target (hosts compared case-insensitively) and same period (7.3); the caller tests `carbon-accounting`. */
export const samePeriodTarget = (a, b) => sameTarget(a.target, b.target) && a.period?.start === b.period?.start && a.period?.end === b.period?.end;
/** The scope of a report row about an object. */
export const labelOf = (o) => `${o.target} ${String(o.period?.start ?? "-").slice(0, 10)}..${String(o.period?.end ?? "-").slice(0, 10)} ${o["carbon-accounting"] ?? "-"}`;
export const hasEvidence = (o) => extOf(o, "ledger-evidence-2") !== undefined;

const NUMERIC_MEMBERS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh", "renewable-energy"];
const UNIT_MEMBERS = ["energy-unit", "carbon-unit", "carbon-accounting"];
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const TYPE_TESTS = { number: isFiniteNumber, integer: Number.isInteger, boolean: (v) => typeof v === "boolean", string: (v) => typeof v === "string" };

/** The optional members of the extension tables (8.2 to 8.4) with their JSON types: a wrong-typed one is read as absent (8.1) and S6 a reports it as INFO. */
const OPTIONAL_EXT_MEMBERS = {
  "hardware-lifecycle": { "expected-service-life-years": "number", "embodied-carbon-in-scope-3": "boolean", "reuse-and-recycling-policy-uri": "string" },
  "carbon-neutrality": { "renewable-procurement": "string", "residual-emissions-tCO2e": "number", "offsets-retired-tCO2e": "number", "offset-registry-uri": "string", "offsets-attested-by": "string" },
  "network-topology": { "nakamoto-coefficient": "integer", "per-transaction-energy-Wh": "number", "geographic-regions": "integer", "network-declaration": "string" },
};

/** The names of the optional extension members of `obj` whose JSON type is wrong, as `<extension>.<member>`, in table order. */
export function mistypedMembers(obj) {
  const out = [];
  for (const [name, table] of Object.entries(OPTIONAL_EXT_MEMBERS)) {
    const ext = extOf(obj, name);
    if (!ext) continue;
    for (const [member, type] of Object.entries(table)) if (member in ext && !TYPE_TESTS[type](ext[member])) out.push(`${name}.${member}`);
  }
  return out;
}

/** The extensions of `obj` with its mistyped optional members left out; the served value is not changed. */
function extensionsReadAsAbsent(obj) {
  const extensions = { ...obj.extensions };
  for (const token of mistypedMembers(obj)) {
    const [name, member] = token.split(".");
    const { [member]: dropped, ...rest } = extensions[EXT + name];
    extensions[EXT + name] = rest;
  }
  return extensions;
}

/**
 * The object as the figure checks read it: a member of the wrong JSON type is read as absent (8.1), so a
 * mistyped figure is reported by S2 and S6 a and never reaches arithmetic. The served object is not changed.
 */
export function readAsAbsent(obj) {
  const out = { ...obj };
  for (const k of NUMERIC_MEMBERS) if (k in out && !isFiniteNumber(out[k])) delete out[k];
  for (const k of UNIT_MEMBERS) if (k in out && typeof out[k] !== "string") delete out[k];
  if (isObject(out.extensions)) out.extensions = extensionsReadAsAbsent(out);
  return out;
}
