/**
 * Subject registry: turns `data/<domain>.json` files into validated, cacheable
 * publishers — one per reporting subject.
 *
 * Every document goes through the *published* `sustainability-wellknown-publisher`
 * pipeline (`fromWire` -> `normalize` -> security -> JTD validation gate ->
 * cache). The gateway deliberately reimplements none of that: if a curated file
 * is not conformant, the process refuses to start rather than serving it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  Publisher,
  fromWire,
  staticAdapter,
  type RawMetrics,
  type SigningOptions,
  type SourceAdapter,
  type SustainabilityMetrics,
} from "sustainability-wellknown-publisher";
import { LIMITS, PUBLIC_BASE_URL } from "./config";

/** Hostname shape accepted as a route segment (also the data-file basename). */
export const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Reserved TLDs whose documents are, by construction, synthetic. Data under
 * these names carries invented figures and is labelled as such everywhere it is
 * surfaced (RFC 2606 / RFC 6761 reserved names).
 */
const SYNTHETIC_TLDS = [".example", ".invalid", ".test", ".localhost"];

export function isSyntheticDomain(domain: string): boolean {
  return SYNTHETIC_TLDS.some((t) => domain.endsWith(t));
}

export interface Subject {
  /** Route key and data-file basename, e.g. "cloudflare.com". */
  domain: string;
  /**
   * Where this document came from: an absolute file path for a curated
   * `data/*.json` subject, or an `adapter:` label for one produced in code.
   */
  source: string;
  /** Whether this subject uses reserved, deliberately synthetic data. */
  synthetic: boolean;
  /** The curated document, exactly as served. */
  document: SustainabilityMetrics;
  /** Publisher wrapping the document (validation gate + ETag + cache). */
  publisher: Publisher;
  /** `Last-Modified`, derived from the document's own `updated` member. */
  lastModified: string;
}

/**
 * The token a data file uses where it must name a declaration THIS gateway
 * serves — today, the `upstream[].declaration` of the downstream demonstration
 * subject, which has to point at the tenant-scoped declaration relayed here.
 *
 * Hard-coding one deployment's host would make the member false everywhere
 * else, and the draft requires an absolute "https" URI, so a relative one is
 * not an option. The token is resolved once at load time against the origin the
 * gateway is actually served from (`BASE_URL`, falling back to the reference
 * deployment), which is what makes a consumer's `--upstream` chain walk resolve
 * to a declaration this gateway really answers.
 */
export const BASE_URL_TOKEN = "{base}";

/**
 * Resolve {@link BASE_URL_TOKEN} in the `upstream[].declaration` members of one
 * parsed data file. Nothing else in the document is templated: a figure, a
 * methodology link or a provider string must read in the file exactly as it is
 * served.
 */
export function resolveBaseUrlToken(doc: SustainabilityMetrics, baseUrl: string): SustainabilityMetrics {
  if (!Array.isArray(doc.upstream)) return doc;
  const base = baseUrl.replace(/\/+$/, "");
  return {
    ...doc,
    upstream: doc.upstream.map((e) =>
      typeof e?.declaration === "string" && e.declaration.startsWith(BASE_URL_TOKEN)
        ? { ...e, declaration: base + e.declaration.slice(BASE_URL_TOKEN.length) }
        : e,
    ),
  };
}

/** Canonical JSON (recursively key-sorted) — used for exact round-trip checks. */
export function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * `Last-Modified` for a document, taken from its `updated` member rather than
 * from the file's mtime: the published document, not the deploy, is what the
 * date describes, and it stays stable across redeploys and replicas.
 */
export function lastModifiedFrom(doc: SustainabilityMetrics): string {
  const d = new Date(doc.updated);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`registry: \`updated\` is not a parseable date-time ("${doc.updated}")`);
  }
  return d.toUTCString();
}

/**
 * Build a Publisher for one already wire-shaped document.
 *
 * Exported so the gateway's own (adapter-produced) report and the file-backed
 * subjects share one code path, and so tests can build a subject in memory.
 */
export function publisherForDocument(doc: SustainabilityMetrics): Publisher {
  const raw: RawMetrics = fromWire(doc);
  return new Publisher(staticAdapter({ data: raw, capabilities: doc.capabilities }), {
    normalize: { target: doc.target },
    // Documents are static and loaded at startup, so the cache never needs to
    // expire during a process lifetime; a single entry is ever created because
    // the gateway serves the Basic service and never varies on the query.
    cacheTtlMs: 365 * 24 * 60 * 60 * 1000,
    maxCacheEntries: 4,
  });
}

/**
 * Parse + bound-check + validate one data file into a Subject.
 *
 * `baseUrl` is the origin this gateway is served from; it resolves the
 * {@link BASE_URL_TOKEN} of an `upstream[].declaration` that names a
 * declaration relayed here.
 */
export async function loadSubjectFile(file: string, baseUrl: string = PUBLIC_BASE_URL): Promise<Subject> {
  const domain = basename(file, ".json").toLowerCase();
  if (!DOMAIN_RE.test(domain) || domain.length > LIMITS.maxDomainLength) {
    throw new Error(
      `registry: "${basename(file)}" is not a usable data file — the basename must be a ` +
        `lowercase domain name (e.g. "example.com.json"); files beginning with "_" are ignored`,
    );
  }

  const bytes = statSync(file).size;
  if (bytes > LIMITS.maxDocumentBytes) {
    throw new Error(
      `registry: ${basename(file)} is ${bytes} bytes, over the ${LIMITS.maxDocumentBytes}-byte ` +
        `document bound (draft Security Considerations: Denial of Service)`,
    );
  }

  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;

  if (Array.isArray(parsed)) {
    // Draft Mandatory Minimum Supported Service, "Format": the response to a
    // parameterless (Basic) request MUST be a single JSON object. Relayed
    // subjects are Basic-only, so a trend file has no way to be served.
    throw new Error(
      `registry: ${basename(file)} is an array. This gateway serves the Basic service, whose ` +
        `response MUST be a single JSON object; publish one object per subject file.`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`registry: ${basename(file)} is not a JSON object`);
  }

  const document = resolveBaseUrlToken(parsed as SustainabilityMetrics, baseUrl);
  const publisher = publisherForDocument(document);

  // The JTD gate + prose-rule checks run inside getSerialized(); a
  // non-conformant curated file therefore fails startup, not a request.
  const { body } = await publisher.getSerialized({});
  if (Buffer.byteLength(body) > LIMITS.maxDocumentBytes) {
    throw new Error(`registry: serialized ${basename(file)} exceeds the response-size bound`);
  }

  // Fidelity check: the gateway must serve exactly the curated, provenance-
  // documented document. If the pipeline would alter it in any way, that is an
  // operator error to fix in the data file, never something to serve silently.
  const served = JSON.parse(body) as SustainabilityMetrics;
  if (canonical(served) !== canonical(document)) {
    throw new Error(
      `registry: ${basename(file)} does not round-trip through the publisher pipeline.\n` +
        `  in  : ${canonical(document)}\n  out : ${canonical(served)}`,
    );
  }

  return {
    domain,
    source: file,
    synthetic: isSyntheticDomain(domain),
    document,
    publisher,
    lastModified: lastModifiedFrom(document),
  };
}

/**
 * Build a Subject from any `SourceAdapter` — the "how would a real organization
 * actually generate this?" path. The document is produced by the adapter at
 * startup, passes the same JTD validation gate as a curated file, and is then
 * served from the same route shape.
 */
export async function subjectFromAdapter(opts: {
  domain: string;
  adapter: SourceAdapter;
  /** Reporting subject; the adapter may override it per report. */
  target: string;
  targetType?: SustainabilityMetrics["target-type"];
  /** Human label recorded as the Subject's `source`. */
  label?: string;
  /** Variant cache lifetime. Default: the process lifetime (static documents). */
  cacheTtlMs?: number;
  /** Bound on cached query variants. Default 4. */
  maxCacheEntries?: number;
  /**
   * Draft -07 §Signing: when set, the publisher embeds a `signed` member in
   * every declaration object it builds — including each object of an Extended
   * trend array. Only the gateway's own report is ever signed here: a relayed
   * document is not the gateway's to vouch for.
   */
  signing?: SigningOptions;
}): Promise<Subject> {
  const domain = opts.domain.toLowerCase();
  if (!DOMAIN_RE.test(domain) || domain.length > LIMITS.maxDomainLength) {
    throw new Error(`registry: "${opts.domain}" is not a usable subject domain`);
  }
  const publisher = new Publisher(opts.adapter, {
    normalize: { target: opts.target, targetType: opts.targetType },
    cacheTtlMs: opts.cacheTtlMs ?? 365 * 24 * 60 * 60 * 1000,
    maxCacheEntries: opts.maxCacheEntries ?? 4,
    ...(opts.signing ? { signing: opts.signing } : {}),
  });
  const { body } = await publisher.getSerialized({});
  if (Buffer.byteLength(body) > LIMITS.maxDocumentBytes) {
    throw new Error(`registry: adapter "${opts.adapter.name}" produced an oversized document`);
  }
  const document = JSON.parse(body) as SustainabilityMetrics;
  if (Array.isArray(document)) {
    throw new Error(
      `registry: adapter "${opts.adapter.name}" produced an array; the Basic service serves a single object`,
    );
  }
  return {
    domain,
    source: opts.label ?? `adapter:${opts.adapter.name}`,
    synthetic: isSyntheticDomain(domain),
    document,
    publisher,
    lastModified: lastModifiedFrom(document),
  };
}

/** Load every `data/*.json` file (skipping `_`-prefixed ones) into a registry. */
export async function loadRegistry(dataDir: string, baseUrl: string = PUBLIC_BASE_URL): Promise<Map<string, Subject>> {
  const files = readdirSync(dataDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort();

  const registry = new Map<string, Subject>();
  for (const f of files) {
    const subject = await loadSubjectFile(join(dataDir, f), baseUrl);
    if (registry.has(subject.domain)) {
      throw new Error(`registry: duplicate subject "${subject.domain}"`);
    }
    registry.set(subject.domain, subject);
  }
  if (registry.size === 0) {
    throw new Error(`registry: no subject documents found in ${dataDir}`);
  }
  return registry;
}
