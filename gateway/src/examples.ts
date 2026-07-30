/**
 * Wire-format example subjects: every case in the repository's canonical
 * `example-responses/` set, served live under reserved `.example` names.
 *
 * The files in `gateway/examples/` are byte-identical, checked-in copies of
 * `example-responses/` (a test enforces the identity when the sibling
 * directory is present). Each file becomes a served subject through the SAME
 * published publisher pipeline as every other subject — nothing is special-
 * cased except the draft's own array rule:
 *
 *  - a file holding a single object is served as a Basic document;
 *  - a file holding a trend ARRAY is served per the draft's Basic rule — the
 *    parameterless response collapses to the most recent entry, and the full
 *    sorted array is returned only for `?granularity=` requests, and only when
 *    the document itself declares `capabilities: "extended"`. A trend file
 *    declaring "basic" (the organization-trend example) is deliberately served
 *    collapsed: that IS the draft behaviour it demonstrates.
 *
 * Every one of these subjects is synthetic by construction (reserved names,
 * RFC 2606/6761) and is labelled as an example everywhere it is surfaced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Publisher,
  fromWire,
  staticAdapter,
  type SustainabilityMetrics,
} from "sustainability-wellknown-publisher";
import { LIMITS } from "./config";
import {
  canonical,
  isSyntheticDomain,
  lastModifiedFrom,
  publisherForDocument,
  type Subject,
} from "./registry";

export type WireShape = "object" | "array";

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
  /**
   * Granularity honored for this subject's Extended requests. Set only when
   * the document itself declares `capabilities: "extended"`.
   */
  granularity?: "monthly" | "daily";
  /** The served subject (Basic response = `subject.document`). */
  subject: Subject;
  /** One-line explanation of what the case demonstrates. */
  note: string;
}

interface CaseDef {
  file: string;
  domain: string;
  caseName: string;
  note: string;
}

/** The canonical case list. Order is the display order on the index. */
export const WIRE_CASES: CaseDef[] = [
  {
    file: "example-response.json",
    domain: "basic.example",
    caseName: "Basic response",
    note: "The draft's worked Basic example: an origin-wide monthly report.",
  },
  {
    file: "example-response-minimal.json",
    domain: "minimal.example",
    caseName: "Minimal document",
    note: "Mandatory members only — every metric omitted, methodology-uri carries the disclosure.",
  },
  {
    file: "example-response-extended.json",
    domain: "extended.example",
    caseName: "Daily report, path target",
    note: "A daily reporting period for a path-scoped target with extended capabilities declared.",
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
    file: "example-response-organization.json",
    domain: "organization.example",
    caseName: "Organization report",
    note: "An organization-level mapping in the shape the draft's organization example uses.",
  },
  {
    file: "example-response-organization-trend.json",
    domain: "organization-trend.example",
    caseName: "Yearly trend, Basic service",
    note:
      "A multi-year trend file whose document declares capabilities:basic — the Basic " +
      "response therefore collapses to the most recent year, exactly as the draft requires.",
  },
  {
    file: "example-response-product.json",
    domain: "product.example",
    caseName: "Product",
    note: "A physical product as the reporting subject (per-unit footprint).",
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
    file: "example-response_yearly.json",
    domain: "yearly.example",
    caseName: "Monthly series (Extended)",
    note:
      "Twelve monthly entries; Basic collapses to the latest month, " +
      "?granularity=monthly returns the sorted year.",
  },
  {
    file: "example-response-yearly-monthly-target.json",
    domain: "yearly-monthly-target.example",
    caseName: "Monthly series, path target (Extended)",
    note:
      "A short monthly series for a path-scoped target; Basic collapses, " +
      "?granularity=monthly returns the array.",
  },
];

/** Sort entries by reporting-period so fidelity checks ignore serving order. */
function byPeriod(docs: SustainabilityMetrics[]): SustainabilityMetrics[] {
  return [...docs].sort((a, b) =>
    a["reporting-period"] < b["reporting-period"] ? -1 : 1,
  );
}

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

/** The granularity the entries' own period precision calls for. */
function granularityOf(docs: SustainabilityMetrics[]): "monthly" | "daily" {
  const p = docs[0]["reporting-period"];
  return /^\d{4}-\d{2}-\d{2}$/.test(p) ? "daily" : "monthly";
}

async function loadObjectCase(def: CaseDef, document: SustainabilityMetrics): Promise<WireExample> {
  const publisher = publisherForDocument(document);
  const { body } = await publisher.getSerialized({});
  const served = JSON.parse(body) as SustainabilityMetrics;
  if (canonical(served) !== canonical(withDefaultUnits(document))) {
    throw new Error(`examples: ${def.file} does not round-trip through the publisher pipeline`);
  }
  return {
    domain: def.domain,
    file: def.file,
    caseName: def.caseName,
    shape: "object",
    entries: 1,
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

async function loadArrayCase(def: CaseDef, docs: SustainabilityMetrics[]): Promise<WireExample> {
  if (docs.length === 0 || docs.length > LIMITS.maxArrayEntries) {
    throw new Error(`examples: ${def.file} has an unusable entry count (${docs.length})`);
  }
  const capabilities = docs[0].capabilities;
  const publisher = new Publisher(
    staticAdapter({ data: docs.map(fromWire), capabilities }),
    {
      normalize: { version: docs[0].version, target: docs[0].target },
      cacheTtlMs: 365 * 24 * 60 * 60 * 1000,
      // Basic + the granularity variants; the handler ignores unknown values,
      // so the key space stays bounded.
      maxCacheEntries: 8,
    },
  );

  // Basic response: the draft's collapse-to-most-recent rule.
  const { body } = await publisher.getSerialized({});
  const collapsed = JSON.parse(body) as SustainabilityMetrics;
  const newest = withDefaultUnits(byPeriod(docs)[docs.length - 1]);
  if (canonical(collapsed) !== canonical(newest)) {
    throw new Error(
      `examples: ${def.file} Basic response is not the most recent entry\n` +
        `  served: ${canonical(collapsed)}\n  newest: ${canonical(newest)}`,
    );
  }

  // Extended response (only honored when the document declares it).
  let granularity: WireExample["granularity"];
  if (capabilities === "extended") {
    granularity = granularityOf(docs);
    const arr = await publisher.getSerialized({ granularity });
    const servedArr = JSON.parse(arr.body) as SustainabilityMetrics[];
    const expected = byPeriod(docs).map(withDefaultUnits);
    if (!Array.isArray(servedArr) || canonical(byPeriod(servedArr)) !== canonical(expected)) {
      throw new Error(`examples: ${def.file} granularity response does not round-trip`);
    }
  }

  return {
    domain: def.domain,
    file: def.file,
    caseName: def.caseName,
    shape: "array",
    entries: docs.length,
    ...(granularity ? { granularity } : {}),
    subject: {
      domain: def.domain,
      source: `example:${def.file}`,
      synthetic: isSyntheticDomain(def.domain),
      document: collapsed,
      publisher,
      lastModified: lastModifiedFrom(collapsed),
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
    const example = Array.isArray(parsed)
      ? await loadArrayCase(def, parsed)
      : await loadObjectCase(def, parsed);
    if (out.has(example.domain)) {
      throw new Error(`examples: duplicate example domain ${example.domain}`);
    }
    out.set(example.domain, example);
  }
  return out;
}
