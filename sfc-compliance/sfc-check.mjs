#!/usr/bin/env node
/**
 * sfc-check: read one sustainability declaration and report the four criteria of
 * PROFILE.md (the SFC profile of draft-besleaga-sustainability-wellknown-07).
 *
 * Nothing here extends the draft. The document is validated by the published
 * consumer library, and every criterion is read off the members the draft
 * defines plus the three extension names PROFILE.md section 4 mints.
 *
 * What the output words mean:
 *   PASS      a check a reader can actually make came out right
 *   FAIL      it came out wrong
 *   DECLARED  the document says so. Nothing here establishes that it is true
 *   ABSENT    the member or extension is not there
 *   REFUSED   the check was not made, and the reason is given
 *   WARN      worth looking at, and not a conformance failure
 *   INFO      context
 *
 * Exit status: 0 normally, 1 when the document does not conform to the draft or
 * when the annual network figure is at or above the cap, 2 on a usage error.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  validateDocument,
  convertEnergy,
  runConformanceChecks,
  fetchSustainability,
  verifyAttestation,
  isExtensionName,
} from "sustainability-wellknown-consumer";

export const NS = "https://andreibesleaga.com/sfc/extensions/";
export const HARDWARE_LIFECYCLE = NS + "hardware-lifecycle";
export const CARBON_NEUTRALITY = NS + "carbon-neutrality";
export const NETWORK_TOPOLOGY = NS + "network-topology";

/** PROFILE.md section 3.1. The cap is a whole year figure for a whole network. */
export const CAP_GWH = 1;
/** PROFILE.md section 2. The draft's target-type enumeration has no "network". */
export const NETWORK_TARGET_TYPE = "service";
/** The period form C1 is evaluated on. */
export const ANNUAL_PERIOD_RE = /^\d{4}$/;

/**
 * The clock. Injected everywhere a library reads one, so that a run is
 * reproducible and no verdict moves with the date. Override with --now.
 */
export const DEFAULT_CLOCK = new Date("2026-01-01T00:00:00Z");

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isString = (v) => typeof v === "string" && v.length > 0;
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

const row = (status, id, detail) => ({ status, id, detail });

/** The declaration objects of a document, in order. */
export function objectsOf(doc) {
  if (Array.isArray(doc)) return doc.filter(isObject);
  return isObject(doc) ? [doc] : [];
}

/**
 * The object C1 is evaluated on, or the reason it cannot be evaluated at all.
 * PROFILE.md section 2: a whole year, and the network level.
 */
export function selectAnnualNetworkObject(objects) {
  const annual = objects.filter((o) => ANNUAL_PERIOD_RE.test(String(o["reporting-period"] ?? "")));
  if (annual.length === 0) {
    const periods = objects.map((o) => String(o["reporting-period"] ?? "(none)")).join(", ");
    return {
      object: undefined,
      reason: `no object covers a whole calendar year. C1 is an annual figure, and this document reports ${periods || "nothing"}`,
    };
  }
  const network = annual.filter((o) => o["target-type"] === NETWORK_TARGET_TYPE);
  if (network.length === 0) {
    const types = annual.map((o) => String(o["target-type"] ?? "(absent)")).join(", ");
    return {
      object: undefined,
      reason: `C1 is a whole network figure and this declaration is not at the network level: target-type is ${types}, not "${NETWORK_TARGET_TYPE}". One operator is trivially under a system wide cap, so the check would mean nothing`,
    };
  }
  if (network.length > 1) {
    return {
      object: undefined,
      reason: `${network.length} annual network level objects in one document; C1 needs exactly one`,
    };
  }
  return { object: network[0], reason: undefined };
}

/** The object the other criteria are read from. */
export function selectSubjectObject(objects, annualNetwork) {
  if (annualNetwork) return annualNetwork;
  const annual = objects.filter((o) => ANNUAL_PERIOD_RE.test(String(o["reporting-period"] ?? "")));
  return annual[0] ?? objects[0];
}

function extensionOf(obj, name) {
  const ext = obj && obj.extensions;
  if (!isObject(ext)) return undefined;
  const value = ext[name];
  return isObject(value) ? value : undefined;
}

/** C1. The only check here that can end in FAIL on the figures themselves. */
function checkC1(rows, selection) {
  if (!selection.object) {
    rows.push(row("REFUSED", "C1-energy", selection.reason));
    return false;
  }
  const o = selection.object;
  if (!isNumber(o["energy-consumption"])) {
    rows.push(row("REFUSED", "C1-energy", "the annual network object carries no energy-consumption figure"));
    return false;
  }
  const unit = o["energy-unit"] ?? "kWh";
  let gwh;
  try {
    gwh = convertEnergy(o["energy-consumption"], unit, "GWh");
  } catch {
    rows.push(row("REFUSED", "C1-energy", `energy-unit "${unit}" is not one of Wh, kWh, MWh, GWh, so the figure cannot be converted`));
    return false;
  }
  const detail = `${o["energy-consumption"]} ${unit} = ${gwh} GWh against the cap of ${CAP_GWH} GWh, for ${o.target} over ${o["reporting-period"]}`;
  if (gwh < CAP_GWH) {
    rows.push(row("PASS", "C1-energy", detail));
    return false;
  }
  rows.push(row("FAIL", "C1-energy", `${detail}. The declared figure is at or above the cap`));
  return true;
}

/** C2. Presence and shape only, and it says so. */
function checkC2(rows, obj) {
  const hw = extensionOf(obj, HARDWARE_LIFECYCLE);
  if (!hw) {
    rows.push(row("ABSENT", "C2-hardware-lifecycle", `no ${HARDWARE_LIFECYCLE} extension. Nothing is declared about the hardware`));
    return;
  }
  const general = hw["general-purpose-hardware"];
  const asic = hw["single-use-asic-required"];
  if (typeof general !== "boolean" || typeof asic !== "boolean") {
    rows.push(row("WARN", "C2-hardware-lifecycle", "the extension is present but general-purpose-hardware and single-use-asic-required are not both booleans, so the criterion is not declared"));
    return;
  }
  const life = isNumber(hw["expected-service-life-years"]) ? `, expected service life ${hw["expected-service-life-years"]} years` : "";
  rows.push(row("DECLARED", "C2-hardware-lifecycle", `general-purpose-hardware=${general}, single-use-asic-required=${asic}${life}. A document cannot establish what hardware exists`));
  if (hw["embodied-carbon-in-scope-3"] === true && !isNumber(obj["scope-3"])) {
    rows.push(row("WARN", "C2-embodied-carbon", "the extension says embodied carbon sits inside scope-3, but the object carries no scope-3 figure"));
  }
}

/** C3. Presence, coherence, and a declared net zero position. */
function checkC3(rows, obj) {
  const unit = obj["carbon-unit"] ?? "gCO2e";
  const hasScope2 = isNumber(obj["scope-2"]);
  const hasScope3 = isNumber(obj["scope-3"]);
  rows.push(
    hasScope2 && hasScope3
      ? row("PASS", "C3-scopes-2-3", `scope-2=${obj["scope-2"]}, scope-3=${obj["scope-3"]} ${unit}`)
      : row("ABSENT", "C3-scopes-2-3", `scope-2 ${hasScope2 ? "present" : "absent"}, scope-3 ${hasScope3 ? "present" : "absent"}. The profile asks for both at the network level`)
  );

  rows.push(
    isNumber(obj["carbon-intensity-gCO2e-per-kWh"])
      ? row("PASS", "C3-carbon-intensity", `${obj["carbon-intensity-gCO2e-per-kWh"]} gCO2e per kWh, weighted over the period`)
      : row("ABSENT", "C3-carbon-intensity", "no carbon-intensity-gCO2e-per-kWh")
  );

  const basis = obj["carbon-accounting"];
  rows.push(
    basis === "location-based" || basis === "market-based"
      ? row("PASS", "C3-carbon-accounting", `${basis}. Figures on different bases are not comparable, and this one is stated`)
      : row("ABSENT", "C3-carbon-accounting", "no carbon-accounting basis, so these figures cannot be compared with anyone else's")
  );

  rows.push(
    isNumber(obj["renewable-energy"])
      ? row("PASS", "C3-renewable-energy", `${obj["renewable-energy"]} percent of energy from renewable sources`)
      : row("ABSENT", "C3-renewable-energy", "no renewable-energy percentage")
  );

  if (isNumber(obj["carbon-footprint"]) && hasScope2 && hasScope3) {
    const sum = (obj["scope-1"] ?? 0) + obj["scope-2"] + obj["scope-3"];
    const gross = obj["carbon-footprint"];
    const drift = gross === 0 ? Math.abs(sum) : Math.abs(sum - gross) / Math.abs(gross);
    rows.push(
      drift <= 0.01
        ? row("PASS", "C3-gross-coherence", `carbon-footprint ${gross} ${unit} against scope 1+2+3 = ${Number(sum.toFixed(6))} ${unit}`)
        : row("WARN", "C3-gross-coherence", `carbon-footprint ${gross} ${unit} but scope 1+2+3 = ${Number(sum.toFixed(6))} ${unit}. The methodology document should say why they differ`)
    );
  }

  const nz = extensionOf(obj, CARBON_NEUTRALITY);
  if (!nz) {
    rows.push(row("ABSENT", "C3-net-zero", `no ${CARBON_NEUTRALITY} extension. No net zero position is claimed`));
  } else {
    const status = nz["net-zero-status"];
    const known = ["achieved", "partial", "not-achieved"].includes(status);
    const via = isString(nz["renewable-procurement"]) ? ` via ${nz["renewable-procurement"]}` : "";
    const retired = isNumber(nz["offsets-retired-tCO2e"]) ? `, ${nz["offsets-retired-tCO2e"]} tCO2e retired` : "";
    rows.push(
      known
        ? row("DECLARED", "C3-net-zero", `net-zero-status=${status}${via}${retired}. This is the publisher's own claim`)
        : row("WARN", "C3-net-zero", `net-zero-status is ${JSON.stringify(status)}, which the profile does not define`)
    );
    if (isNumber(nz["offsets-retired-tCO2e"]) && !isString(nz["offset-registry-uri"])) {
      rows.push(row("WARN", "C3-net-zero-evidence", "retirements are claimed but no offset-registry-uri names the record they can be read in"));
    }
    if (obj["carbon-footprint"] === 0 && status === "achieved") {
      rows.push(row("WARN", "C3-gross-figure", "carbon-footprint is zero beside a net zero claim. The gross figure is not reduced by offsets (PROFILE.md rule 1)"));
    }
  }
}

/** The attestation link, and, with --verify-attestation, the statement itself. */
async function checkAttestation(rows, obj, options) {
  const uri = obj["verifiable-attestation-uri"];
  if (!isString(uri)) {
    rows.push(row("ABSENT", "C3-attestation", "no verifiable-attestation-uri. Nobody else has spoken about these figures"));
    return;
  }
  if (!options.verifyAttestation) {
    rows.push(row("INFO", "C3-attestation", `verifiable-attestation-uri present (${uri}). Its presence alone is evidence of nothing. Re-run with --verify-attestation to fetch the statement and check it`));
    return;
  }
  let result;
  try {
    result = await verifyAttestation(uri, {
      now: options.clock,
      declaration: obj,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      lookup: options.lookup,
    });
  } catch (err) {
    rows.push(row("WARN", "C3-attestation", `the statement at ${uri} could not be retrieved: ${err && err.message ? err.message : String(err)}`));
    return;
  }
  if (!result.valid) {
    rows.push(row("WARN", "C3-attestation", `the statement at ${uri} did not check out: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`));
    return;
  }
  const binding = result.binding ? result.binding.status : "not-checked";
  rows.push(
    row(
      "DECLARED",
      "C3-attestation",
      `a statement by ${result.issuer} was fetched and its signature checks out (${result.alg}, key ${result.assurance}, declaration copy ${binding}). It is attested, not verified: this is evidence about the statement, not about the figures`
    )
  );
}

/** C4, as a mechanism. The HTTP half is only checkable against an origin. */
function checkC4Document(rows, obj, conformant) {
  rows.push(
    conformant
      ? row("PASS", "C4-document", "the document validates against the draft, schema and prose rules alike, so any reader can parse it")
      : row("FAIL", "C4-document", "the document does not validate against the draft")
  );
  rows.push(
    isString(obj["disclosure-uri"])
      ? row("PASS", "C4-disclosure-index", `${obj["disclosure-uri"]}. The profile asks that this name an index, not one report`)
      : row("ABSENT", "C4-disclosure-index", "no disclosure-uri, so the filed reports cannot be reached from here")
  );
}

/** Measurement transparency and the topology figures the draft has no members for. */
function checkMeasurement(rows, obj) {
  rows.push(
    isString(obj["methodology-uri"])
      ? row("PASS", "M-methodology", `${obj["measurement-method"]} at ${obj["methodology-uri"]}`)
      : row("FAIL", "M-methodology", "no methodology-uri, which the draft makes mandatory")
  );
  const topo = extensionOf(obj, NETWORK_TOPOLOGY);
  if (!topo) {
    rows.push(row("ABSENT", "M-topology", `no ${NETWORK_TOPOLOGY} extension`));
    return;
  }
  if (isString(topo["member-of-network"])) {
    const where = isString(topo["network-declaration"]) ? `, declared at ${topo["network-declaration"]}` : "";
    rows.push(row("DECLARED", "M-membership", `this subject declares itself part of ${topo["member-of-network"]}${where}. Membership is a claim by this origin about that network`));
    return;
  }
  const bits = [];
  if (isString(topo["consensus-mechanism"])) bits.push(`consensus=${topo["consensus-mechanism"]}`);
  if (isNumber(topo["validated-node-count"])) bits.push(`validated nodes=${topo["validated-node-count"]}`);
  if (isNumber(topo["per-transaction-energy-Wh"])) bits.push(`${topo["per-transaction-energy-Wh"]} Wh per transaction`);
  if (isNumber(topo["nakamoto-coefficient"])) bits.push(`nakamoto=${topo["nakamoto-coefficient"]}`);
  if (isNumber(topo["geographic-regions"])) bits.push(`regions=${topo["geographic-regions"]}`);
  rows.push(row("DECLARED", "M-topology", bits.length ? bits.join(", ") : "the extension is present but carries none of the members the profile defines"));
  if (isNumber(topo["validated-node-count"]) && !isString(topo["node-count-validation-method"])) {
    rows.push(row("WARN", "M-topology", "validated-node-count is given without node-count-validation-method, so the count cannot be read"));
  }
}

/**
 * Check one document. Pure apart from the optional attestation fetch, which
 * only runs when options.verifyAttestation is set.
 */
export async function checkDocument(doc, options = {}) {
  const opts = {
    clock: options.clock ?? DEFAULT_CLOCK,
    verifyAttestation: options.verifyAttestation === true,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
  };
  const rows = [];
  const objects = objectsOf(doc);
  if (objects.length === 0) {
    rows.push(row("FAIL", "draft-conformance", "the body is not a declaration object and not an array of them"));
    return { rows, conformant: false, capExceeded: false, exitCode: 1 };
  }

  const validation = validateDocument(doc);
  rows.push(
    validation.valid
      ? row("PASS", "draft-conformance", "valid against the -07 schema and prose rules")
      : row("FAIL", "draft-conformance", validation.errors.join("; "))
  );
  for (const warning of validation.warnings) rows.push(row("WARN", "draft-warning", warning));

  const selection = selectAnnualNetworkObject(objects);
  const subject = selectSubjectObject(objects, selection.object);
  if (objects.length > 1) {
    rows.push(row("INFO", "subject", `${objects.length} objects in this document; the criteria below are read from the one covering ${subject["reporting-period"]}`));
  }
  for (const key of Object.keys((isObject(subject.extensions) ? subject.extensions : {}))) {
    if (!isExtensionName(key)) rows.push(row("WARN", "ext-name", `${JSON.stringify(key)} is not a usable extension name`));
  }

  const capExceeded = checkC1(rows, selection);
  checkC2(rows, subject);
  checkC3(rows, subject);
  await checkAttestation(rows, subject, opts);
  checkC4Document(rows, subject, validation.valid);
  checkMeasurement(rows, subject);

  return {
    rows,
    conformant: validation.valid,
    capExceeded,
    exitCode: !validation.valid || capExceeded ? 1 : 0,
  };
}

/** The HTTP half of C4, which needs a live origin. */
export async function checkOrigin(origin, options = {}) {
  const clock = options.clock ?? DEFAULT_CLOCK;
  const fetched = await fetchSustainability(origin, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    lookup: options.lookup,
  });
  if (fetched.status !== "ok") {
    return {
      rows: [row("FAIL", "draft-conformance", `the origin did not serve a declaration: ${fetched.status}`)],
      conformant: false,
      capExceeded: false,
      exitCode: 1,
    };
  }
  const result = await checkDocument(fetched.document, options);
  const report = await runConformanceChecks(origin, options.fetchImpl, {
    now: () => clock,
    timeoutMs: options.timeoutMs,
    lookup: options.lookup,
  });
  const failed = report.checks.filter((c) => c.outcome === "fail");
  const musts = failed.filter((c) => c.level === "MUST");
  result.rows.push(
    musts.length === 0
      ? row("PASS", "C4-origin", `${report.checks.length} checks run against ${report.origin}; every MUST passed`)
      : row("FAIL", "C4-origin", `${musts.length} MUST level checks failed: ${musts.map((c) => c.name).join(", ")}`)
  );
  for (const check of failed.filter((c) => c.level === "SHOULD")) {
    result.rows.push(row("WARN", "C4-origin", `${check.name}: ${check.detail ?? "recommendation not met"}`));
  }
  if (musts.length > 0) {
    result.conformant = false;
    result.exitCode = 1;
  }
  return result;
}

export function formatReport(result, subject) {
  const lines = [`===== ${subject}`];
  for (const r of result.rows) lines.push(`  ${r.status.padEnd(8)} ${r.id.padEnd(22)} ${r.detail}`);
  lines.push("");
  lines.push(
    result.conformant
      ? "  The document conforms to the draft. Everything above marked DECLARED is the publisher's own claim."
      : "  The document does not conform to the draft, so nothing above should be recorded as a report."
  );
  return lines.join("\n");
}

function usage() {
  return [
    "usage: node sfc-check.mjs <https origin or local file> [options]",
    "",
    "  --verify-attestation   fetch the statement at verifiable-attestation-uri and check it (default off)",
    "  --now=<RFC 3339>       the fixed clock the checks read (default 2026-01-01T00:00:00Z)",
    "  --json                 print the rows as JSON instead of text",
    "  --help                 this text",
    "",
    "Exit status: 0 normally, 1 on a draft conformance failure or a C1 exceedance, 2 on a usage error.",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { verifyAttestation: false, json: false, clock: DEFAULT_CLOCK, help: false };
  let subject;
  for (const arg of argv) {
    if (arg === "--verify-attestation") options.verifyAttestation = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--now=")) {
      const when = new Date(arg.slice("--now=".length));
      if (Number.isNaN(when.getTime())) throw new Error(`--now is not a date: ${arg}`);
      options.clock = when;
    } else if (arg.startsWith("-")) throw new Error(`unknown option: ${arg}`);
    else if (subject === undefined) subject = arg;
    else throw new Error("give exactly one origin or file");
  }
  return { subject, options };
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${usage()}\n`);
    return 2;
  }
  const { subject, options } = parsed;
  if (options.help || subject === undefined) {
    process.stdout.write(`${usage()}\n`);
    return options.help ? 0 : 2;
  }
  let result;
  if (/^https:\/\//i.test(subject)) {
    result = await checkOrigin(subject, options);
  } else if (/^http:\/\//i.test(subject)) {
    process.stderr.write("the draft requires https, and a consumer must not accept a declaration fetched over http\n");
    return 2;
  } else {
    let doc;
    try {
      doc = JSON.parse(readFileSync(subject, "utf8"));
    } catch (err) {
      process.stderr.write(`cannot read ${subject}: ${err.message}\n`);
      return 2;
    }
    result = await checkDocument(doc, options);
  }
  process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatReport(result, subject)}\n`);
  return result.exitCode;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
