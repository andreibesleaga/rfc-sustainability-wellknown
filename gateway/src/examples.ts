/**
 * Wire-format example subjects: every case in the repository's canonical
 * `example-responses/` set, served live under reserved `.example` names.
 *
 * The files in `gateway/examples/` are byte-identical, checked-in copies of
 * `example-responses/` (a test enforces the identity when the sibling
 * directory is present). Each file becomes a served subject through the SAME
 * published publisher pipeline as every other subject. The pipeline selects
 * (draft §Query Parameters), so nothing is special-cased except what a request
 * that names no parameter is answered with, which each case declares:
 *
 *  - `object`: the file holds one object, served as that object;
 *  - `latest`: the file holds a series, served as its most recent object (a
 *    choice of this deployment: the draft allows an object or an array there);
 *  - `all`: the file holds objects that belong together, served as the whole
 *    array in the order of the draft.
 *
 * A request that names a parameter is answered by the publisher alone: a case
 * that declares `capabilities: "extended"` returns the objects held that
 * satisfy it (an empty array when none does), and a case that declares
 * `"basic"` ignores the parameters and answers as if none were sent.
 *
 * Every one of these subjects is synthetic by construction (reserved names,
 * RFC 2606/6761) and is labelled as an example everywhere it is surfaced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Publisher,
  compareDateTimes,
  fromWire,
  sortDeclarations,
  staticAdapter,
  toUtcQueryValue,
  wholeCalendarUnit,
  type Granularity,
  type Period,
  type PublisherOptions,
  type SourceAdapter,
  type ServiceQuery,
  type SustainabilityDocument,
  type SustainabilityMetrics,
} from "sustainability-wellknown-publisher";
import { verifyEmbeddedSignature } from "sustainability-wellknown-consumer";
import { LIMITS } from "./config";
import { canonical, isSyntheticDomain, lastModifiedFrom, type Subject } from "./registry";

export type WireShape = "object" | "array";

/** What a request that names no parameter is answered with; see the module comment. */
export type Serving = "object" | "latest" | "all";

export interface WireExample {
  /** Route key, a reserved `.example` name. */
  domain: string;
  /** Source file basename inside `gateway/examples/`. */
  file: string;
  /** Human label for the index page. */
  caseName: string;
  shape: WireShape;
  /** Number of entries (1 for a single object). */
  entries: number;
  serving: Serving;
  /** Whether the document itself declares `capabilities: "extended"`: only then are query parameters honored. */
  extended: boolean;
  /**
   * The calendar unit every entry of an Extended array is whole in, when there
   * is one. Set only for a document that declares `capabilities: "extended"`.
   */
  granularity?: Granularity;
  /** The smallest half-open range, in UTC, that covers every entry of an Extended array. */
  range?: Period;
  /** The served subject (the response to a request that names no parameter is `subject.publisher.getSerialized({})`). */
  subject: Subject;
  /** One-line explanation of what the case demonstrates. */
  note: string;
}

interface CaseDef {
  file: string;
  domain: string;
  caseName: string;
  note: string;
  /** For a file that holds an array: what a request that names no parameter is answered with. */
  serving?: "latest" | "all";
}

/** The canonical case list. Order is the display order on the index. */
export const WIRE_CASES: CaseDef[] = [
  {
    file: "example-response.json",
    domain: "basic.example",
    caseName: "Basic response",
    note: "An origin-wide monthly report in the Basic shape, with explicit units.",
  },
  {
    file: "example-response-minimal.json",
    domain: "minimal.example",
    caseName: "Minimal document",
    note:
      "The smallest conformant object: the seven mandatory members and a disclosure-uri. It " +
      "carries no metric, so the evidence link is what the at-least-one rule requires.",
  },
  {
    file: "example-response-extended.json",
    domain: "extended.example",
    caseName: "One day, path target (Extended)",
    note:
      "A whole calendar day for a path-scoped target, declaring extended capabilities: a request " +
      "that names a parameter is answered with an array, here of one object, or with [] when " +
      "the object does not satisfy it.",
  },
  {
    file: "example-response-unreported.json",
    domain: "partial.example",
    caseName: "Partial reporting",
    note:
      "Omission as the only not-reported mechanism. The source file omits carbon-unit; " +
      "the served document carries the materialized default (gCO2e) — the pipeline " +
      "resolving the draft's default-unit rule.",
  },
  {
    file: "example-response-origin-annual.json",
    domain: "origin-annual.example",
    caseName: "Origin-wide annual report",
    note: "A calendar-year report for a whole origin, from cloud-billing data.",
  },
  {
    file: "example-response-signed.json",
    domain: "signed.example",
    caseName: "Signed declaration, internationalized origin",
    note:
      "The embedded signed member: an Ed25519 JWS over the object without signed, cty " +
      "sustainability-data+json, public key in the header as jwk. It verifies, and proves " +
      "only integrity: a key carried in the header is as self-asserted as the figures. It was " +
      "signed with the public test key of RFC 8032, which protects nothing, so it verifies from " +
      "its header and fails against any pinned key, as it should. The " +
      "origin is an internationalized host, so target and every URI carry its A-label, while " +
      "provider is UTF-8 text.",
  },
  {
    file: "example-response-organization.json",
    domain: "organization.example",
    caseName: "Organization report",
    note: "An organization-level annual report with GHG Protocol scopes and no energy figure.",
  },
  {
    file: "example-response-organization-trend.json",
    domain: "organization-trend.example",
    caseName: "Yearly trend, Basic service",
    serving: "all",
    note:
      "A multi-year trend file whose document declares capabilities:basic. The parameterless " +
      "response is the array of every held year; a Basic subject ignores every parameter.",
  },
  {
    file: "example-response-comprehensive.json",
    domain: "comprehensive.example",
    caseName: "Comprehensive organization report",
    note:
      "Every optional member the format defines that fits an organization, and six " +
      "https-keyed extensions for what it does not define: ISO/IEC 30134 facility KPIs, " +
      "water, waste, hardware circularity, refrigerant and generator emissions, and " +
      "renewable procurement. The extension names are under the example publisher's own " +
      "reserved domain and their definitions are illustrative.",
  },
  {
    file: "example-response-removals.json",
    domain: "removals.example",
    caseName: "Negative scope (removals netted)",
    note:
      "A scope member MAY be negative where the accounting method nets removals; carbon-footprint " +
      "stays gross, so the scopes no longer sum to it and the methodology document explains why. " +
      "Also shows an attestation link for the removals claim; " +
      "the source file omits energy-unit, and the served document carries the materialized kWh.",
  },
  {
    file: "example-response-product.json",
    domain: "product.example",
    caseName: "Product",
    note: "A physical product as the reporting subject (carbon footprint of one unit).",
  },
  {
    file: "example-response-service.json",
    domain: "service.example",
    caseName: "Service",
    note: "A hosted application service as the reporting subject.",
  },
  {
    file: "example-response-tenant.json",
    domain: "tenant.example",
    caseName: "Cloud tenant",
    note: "A single cloud tenant as the reporting subject.",
  },
  {
    file: "example-response-device.json",
    domain: "device.example",
    caseName: "Hardware device",
    note: "A metered edge device as the reporting subject.",
  },
  {
    file: "example-response-data-source.json",
    domain: "data-source.example",
    caseName: "Data source / feed",
    note: "A published data feed as the reporting subject.",
  },
  {
    file: "example-response-upstream-organization.json",
    domain: "upstream-organization.example",
    caseName: "Organization with upstream providers",
    note:
      "The upstream member: an organization naming the tenant-scoped declaration of the " +
      "cloud provider its figures partly derive from, with role:cloud. The URI is a reserved " +
      ".example name, so the chain is illustrative — tenant-demo.example names a declaration " +
      "this gateway really serves.",
  },
  {
    file: "example-response-upstream-tenant.json",
    domain: "upstream-tenant.example",
    caseName: "Tenant-scoped upstream declaration",
    note:
      "The other end of the same pair: what an upstream publishes about ONE customer — " +
      "target-type:tenant and an identifier of the provider's choosing in target. It declares " +
      "extended capabilities, so a request that names a parameter is answered with an array.",
  },
  {
    file: "example-response-upstream-multiple.json",
    domain: "upstream-multiple.example",
    caseName: "Organization with several upstreams",
    note:
      "Three upstream entries, each compared on its own: cloud and cdn name tenant-scoped " +
      "declarations about this customer, which a consumer can compare; electricity names the " +
      "supplier's own totals, for which no comparison is defined. Reserved .example URIs, so " +
      "the chain is illustrative.",
  },
  {
    file: "example-response_yearly.json",
    domain: "yearly.example",
    caseName: "Monthly series (Extended)",
    serving: "latest",
    note:
      "Twelve whole months of 2025; a request that names no parameter gets the latest month. " +
      "?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly returns the twelve.",
  },
  {
    file: "example-response-yearly-monthly-target.json",
    domain: "yearly-monthly-target.example",
    caseName: "Monthly series, path target (Extended)",
    serving: "latest",
    note:
      "A short monthly series for a path-scoped target; no parameter gets the latest month, " +
      "?granularity=monthly the months held.",
  },
  {
    file: "example-response-daily-trend.json",
    domain: "daily-trend.example",
    caseName: "Daily series, device (Extended)",
    serving: "latest",
    note:
      "?start=2026-03-01T00:00:00Z&end=2026-04-01T00:00:00Z&granularity=daily returns every day held, " +
      "here the three days since the device was commissioned; watt-hours and grams. The server " +
      "returns what it holds and sums nothing: the three days are not March.",
  },
  {
    file: "example-response-two-targets.json",
    domain: "two-targets.example",
    caseName: "One array, two targets, a local accounting month",
    serving: "all",
    note:
      "An origin and a path of that origin, each for March 2026 in the +08:00 offset in which the " +
      "operator keeps its accounts; both bounds carry the offset. ?target= selects one, and the two " +
      "objects are ordered by the instant of their start, then end, then target.",
  },
  {
    file: "example-response-accounting-pair.json",
    domain: "accounting-pair.example",
    caseName: "Location-based and market-based",
    serving: "all",
    note:
      "Two objects for one organization and year that differ in carbon-accounting: the location-based " +
      "and the market-based figure. A Basic subject serves both, and neither is the other's total.",
  },
  {
    file: "example-response-functional-units.json",
    domain: "functional-units.example",
    caseName: "Twelve functional units",
    serving: "all",
    note: "One service and year, twelve objects, one for each functional unit of the draft with its score.",
  },
  {
    file: "example-response-unit-grid.json",
    domain: "unit-grid.example",
    caseName: "Twelve months in twelve unit pairs (Extended)",
    serving: "latest",
    note:
      "Every month states the same energy and carbon in its own pair of units (Wh, kWh, MWh, GWh and " +
      "gCO2e, kgCO2e, tCO2e), so a consumer converts before it adds.",
  },
  {
    file: "example-response-dst-month.json",
    domain: "dst-month.example",
    caseName: "A month across a change of clock",
    note:
      "March 2025 for a facility in Paris: the start is +01:00 and the end +02:00, so the period is " +
      "743 hours and still a whole calendar month.",
  },
  {
    file: "example-response-dst-days.json",
    domain: "dst-days.example",
    caseName: "A 23-hour and a 25-hour day (Extended)",
    serving: "latest",
    note: "The two days on which the clocks of Paris changed; each is a whole calendar day in its own offsets.",
  },
  {
    file: "example-response-local-days.json",
    domain: "local-days.example",
    caseName: "Local accounting days (Extended)",
    serving: "latest",
    note: "Three whole days kept in the +08:00 offset of the device's site; a range in UTC selects them by instant.",
  },
  {
    file: "example-response-mixed-offsets.json",
    domain: "mixed-offsets.example",
    caseName: "Two offsets in one array (Extended)",
    serving: "all",
    note:
      "March 2026 twice: a path in -05:00, held first, and an origin in Z. The array is ordered by the " +
      "instant of the start, which is the reverse of the order in the file.",
  },
  {
    file: "example-response-year-and-months.json",
    domain: "year-and-months.example",
    caseName: "A year beside its months (Extended)",
    serving: "all",
    note:
      "Calendar 2025 and its twelve months, held together. granularity=yearly selects the year, " +
      "granularity=monthly the months; a server sums nothing, and adding all thirteen would count the year twice.",
  },
  {
    file: "example-response-target-types.json",
    domain: "target-types.example",
    caseName: "Nine target types",
    serving: "all",
    note: "One object for each of the nine kinds of target the draft lists, with the four measurement methods spread over them.",
  },
  {
    file: "example-response-upstream-roles.json",
    domain: "upstream-roles.example",
    caseName: "Upstream roles",
    note: "An organization with seven upstream entries: one for each of the six roles and one with no role. The URIs do not resolve.",
  },
  {
    file: "example-response-chain-org.json",
    domain: "chain-org.example",
    caseName: "Upstream chain, 1 of 5: organization",
    note:
      "The start of a chain of five declarations. The upstream is a relative reference, resolved against " +
      "the URI this declaration was retrieved from; a walk of depth three stops before the fifth.",
  },
  {
    file: "example-response-chain-tenant.json",
    domain: "chain-tenant.example",
    caseName: "Upstream chain, 2 of 5: tenant",
    note: "What the cloud provider states it delivered to the organization: 320 MWh, tenant-scoped.",
  },
  {
    file: "example-response-chain-host.json",
    domain: "chain-host.example",
    caseName: "Upstream chain, 3 of 5: hosting facility",
    note: "The facility that hosts the provider's servers; it names a colocation as its upstream.",
  },
  {
    file: "example-response-chain-colo.json",
    domain: "chain-colo.example",
    caseName: "Upstream chain, 4 of 5: colocation",
    note: "The colocation hall, which names the electricity supplier.",
  },
  {
    file: "example-response-chain-grid.json",
    domain: "chain-grid.example",
    caseName: "Upstream chain, 5 of 5: electricity supplier",
    note: "The fifth declaration: reachable by its URL, and not by a walk from the organization, which stops at depth three.",
  },
  {
    file: "example-response-chain-inconsistent.json",
    domain: "chain-inconsistent.example",
    caseName: "Upstream figures that disagree",
    note:
      "An organization that states 100 MWh while the tenant declaration says 320 MWh were delivered to it. " +
      "Two self-asserted claims that do not agree: something to look into, not a failure to conform.",
  },
  {
    file: "example-response-loop-a.json",
    domain: "loop-a.example",
    caseName: "Upstream loop, A",
    note: "Names loop-b as its upstream. Each answers normally; only a walk stops.",
  },
  {
    file: "example-response-loop-b.json",
    domain: "loop-b.example",
    caseName: "Upstream loop, B",
    note: "Names loop-a as its upstream: a walk refuses the second retrieval of loop-a.",
  },
  {
    file: "example-response-signed-array.json",
    domain: "signed-array.example",
    caseName: "Three signed months (Extended)",
    serving: "latest",
    note:
      "Three monthly objects, each with its own embedded signature, so a selection of them is still signed: " +
      "the gateway serves the signed bytes and never signs a selection itself. Each verifies against the key " +
      "in its own header (the public test key of RFC 8032).",
  },
  {
    file: "example-response-signed-es256.json",
    domain: "signed-es256.example",
    caseName: "Signed with ES256",
    note: "One object signed with ES256 (ECDSA P-256), the other algorithm a consumer verifies.",
  },
];

/**
 * The one divergence the fidelity check permits: the publisher pipeline
 * materializes the draft's DEFAULT units ("kWh" / "gCO2e") when a value member
 * is present without its unit member. That is semantics-preserving by
 * definition — it is precisely what the omission means — and serving the
 * resolved form is itself the demonstration of the default rule. Everything
 * else must match byte-for-byte.
 */
function withDefaultUnits(doc: SustainabilityMetrics): SustainabilityMetrics {
  const out = { ...doc };
  if (out["energy-consumption"] !== undefined && out["energy-unit"] === undefined) {
    out["energy-unit"] = "kWh";
  }
  if (out["carbon-footprint"] !== undefined && out["carbon-unit"] === undefined) {
    out["carbon-unit"] = "gCO2e";
  }
  return out;
}

const withoutSigned = (doc: SustainabilityMetrics): SustainabilityMetrics => {
  const { signed: _signed, ...rest } = doc;
  return rest;
};

/**
 * A wire-format example that arrives already signed. The gateway holds no key
 * for it and never signs on its behalf: it serves each object's own `signed`
 * member, and only on an object equal to the payload that member was made
 * over, so the draft's rule that a publisher never serves an object whose
 * `signed` payload differs from the object it accompanies holds on every path,
 * whichever selection of the objects a request makes.
 */
class PresignedPublisher extends Publisher {
  constructor(
    adapter: SourceAdapter,
    options: PublisherOptions,
    /** The signed value of each object, keyed by the canonical form of the payload it was made over. */
    private readonly signatures: ReadonlyMap<string, string>,
  ) {
    super(adapter, options);
  }

  override async build(query: ServiceQuery = {}): Promise<SustainabilityDocument> {
    const document = await super.build(query);
    const attach = (object: SustainabilityMetrics): SustainabilityMetrics => {
      const signed = this.signatures.get(canonical(object));
      return signed === undefined ? object : { ...object, signed };
    };
    return Array.isArray(document) ? document.map(attach) : attach(document);
  }
}

/**
 * Check pre-signed objects before they can be served: each must verify, over
 * exactly the object it accompanies. Returns the signed value of each, keyed
 * by the canonical form of its payload, or `undefined` when no object is signed.
 */
async function presignedValues(def: CaseDef, docs: SustainabilityMetrics[]): Promise<Map<string, string> | undefined> {
  const signedCount = docs.filter((d) => d.signed !== undefined).length;
  if (signedCount === 0) return undefined;
  if (signedCount !== docs.length) throw new Error(`examples: ${def.file} signs some of its objects and not others`);
  const values = new Map<string, string>();
  for (const document of docs) {
    const { signed, ...unsigned } = document;
    if (typeof signed !== "string") throw new Error(`examples: ${def.file} has a signed member that is not a string`);
    const outcome = await verifyEmbeddedSignature(document);
    if (outcome.result.status !== "verified") {
      throw new Error(`examples: ${def.file} signature does not verify (${JSON.stringify(outcome.result)})`);
    }
    const payload = canonical(JSON.parse(Buffer.from(signed.split(".")[1], "base64url").toString("utf8")));
    if (payload !== canonical(unsigned)) {
      throw new Error(`examples: ${def.file} signed payload differs from the object it accompanies`);
    }
    // The pipeline materializes default units, which would make the served
    // object differ from the payload: a signed example declares its units.
    if (canonical(withDefaultUnits(unsigned)) !== payload) {
      throw new Error(`examples: ${def.file} is signed, so it must declare energy-unit and carbon-unit explicitly`);
    }
    values.set(payload, signed);
  }
  return values;
}

/** The smallest half-open range, in UTC, that covers every period: the earliest start to the latest end. */
export function coveringRange(periods: Period[]): Period {
  const start = periods.map((p) => p.start).reduce((a, b) => (compareDateTimes(a, b) <= 0 ? a : b));
  const end = periods.map((p) => p.end).reduce((a, b) => (compareDateTimes(a, b) >= 0 ? a : b));
  return { start: toUtcQueryValue(start), end: toUtcQueryValue(end) };
}

/** The calendar unit every period is whole in, or `undefined` when they are not all whole in one. */
function commonUnit(periods: Period[]): Granularity | undefined {
  const units = new Set(periods.map((p) => wholeCalendarUnit(p)));
  const [only] = units;
  return units.size === 1 ? only : undefined;
}

const ownBody = (docs: SustainabilityMetrics[]): string => canonical(docs);

async function loadCase(def: CaseDef, parsed: SustainabilityMetrics | SustainabilityMetrics[]): Promise<WireExample> {
  const isArray = Array.isArray(parsed);
  const docs = isArray ? parsed : [parsed];
  if (docs.length === 0 || docs.length > LIMITS.maxArrayEntries) {
    throw new Error(`examples: ${def.file} has an unusable entry count (${docs.length})`);
  }
  if (isArray && def.serving === undefined) throw new Error(`examples: ${def.file} holds an array, so its case must say how it is served`);
  const serving: Serving = isArray ? (def.serving as "latest" | "all") : "object";
  const extended = docs[0].capabilities === "extended";

  const signatures = await presignedValues(def, docs);
  const held = docs.map(withoutSigned);
  const options: PublisherOptions = {
    normalize: { target: docs[0].target },
    representation: serving === "all" ? "array" : "single",
    cacheTtlMs: 365 * 24 * 60 * 60 * 1000,
    // The parameterless answer, a range, a granularity and a few selections;
    // the publisher keys its cache on the honored values only, so it is bounded.
    maxCacheEntries: 8,
  };
  const adapter = staticAdapter({
    data: isArray ? held.map((d) => fromWire(d, { legacyCompat: false })) : fromWire(held[0], { legacyCompat: false }),
    capabilities: docs[0].capabilities,
  });
  const publisher = signatures ? new PresignedPublisher(adapter, options, signatures) : new Publisher(adapter, options);

  // The response to a request that names no parameter.
  const sorted = sortDeclarations(held.map(withDefaultUnits));
  const { body } = await publisher.getSerialized({});
  const served = JSON.parse(body) as SustainabilityMetrics | SustainabilityMetrics[];
  const expected = serving === "all" ? sorted : sorted[sorted.length - 1];
  const servedPlain = Array.isArray(served) ? served.map(withoutSigned) : withoutSigned(served);
  if (canonical(servedPlain) !== canonical(expected)) {
    throw new Error(
      `examples: ${def.file} is not served as declared (${serving})\n` +
        `  served  : ${canonical(servedPlain)}\n  expected: ${canonical(expected)}`,
    );
  }
  if (signatures) {
    for (const o of Array.isArray(served) ? served : [served]) {
      if (typeof o.signed !== "string") throw new Error(`examples: ${def.file} lost the signature of an object it serves`);
    }
  }

  let granularity: Granularity | undefined;
  let range: Period | undefined;
  if (extended) {
    // The range that covers every entry selects every entry, with or without
    // the unit they share: the server returns what it holds and computes nothing.
    const periods = held.map((d) => d.period);
    range = coveringRange(periods);
    granularity = commonUnit(periods);
    for (const query of [{ start: range.start, end: range.end }, ...(granularity ? [{ start: range.start, end: range.end, granularity }] : [])]) {
      const arr = JSON.parse((await publisher.getSerialized(query)).body) as SustainabilityMetrics[];
      if (!Array.isArray(arr) || canonical(arr.map(withoutSigned)) !== ownBody(sorted)) {
        throw new Error(`examples: ${def.file} does not return its ${sorted.length} object(s) for ${JSON.stringify(query)}`);
      }
    }
  } else {
    // A Basic document ignores every parameter: the answer, ETag included, is the bare one.
    const withQuery = await publisher.getSerialized({ start: "2000-01-01T00:00:00Z", granularity: "monthly", target: "/ignored" });
    if (withQuery.body !== body) throw new Error(`examples: ${def.file} declares basic capabilities but its answer varies with the query`);
  }

  const document = Array.isArray(served) ? served[served.length - 1] : served;
  return {
    domain: def.domain,
    file: def.file,
    caseName: def.caseName,
    shape: isArray ? "array" : "object",
    entries: docs.length,
    serving,
    extended,
    ...(granularity ? { granularity } : {}),
    ...(range ? { range } : {}),
    subject: {
      domain: def.domain,
      source: `example:${def.file}`,
      synthetic: isSyntheticDomain(def.domain),
      document,
      publisher,
      lastModified: lastModifiedFrom(document),
    },
    note: def.note,
  };
}

/** Load every wire-format case from `dir`, keyed by domain. Fails loudly. */
export async function loadWireExamples(dir: string): Promise<Map<string, WireExample>> {
  const out = new Map<string, WireExample>();
  for (const def of WIRE_CASES) {
    const raw = readFileSync(join(dir, def.file), "utf8");
    if (Buffer.byteLength(raw) > LIMITS.maxDocumentBytes) {
      throw new Error(`examples: ${def.file} exceeds the document size bound`);
    }
    const parsed = JSON.parse(raw) as SustainabilityMetrics | SustainabilityMetrics[];
    const example = await loadCase(def, parsed);
    if (out.has(example.domain)) {
      throw new Error(`examples: duplicate example domain ${example.domain}`);
    }
    out.set(example.domain, example);
  }
  return out;
}
