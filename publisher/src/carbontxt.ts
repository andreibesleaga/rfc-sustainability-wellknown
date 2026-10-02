/**
 * carbon.txt helper (Green Web Foundation).
 *
 * carbon.txt is a discoverable TOML file that *links to* an organisation's
 * sustainability disclosures (reports, certificates, hosting evidence). It is a
 * discovery/disclosure file, not a metrics document — complementary to the
 * `/.well-known/sustainability-data` metrics document this gateway serves.
 *
 * This module:
 *   - `emitCarbonTxt()`     — produce a minimal carbon.txt that points back to a
 *                             `/.well-known/sustainability-data` document (bidirectional
 *                             discovery). Hand-written TOML; no dependency needed.
 *   - `parseCarbonTxt()`    — parse a carbon.txt with the TOML parser.
 *   - `discoverCarbonTxt()` — HTTP lookup precedence (root → well-known → header → www/non-www).
 *
 * Spec: https://carbontxt.org/  ·  v0.5 syntax.
 */
import { parse as parseToml } from "@iarna/toml";

export interface CarbonTxtDisclosure {
  doc_type: string;
  url: string;
  domain?: string;
  valid_until?: string;
  title?: string;
}

export interface CarbonTxtService {
  domain?: string;
  service_type?: string | string[];
}

export interface CarbonTxtDocument {
  version: string;
  last_updated?: string;
  org: { disclosures: CarbonTxtDisclosure[] };
  upstream?: { services: CarbonTxtService[] };
}

export interface EmitCarbonTxtOptions {
  /** Absolute URL of this origin's `/.well-known/sustainability-data` document. */
  sustainabilityUrl: string;
  /** carbon.txt schema version to declare. Default "0.5". */
  version?: string;
  /** ISO date (YYYY-MM-DD) for `last_updated`. */
  lastUpdated?: string;
  /**
   * doc_type for the sustainability disclosure entry. Default "other": the
   * declaration is a machine-readable data file, and carbon.txt's other types
   * (web-page, sustainability-page, annual-report, ...) describe documents.
   */
  docType?: string;
  /** Title for the sustainability disclosure entry. */
  title?: string;
  /** Domain associated with the disclosure. */
  domain?: string;
  /** Additional disclosure entries (reports, certificates, etc.). */
  extraDisclosures?: CarbonTxtDisclosure[];
  /** Upstream hosting/cloud providers. */
  upstreamServices?: CarbonTxtService[];
}

function tomlString(s: string): string {
  return JSON.stringify(s); // valid TOML basic string (handles quotes/escapes)
}

function emitInlineTable(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      parts.push(`${k} = [${v.map((x) => tomlString(String(x))).join(", ")}]`);
    } else {
      parts.push(`${k} = ${tomlString(String(v))}`);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

/**
 * Produce a minimal, valid carbon.txt that lists the origin's
 * `/.well-known/sustainability-data` document as a disclosure (plus any extras).
 */
export function emitCarbonTxt(opts: EmitCarbonTxtOptions): string {
  const version = opts.version ?? "0.5";
  const disclosures: CarbonTxtDisclosure[] = [
    {
      doc_type: opts.docType ?? "other",
      url: opts.sustainabilityUrl,
      ...(opts.domain ? { domain: opts.domain } : {}),
      ...(opts.title ? { title: opts.title } : { title: "Machine-readable sustainability metrics" }),
    },
    ...(opts.extraDisclosures ?? []),
  ];

  const lines: string[] = [];
  lines.push(`version = ${tomlString(version)}`);
  if (opts.lastUpdated) lines.push(`last_updated = ${tomlString(opts.lastUpdated)}`);
  lines.push("");
  lines.push("[org]");
  lines.push("disclosures = [");
  lines.push(
    disclosures
      .map((d) => `  ${emitInlineTable(d as unknown as Record<string, unknown>)}`)
      .join(",\n"),
  );
  lines.push("]");

  if (opts.upstreamServices && opts.upstreamServices.length > 0) {
    lines.push("");
    lines.push("[upstream]");
    lines.push("services = [");
    lines.push(
      opts.upstreamServices
        .map((s) => `  ${emitInlineTable(s as unknown as Record<string, unknown>)}`)
        .join(",\n"),
    );
    lines.push("]");
  }
  return lines.join("\n") + "\n";
}

/** Parse a carbon.txt (TOML) into a typed document. Throws on malformed TOML. */
export function parseCarbonTxt(text: string): CarbonTxtDocument {
  const data = parseToml(text) as any;
  const org = data.org ?? {};
  const disclosures: CarbonTxtDisclosure[] = Array.isArray(org.disclosures) ? org.disclosures : [];
  const doc: CarbonTxtDocument = {
    version: String(data.version ?? ""),
    org: { disclosures },
  };
  if (data.last_updated !== undefined) doc.last_updated = String(data.last_updated);
  if (data.upstream && Array.isArray(data.upstream.services)) {
    doc.upstream = { services: data.upstream.services };
  }
  return doc;
}

export interface DiscoverResult {
  /** The URL the carbon.txt was finally fetched from. */
  url: string;
  /** Raw TOML text. */
  text: string;
  /** Parsed document. */
  document: CarbonTxtDocument;
  /** Which lookup step succeeded. */
  via: "root" | "well-known" | "header";
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const CARBON_TXT_ROOT = "/carbon.txt";
const CARBON_TXT_WELL_KNOWN = "/.well-known/carbon.txt";

/**
 * Discover and parse an origin's carbon.txt following the Green Web
 * Foundation's lookup order (https://carbontxt.org/faq), the part that can be
 * done over HTTP:
 *   1. root `/carbon.txt`
 *   2. `/.well-known/carbon.txt`
 *   3. a `CarbonTxt-Location` header on the origin's home page, pointing elsewhere
 *   4. the same three on the www / non-www variant of the host
 * DNS-TXT (`carbon-txt-location=`) delegation is out of scope here.
 */
export async function discoverCarbonTxt(
  origin: string,
  deps: { fetch?: FetchLike } = {},
): Promise<DiscoverResult | null> {
  const doFetch = (deps.fetch ?? (globalThis.fetch as unknown as FetchLike));
  if (!doFetch) throw new Error("discoverCarbonTxt: no fetch implementation available");
  const base = origin.replace(/\/$/, "");

  const tryOrigin = async (o: string): Promise<DiscoverResult | null> => {
    // 1. root
    const rootUrl = `${o}${CARBON_TXT_ROOT}`;
    const rootRes = await doFetch(rootUrl);
    if (rootRes.ok) {
      const text = await rootRes.text();
      return { url: rootUrl, text, document: parseCarbonTxt(text), via: "root" };
    }
    // 2. well-known
    const wkUrl = `${o}${CARBON_TXT_WELL_KNOWN}`;
    const wkRes = await doFetch(wkUrl);
    if (wkRes.ok) {
      const text = await wkRes.text();
      return { url: wkUrl, text, document: parseCarbonTxt(text), via: "well-known" };
    }
    // 3. delegation header on the home page
    const home = await doFetch(`${o}/`, { method: "HEAD" });
    const header = home.headers.get("CarbonTxt-Location") ?? home.headers.get("carbontxt-location");
    const delegated = header ? new URL(header, `${o}/`).href : null;
    if (delegated) {
      const res = await doFetch(delegated);
      if (res.ok) {
        const text = await res.text();
        return { url: delegated, text, document: parseCarbonTxt(text), via: "header" };
      }
    }
    return null;
  };

  const found = await tryOrigin(base);
  if (found) return found;
  // 4. the www / non-www variant: only for a registered name, and a failure there is "not found"
  const u = new URL(base);
  const h = u.hostname;
  if (h === "localhost" || !h.includes(".") || /^[\d.]+$/.test(h) || h.startsWith("[")) return null;
  u.hostname = h.startsWith("www.") ? h.slice(4) : `www.${h}`;
  if (u.origin === new URL(base).origin) return null;
  try {
    return await tryOrigin(u.origin);
  } catch {
    return null;
  }
}

export { CARBON_TXT_ROOT, CARBON_TXT_WELL_KNOWN };
