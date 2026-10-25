/**
 * Disclosure link helpers. Passive by design: `resolveDisclosureLinks` never
 * makes a network call — the draft's own posture is "MUST NOT treat as proof",
 * and auto-fetching arbitrary third-party URLs found inside an unsolicited
 * document is an SSRF-shaped footgun. `fetchDisclosure` exists only for a
 * caller that explicitly opts in.
 */
import { AddressLookup, discardBody, readBodyCapped, secureGet } from "./transport";
import { SustainabilityMetrics } from "./types";

export interface DisclosureLinks {
  disclosureUri?: string;
  attestationUri?: string;
  /** Members whose value could not be resolved against the base; they are reported and never retrieved. */
  unresolved?: string[];
}

/**
 * The two link members of an object, as absolute URIs. Both are URI references
 * (RFC 3986, Section 4.1), so with `base`, the retrieval URI of the declaration
 * (`FetchResult.url`, after any redirect), a relative reference is resolved
 * against it; without one the values are returned as published.
 */
export function resolveDisclosureLinks(doc: SustainabilityMetrics, base?: string): DisclosureLinks {
  const links: DisclosureLinks = {};
  const unresolved: string[] = [];
  for (const [member, key] of [
    ["disclosure-uri", "disclosureUri"],
    ["verifiable-attestation-uri", "attestationUri"],
  ] as const) {
    const value = doc[member];
    if (typeof value !== "string") continue;
    if (base === undefined) {
      links[key] = value;
      continue;
    }
    try {
      links[key] = new URL(value, base).toString();
    } catch {
      unresolved.push(member);
    }
  }
  if (unresolved.length > 0) links.unresolved = unresolved;
  return links;
}

/** What a disclosure link led to: the bytes as served, in whatever format, with their media type. */
export interface DisclosureContent {
  /** The absolute URL requested (the reference resolved against the retrieval URI). */
  url: string;
  /** The `Content-Type` of the response; `null` when it carried none. */
  mediaType: string | null;
  bytes: Uint8Array;
  /** The bytes read as UTF-8, for a format that is text. */
  text: string;
}

/** The link could not be retrieved; the declaration it came from is unaffected. */
export class DisclosureError extends Error {
  constructor(
    message: string,
    /** The HTTP status when the origin answered with a non-200 one. */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DisclosureError";
  }
}

export interface FetchDisclosureOptions {
  /**
   * The retrieval URI of the declaration that carries the reference, which a
   * relative reference is resolved against (RFC 3986, Section 5.1.3).
   */
  base?: string;
  /** Resolver for the address check; see {@link AddressLookup}. */
  lookup?: AddressLookup;
  /**
   * Opt out of refusing a URI that resolves to a loopback, private, link-local,
   * unique-local or unspecified address (default false). A `disclosure-uri`
   * comes out of a third-party document, so the check is on by default here
   * even though this function is already explicit, caller-invoked and never
   * automatic.
   */
  allowPrivateAddresses?: boolean;
  /** Per-request timeout (ms); default 30 000. */
  timeoutMs?: number;
}

/**
 * Explicit, caller-invoked retrieval of a disclosure or attestation link.
 * Never called automatically, and nothing is concluded from what it returns.
 *
 * The reference is resolved against `options.base` first, and only an `https`
 * URI is dereferenced: any other scheme is refused BEFORE a request is made, so
 * `file:`, `data:` and friends never reach the fetch implementation. The same
 * transport rules as for the declaration apply to every hop. A link that
 * cannot be retrieved throws a {@link DisclosureError} (or the transport's
 * refusal) and changes nothing about the declaration.
 */
export async function fetchDisclosure(
  uri: string,
  fetchImpl?: typeof fetch,
  options: FetchDisclosureOptions = {},
): Promise<DisclosureContent> {
  let parsed: URL;
  try {
    parsed = new URL(uri, options.base);
  } catch {
    throw new DisclosureError(
      `fetchDisclosure: "${uri}" is not a URI reference that resolves to an absolute URI` +
        (options.base === undefined ? " (no retrieval URI was given to resolve it against)" : ` against ${options.base}`),
    );
  }
  if (parsed.protocol !== "https:") {
    throw new DisclosureError(
      `fetchDisclosure: refusing to dereference "${parsed.toString()}": this consumer dereferences only https URIs`,
    );
  }
  const got = await secureGet(parsed, {
    fetchImpl,
    timeoutMs: options.timeoutMs ?? 30_000,
    lookup: options.lookup,
    allowPrivateAddresses: options.allowPrivateAddresses,
    headers: { Accept: "*/*" },
  });
  if (!got.ok) {
    throw new DisclosureError(`fetchDisclosure: ${parsed}: ${got.refusal.reason}${got.refusal.detail ? ` (${got.refusal.detail})` : ""}`);
  }
  if (got.res.status !== 200) {
    await discardBody(got.res);
    throw new DisclosureError(`fetchDisclosure: ${parsed} responded ${got.res.status}`, got.res.status);
  }
  const mediaType = got.res.headers.get("content-type");
  const { bytes, text } = await readBodyCapped(got.res, MAX_DISCLOSURE_BYTES);
  return { url: parsed.toString(), mediaType, bytes, text };
}

/** A disclosure page is read for a person; one megabyte bounds a hostile one. */
const MAX_DISCLOSURE_BYTES = 1_048_576;
