/**
 * The declaration from the answers. Every closed set is the publisher library's; a value outside
 * one is refused with the allowed values named. The result is checked by the library's strict
 * validator before anything is written (see `checkedDocument`).
 */
import { domainToASCII } from "node:url";
import {
  CARBON_ACCOUNTING, CARBON_UNITS, ENERGY_UNITS, FUNCTIONAL_UNITS, MEASUREMENT_METHODS, TARGET_TYPES, UPSTREAM_ROLES,
  assertValid, dateTimeError, extensionNameError, isUriReference, validateDocument,
} from "sustainability-wellknown-publisher";
import { periodFrom } from "./period.mjs";

const text = (a, k) => (a[k] === undefined ? "" : String(a[k]).trim());

function need(a, k) {
  const v = text(a, k);
  if (v === "") throw new Error(`${k} is required`);
  return v;
}

function oneOf(a, k, set, fallback) {
  const v = text(a, k) || fallback;
  if (v === undefined) return undefined;
  if (!set.includes(v)) {
    const hint = k === "functional-unit" ? "; a score in another unit goes in extensions, under a name whose definition states the unit" : "";
    throw new Error(`${k} must be one of ${set.join(", ")} (got ${JSON.stringify(v)})${hint}`);
  }
  return v;
}

/** A finite number from an answer; `signed` lets a scope be negative (a removal). */
function number(a, k, { signed = false } = {}) {
  const v = text(a, k);
  if (v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${k} must be a number (got ${JSON.stringify(v)})`);
  if (n < 0 && !signed) throw new Error(`${k} must not be negative; leave it out if you do not have it`);
  return n;
}

function link(a, k) {
  const v = text(a, k);
  if (v === "") return undefined;
  if (!isUriReference(v)) throw new Error(`${k} must be a URI reference such as https://example.com/page or /esg/methodology (got ${JSON.stringify(v)})`);
  return v;
}

/** `--energy-kwh 12` and `--carbon-kgco2e 3` are shorthands for a value with its unit. */
function withShorthand(a, k, shorthand, unitKey, unit) {
  if (text(a, shorthand) === "") return a;
  if (text(a, k) !== "") throw new Error(`give ${shorthand} or ${k}, not both`);
  return { ...a, [k]: a[shorthand], [unitKey]: unit };
}

/** The host in A-label form when it was given in U-label form (draft, Mandatory Members). */
export function hostTarget(target, targetType) {
  const hostShaped = /^[^\s/]+\.[^\s/]+$/.test(target) && /[^\x00-\x7f]/.test(target);
  if (targetType !== "origin" || !hostShaped) return { target };
  const ascii = domainToASCII(target);
  if (ascii === "") throw new Error(`target ${JSON.stringify(target)} is not a valid host name`);
  return { target: ascii, note: `target written in A-label form: ${ascii}` };
}

function upstreamFrom(entries) {
  return entries.map((entry) => {
    const m = /^([a-z]+):(?!\/\/)(.+)$/.exec(entry);
    if (m === null) return { declaration: entry };
    if (!UPSTREAM_ROLES.includes(m[1])) throw new Error(`upstream role must be one of ${UPSTREAM_ROLES.join(", ")} (got ${JSON.stringify(m[1])})`);
    return { declaration: m[2], role: m[1] };
  });
}

function extensionsFrom(entries) {
  const out = {};
  for (const entry of entries) {
    const at = entry.indexOf("={");
    if (at < 0) throw new Error(`extension must be NAME={"member": value}, a URI and a JSON object (got ${JSON.stringify(entry)})`);
    const name = entry.slice(0, at);
    const why = extensionNameError(name);
    if (why !== undefined) throw new Error(`extension name ${JSON.stringify(name)} ${why}`);
    try {
      out[name] = JSON.parse(entry.slice(at + 1));
    } catch {
      throw new Error(`extension ${name}: the value is not JSON`);
    }
  }
  return out;
}

/**
 * The declaration for the answers, and the notes about choices the tool made for the person.
 * `now` is the clock, passed in: it gives `updated` and the default period.
 */
export function declarationFrom(answers, now = new Date()) {
  const a = withShorthand(withShorthand(answers, "energy-consumption", "energy-kwh", "energy-unit", "kWh"),
    "carbon-footprint", "carbon-kgco2e", "carbon-unit", "kgCO2e");
  const notes = [];
  const methodologyUri = link(a, "methodology-uri");
  if (methodologyUri === undefined) throw new Error("methodology-uri is required: the page that says what is measured and what is estimated");
  const targetType = oneOf(a, "target-type", TARGET_TYPES, "origin");
  const host = hostTarget(need(a, "target"), targetType);
  if (host.note) notes.push(host.note);
  const updated = text(a, "updated") || now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const updatedError = dateTimeError(updated);
  if (updatedError !== undefined) throw new Error(`updated ${updatedError}`);

  const doc = {
    updated,
    capabilities: "basic",
    provider: need(a, "provider").normalize("NFC"),
    "measurement-method": oneOf(a, "measurement-method", MEASUREMENT_METHODS, "third-party-modeled"),
    "methodology-uri": methodologyUri,
    period: periodFrom(a, now),
    target: host.target,
    "target-type": targetType,
  };
  addFigures(doc, a);
  const disclosure = link(a, "disclosure-uri");
  const attestation = link(a, "verifiable-attestation-uri");
  if (disclosure) doc["disclosure-uri"] = disclosure;
  if (attestation) doc["verifiable-attestation-uri"] = attestation;
  const hasFigure = ["energy-consumption", "carbon-footprint", "sci-score", "renewable-energy", "scope-1", "scope-2", "scope-3"].some((k) => k in doc);
  if (!hasFigure && !disclosure && !attestation) {
    throw new Error("give a figure (energy-consumption, carbon-footprint, ...) or a disclosure-uri or verifiable-attestation-uri: a declaration carries a figure or an evidence link");
  }
  if (a.upstream?.length) doc.upstream = upstreamFrom(a.upstream);
  if (a.extension?.length) doc.extensions = extensionsFrom(a.extension);
  return { doc, notes };
}

function addFigures(doc, a) {
  const energy = number(a, "energy-consumption");
  if (energy !== undefined) {
    doc["energy-consumption"] = energy;
    doc["energy-unit"] = oneOf(a, "energy-unit", ENERGY_UNITS, "kWh");
  }
  const carbon = number(a, "carbon-footprint");
  const scopes = ["scope-1", "scope-2", "scope-3"].filter((k) => text(a, k) !== "");
  if (carbon !== undefined || scopes.length > 0) {
    if (carbon !== undefined) doc["carbon-footprint"] = carbon;
    doc["carbon-unit"] = oneOf(a, "carbon-unit", CARBON_UNITS, "kgCO2e");
  }
  const accounting = oneOf(a, "carbon-accounting", CARBON_ACCOUNTING);
  if (accounting) doc["carbon-accounting"] = accounting;
  for (const k of scopes) doc[k] = number(a, k, { signed: true });
  const score = number(a, "sci-score");
  const unit = oneOf(a, "functional-unit", FUNCTIONAL_UNITS);
  if (score !== undefined && unit === undefined) throw new Error(`functional-unit is required with sci-score: one of ${FUNCTIONAL_UNITS.join(", ")}`);
  if (score !== undefined) doc["sci-score"] = score;
  if (unit) doc["functional-unit"] = unit;
  const renewable = number(a, "renewable-energy");
  if (renewable !== undefined) {
    if (renewable > 100) throw new Error("renewable-energy is a percentage between 0 and 100");
    doc["renewable-energy"] = renewable;
  }
}

/**
 * Validate the document as the strict reader does and return its advisory warnings. Throws an Error
 * naming every problem; nothing may be written after a throw.
 */
export function checkedDocument(doc) {
  const result = validateDocument(doc, { legacyCompat: false });
  if (!result.valid) throw new Error(`the declaration is not valid:\n - ${result.errors.join("\n - ")}`);
  assertValid(doc);
  return result.warnings.map((w) => w.message);
}
