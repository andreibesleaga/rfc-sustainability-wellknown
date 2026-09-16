/**
 * The one way this package retrieves anything over the network.
 *
 * Draft -07 §Mandatory Minimum Supported Service: the declaration "MUST be
 * published and retrieved over HTTPS", and "a consumer that follows a redirect
 * MUST require HTTPS on every hop". The rule is about hops, so redirects are
 * followed here by hand: each `Location` is checked BEFORE it is requested,
 * and a hop that fails the rule is never fetched (nothing is sent to an origin
 * the rules exclude). `sameOrigin` pins a fetch to one origin for callers that
 * need it.
 *
 * §Consumer Considerations adds the other half of that check: a consumer
 * "SHOULD bound the time, size, and redirects of every fetch, including those
 * of upstream declarations, and SHOULD refuse URIs that resolve to private or
 * link-local addresses, since dereferencing URIs from an untrusted document
 * exposes it to server-side request forgery". Every URI this package
 * dereferences comes out of a document some other origin wrote — the
 * declaration's own `methodology-uri`, `disclosure-uri`,
 * `verifiable-attestation-uri` and `upstream[].declaration`, and every
 * `Location` on the way — so {@link addressRefusal} resolves each hop's host
 * and refuses it before the request when it lands inside the network the
 * consumer is running on. `lookup` makes the resolver injectable, so a test
 * pins it and no suite ever touches live DNS.
 *
 * Bodies are read with a running byte cap and the exact octets are kept.
 */
import { BlockList, isIP } from "node:net";
import { lookup as systemLookup } from "node:dns/promises";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * The address ranges a fetch is refused for. Each is a place a URI in a
 * third-party document has no business pointing at, and each is one of the
 * classes §Consumer Considerations names — "private or link-local" — read
 * together with the loopback and unspecified addresses that are the same hazard
 * by another name.
 *
 * IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`, and the `::ffff:a00:1` form a
 * URL normalizes it to) are covered by `BlockList` itself, which compares them
 * against the IPv4 rules; both spellings have a test.
 */
const BLOCKED_ADDRESSES = new BlockList();
BLOCKED_ADDRESSES.addSubnet("0.0.0.0", 8, "ipv4"); // "this host on this network" (RFC 1122)
BLOCKED_ADDRESSES.addSubnet("10.0.0.0", 8, "ipv4"); // private (RFC 1918)
BLOCKED_ADDRESSES.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
BLOCKED_ADDRESSES.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (RFC 3927)
BLOCKED_ADDRESSES.addSubnet("172.16.0.0", 12, "ipv4"); // private (RFC 1918)
BLOCKED_ADDRESSES.addSubnet("192.168.0.0", 16, "ipv4"); // private (RFC 1918)
BLOCKED_ADDRESSES.addAddress("::", "ipv6"); // unspecified
BLOCKED_ADDRESSES.addAddress("::1", "ipv6"); // loopback
BLOCKED_ADDRESSES.addSubnet("fc00::", 7, "ipv6"); // unique-local (RFC 4193)
BLOCKED_ADDRESSES.addSubnet("fe80::", 10, "ipv6"); // link-local (RFC 4291)

/**
 * True when an IP address literal is one this package refuses to fetch from.
 * Exported so a caller can apply the same rule to a URI of its own before
 * handing it over.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return BLOCKED_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Resolves a host name to the addresses it points at.
 *
 * Injectable for one reason above all: a test that pins it needs no DNS at all,
 * so a suite stays deterministic and offline while still exercising the guard
 * against whatever addresses it wants to pretend a name resolves to. The
 * default is the system resolver, asked for every address it has.
 */
export type AddressLookup = (hostname: string) => Promise<readonly string[]>;

/** The default {@link AddressLookup}: the system resolver, all addresses. */
export const systemAddressLookup: AddressLookup = async (hostname) =>
  (await systemLookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export interface SecureGetOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  allowInsecure?: boolean;
  headers?: Record<string, string>;
  /** When set, every hop must stay on this origin. */
  sameOrigin?: string;
  /**
   * Resolve host names with this instead of the system resolver
   * ({@link systemAddressLookup}). A literal IP host is never looked up at all.
   */
  lookup?: AddressLookup;
  /**
   * Opt out of the address check (default: the value of `allowInsecure`).
   *
   * The two travel together because they describe one situation: a consumer
   * pointed at a local development server or a CI fixture on `127.0.0.1` needs
   * both the plain-HTTP exemption and the loopback one, and a consumer pointed
   * at the open internet wants neither. Set this one on its own to reach a
   * private address over HTTPS — an origin on the deployment's own network,
   * say — while keeping the transport requirement.
   */
  allowPrivateAddresses?: boolean;
}

/** A refusal decided by the transport rules, before or after the request. */
export interface TransportRefusal {
  reason:
    | "insecure-transport"
    | "cross-origin-redirect"
    | "too-many-redirects"
    | "timeout"
    | "network-error"
    /** The host is, or resolves to, a loopback/private/link-local/unique-local/unspecified address. */
    | "blocked-address"
    /** The URI carries userinfo, which this package will not put on the wire. */
    | "userinfo-in-uri";
  detail?: string;
  /** The URL the refusal is about (the offending hop). */
  url: string;
}

export type SecureGetResult = { ok: true; res: Response; url: URL; redirected: boolean } | { ok: false; refusal: TransportRefusal };

/** True for an AbortSignal.timeout() firing (or any other abort) surfacing as an error. */
export function isAbortOrTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** The rule every hop must pass; `undefined` when it does. */
function hopRefusal(url: URL, opts: SecureGetOptions, redirected: boolean): TransportRefusal | undefined {
  if (!opts.allowInsecure && url.protocol !== "https:") {
    return {
      reason: "insecure-transport",
      url: url.toString(),
      detail:
        `refusing to retrieve ${url.toString()} over "${url.protocol.replace(/:$/, "")}"` +
        `${redirected ? " (reached through a redirect)" : ""}: the draft requires HTTPS on every hop ` +
        `(pass allowInsecure: true to override, for local development only)`,
    };
  }
  if (opts.sameOrigin !== undefined && url.origin !== opts.sameOrigin) {
    return {
      reason: "cross-origin-redirect",
      url: url.toString(),
      detail: `resource redirected to ${url.origin}, not the document's origin ${opts.sameOrigin}`,
    };
  }
  // Userinfo. Unconditional, and not covered by any of the opt-outs: a
  // declaration is public, unauthenticated data, so a URI in one has no reason
  // to carry credentials, and putting them on the wire — or into a redirect
  // chain, a log line, or a `Referer` — is a hazard with no upside. `https://`
  // and the address check are about WHERE a request goes; this is about what
  // travels with it.
  if (url.username !== "" || url.password !== "") {
    return {
      reason: "userinfo-in-uri",
      url: `${url.protocol}//${url.host}${url.pathname}${url.search}`,
      detail:
        `refusing to retrieve a URI carrying userinfo (credentials before "@" in the authority): a declaration ` +
        `is public, unauthenticated data, and this consumer does not put credentials from a third-party ` +
        `document on the wire`,
    };
  }
  return undefined;
}

/**
 * The address half of the hop check, separate because it may need the network.
 *
 * Draft -07 §Consumer Considerations: a consumer "SHOULD refuse URIs that
 * resolve to private or link-local addresses, since dereferencing URIs from an
 * untrusted document exposes it to server-side request forgery". Applied to
 * every hop BEFORE it is requested, so nothing is ever sent to an address the
 * rule excludes — including a `Location` that points inward from an origin that
 * answered the first hop honestly.
 *
 * A literal IP host is checked as it stands, with no lookup. A name is resolved
 * through `lookup`, and ONE blocked address among the answers is enough to
 * refuse: a name that resolves to both a public and a private address is the
 * shape a rebinding attack takes, and there is no reading under which following
 * it is what the caller wanted.
 *
 * A lookup that fails is NOT a refusal here: it becomes the ordinary
 * `network-error` a caller already gets when a host does not resolve, which is
 * what `fetch` itself would have produced a moment later.
 *
 * What it cannot close is the gap between this resolution and the one `fetch`
 * performs — a name whose answer changes in between (DNS rebinding) is resolved
 * twice and only the first answer is checked. Closing that needs the request
 * pinned to the address that was checked, which the platform `fetch` gives no
 * way to do; a deployment that must be proof against it puts an egress proxy in
 * front of this package.
 */
async function addressRefusal(url: URL, opts: SecureGetOptions): Promise<TransportRefusal | undefined> {
  if (opts.allowPrivateAddresses ?? opts.allowInsecure) return undefined;
  // A URL keeps an IPv6 literal in brackets; the address itself is inside them.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  let addresses: readonly string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await (opts.lookup ?? systemAddressLookup)(host);
    } catch (err) {
      return {
        reason: "network-error",
        url: url.toString(),
        detail: `could not resolve ${host}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  const blocked = addresses.filter((address) => isBlockedAddress(address));
  if (blocked.length === 0) return undefined;
  return {
    reason: "blocked-address",
    url: url.toString(),
    detail:
      `refusing to retrieve ${url.toString()}: ${isIP(host) !== 0 ? "the host is" : `${host} resolves to`} ` +
      `${blocked.join(", ")}, ${blocked.length > 1 ? "which are" : "which is"} a loopback, private, link-local, ` +
      `unique-local or unspecified address. The draft has a consumer refuse URIs that resolve to such addresses, ` +
      `since dereferencing a URI out of an untrusted document otherwise turns this consumer into a probe for the ` +
      `network it runs on (pass allowPrivateAddresses: true to override)`,
  };
}

/**
 * GET `url`, following at most five redirects, checking each hop against the
 * transport rules before requesting it. The returned response is unread.
 */
export async function secureGet(url: URL, opts: SecureGetOptions): Promise<SecureGetResult> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (!doFetch) throw new Error("no fetch implementation available; pass options.fetchImpl");
  let current = url;
  let redirected = false;
  for (let hop = 0; ; hop++) {
    const refused = hopRefusal(current, opts, redirected) ?? (await addressRefusal(current, opts));
    if (refused) return { ok: false, refusal: refused };

    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        method: "GET",
        headers: opts.headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (isAbortOrTimeout(err)) return { ok: false, refusal: { reason: "timeout", url: current.toString() } };
      return {
        ok: false,
        refusal: { reason: "network-error", url: current.toString(), detail: err instanceof Error ? err.message : String(err) },
      };
    }

    const location = res.headers.get("location");
    if (REDIRECT_STATUSES.has(res.status) && location !== null) {
      await res.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS) {
        return { ok: false, refusal: { reason: "too-many-redirects", url: current.toString(), detail: `more than ${MAX_REDIRECTS} redirects` } };
      }
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, refusal: { reason: "network-error", url: current.toString(), detail: `unparseable Location "${location}"` } };
      }
      redirected = true;
      continue;
    }

    // A fetch implementation that followed redirects itself (a stand-in, or a
    // runtime ignoring `redirect: "manual"`) reports only the final URL:
    // apply the same rules to it.
    if (typeof res.url === "string" && res.url !== "" && res.url !== current.toString()) {
      let finalUrl: URL | undefined;
      try {
        finalUrl = new URL(res.url);
      } catch {
        finalUrl = undefined;
      }
      if (finalUrl) {
        const refusedFinal = hopRefusal(finalUrl, opts, true) ?? (await addressRefusal(finalUrl, opts));
        if (refusedFinal) {
          await res.body?.cancel().catch(() => undefined);
          return { ok: false, refusal: refusedFinal };
        }
        current = finalUrl;
        redirected = redirected || res.redirected === true;
      }
    }
    return { ok: true, res, url: current, redirected };
  }
}

/** Marker: the response body exceeded the configured byte cap. */
export class BodyTooLargeError extends Error {
  constructor(
    readonly bytes: number,
    readonly maxBytes: number,
    message = `response body exceeds maxBytes (${maxBytes}): read at least ${bytes} bytes`,
  ) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Read a response body with a running byte cap, aborting as soon as the cap is
 * exceeded so an oversized (or chunked, or Content-Length-lying) body is never
 * fully buffered. An advertised oversized Content-Length is refused unread.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<{ bytes: Uint8Array; text: string }> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(declared, maxBytes, `Content-Length ${declared} exceeds maxBytes ${maxBytes}`);
  }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    // No stream to read (a stand-in Response): the octets are still kept as served.
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new BodyTooLargeError(bytes.byteLength, maxBytes);
    return { bytes, text: bytes.toString("utf8") };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError(total, maxBytes);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, text: bytes.toString("utf8") };
}

/** Release a response body we will not read. */
export async function discardBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined);
}
