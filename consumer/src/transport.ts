/**
 * The one way this package retrieves anything over the network.
 *
 * Draft -10 §Location and Transport: a declaration "MUST be published and
 * retrieved over HTTPS". §Security Considerations adds that a consumer SHOULD
 * "bound the time, size, and redirects of every fetch, dereference only
 * 'https' references, and refuse a loopback, private, or link-local address at
 * every connection it makes, redirects included". Every URI this package
 * dereferences comes out of a document some other origin wrote (the
 * declaration's own `methodology-uri`, `disclosure-uri`,
 * `verifiable-attestation-uri` and `upstream[].declaration`, and every
 * `Location` on the way), so the rules are applied to every hop:
 *
 *  - Redirects are followed here by hand (`redirect: "manual"`, at most five).
 *    Each `Location` is checked BEFORE it is requested, so nothing is sent to
 *    an origin the rules exclude. `sameOrigin` pins a fetch to one origin.
 *  - The address is checked where the connection is made. The request goes
 *    through an undici `Agent` whose `connect.lookup` is the resolver and the
 *    check in one: the addresses it approves are the addresses the socket may
 *    use, so a name that resolves differently a moment later (DNS rebinding)
 *    cannot change the answer after the check. Only an address whose
 *    ipaddr.js range is `unicast` passes, after `::ffff:a.b.c.d` is unwrapped
 *    and the IPv4 address inside a NAT64 `64:ff9b::/96` address is tested in
 *    its place. A literal IP host never reaches the lookup, so it is checked
 *    before the connection instead.
 *  - Certificate and host name are verified on every https connection. There
 *    is no option that turns that off; `ca` only adds a certificate authority
 *    to the ones that are trusted.
 *
 * `lookup` makes the resolver injectable, so a test pins it and no suite ever
 * touches live DNS. A caller that passes its own `fetchImpl` (a stand-in in a
 * test) opens no connection through this module, so the connect-time check
 * does not apply to it; the scheme, user-information and literal-address
 * rules still do.
 *
 * Bodies are read with a running byte cap and the exact octets are kept.
 */
import { isIP, type LookupFunction } from "node:net";
import { lookup as systemLookup } from "node:dns/promises";
import { rootCertificates } from "node:tls";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Whether `address` may be connected to: its ipaddr.js range is `unicast`.
 * That excludes loopback, private, link-local, unique-local, unspecified,
 * carrier-grade NAT, reserved, multicast and broadcast addresses, and also
 * 6to4 and Teredo, which carry an IPv4 address that is not the host's.
 *
 * `::ffff:a.b.c.d` is read as the IPv4 address it wraps. A NAT64 address
 * (`64:ff9b::/96`) is read as the IPv4 address in its last 32 bits, because on
 * an IPv6-only network a resolver answers real sites that way; refusing the
 * range would block them, while testing the embedded address blocks
 * `64:ff9b::7f00:1`. Anything that is not an IP address is not allowed.
 */
function isUnicast(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let parsed = ipaddr.process(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.range() === "rfc6052") {
    const [high, low] = parsed.parts.slice(6);
    parsed = new ipaddr.IPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return parsed.range() === "unicast";
}

/** Whether `address` is a loopback address (`::ffff:127.0.0.1` read as the IPv4 address it wraps). */
function isLoopback(address: string): boolean {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === "loopback";
}

/** `allowInsecure` lifts the address check for loopback; an explicit `allowPrivateAddresses: false` keeps even that. */
function loopbackAllowed(opts: SecureGetOptions): boolean {
  return opts.allowInsecure === true && opts.allowPrivateAddresses !== false;
}

/** Whether a connection to `address` is allowed: public unicast, or loopback when `allowLoopback` is set. */
function addressPermitted(address: string, allowLoopback: boolean): boolean {
  return isUnicast(address) || (allowLoopback && isLoopback(address));
}

/**
 * True when an IP address literal is one this package refuses to connect to.
 * Exported so a caller can apply the same rule to a URI of its own before
 * handing it over. A string that is not an IP address is not blocked here: a
 * name is judged by the addresses it resolves to.
 */
export function isBlockedAddress(address: string): boolean {
  const host = address.replace(/^\[(.*)\]$/, "$1");
  return isIP(host) !== 0 && !isUnicast(host);
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
  /** A stand-in for the transport (tests). Without it the request goes through undici with the connect-time check. */
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  allowInsecure?: boolean;
  headers?: Record<string, string>;
  /** When set, every hop must stay on this origin. */
  sameOrigin?: string;
  /**
   * Resolve host names with this instead of the system resolver
   * ({@link systemAddressLookup}). It is the resolver of the connection, asked
   * once per connection; a literal IP host is never looked up at all.
   */
  lookup?: AddressLookup;
  /**
   * Opt out of the address check altogether (default false). `allowInsecure`
   * permits the http scheme and loopback addresses only, for a local test
   * server; private, link-local and the other refused ranges stay refused
   * unless this is set (an explicit false keeps loopback refused too), which is the way to reach an origin on the
   * deployment's own network deliberately.
   */
  allowPrivateAddresses?: boolean;
  /**
   * Certificate authorities to trust in addition to the system's, as PEM text.
   * For an origin on a private PKI. Certificate and host name verification
   * stay on whatever is given here.
   */
  ca?: string | readonly string[];
}

/** A refusal decided by the transport rules, before or after the request. */
export interface TransportRefusal {
  reason:
    | "insecure-transport"
    | "cross-origin-redirect"
    | "too-many-redirects"
    | "timeout"
    | "network-error"
    /** The certificate chain or the host name did not verify; no byte of the body was read. */
    | "tls-error"
    /** The host is, or resolves to, a loopback, private, link-local or otherwise non-unicast address. */
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

/** Raised by the connect-time lookup when a name resolves to an address that may not be used. */
class BlockedAddressError extends Error {
  constructor(
    readonly host: string,
    readonly blocked: readonly string[],
  ) {
    super(
      `${host} resolves to ${blocked.join(", ")}, which is not a public unicast address (loopback, private, link-local, ` +
        `unique-local, unspecified, carrier-grade NAT, reserved, multicast, or a NAT64, 6to4 or Teredo address of one)`,
    );
    this.name = "BlockedAddressError";
  }
}

/**
 * The `connect.lookup` of the Agent: resolve with `resolve`, refuse unless
 * every address is allowed, and hand back the addresses it checked. The socket
 * connects to one of exactly these, so there is no second resolution to race.
 * Node asks for `{ all: true }` when it tries several addresses in turn and for
 * one address otherwise; both are answered.
 */
export function connectLookup(resolve: AddressLookup, enforce: boolean, allowLoopback = false): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const blocked = enforce ? addresses.filter((address) => !addressPermitted(address, allowLoopback)) : [];
        if (blocked.length > 0) return callback(new BlockedAddressError(hostname, blocked), "", 0);
        if (addresses.length === 0) return callback(new Error(`no address for ${hostname}`), "", 0);
        const answers = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options.all) return callback(null, answers);
        callback(null, answers[0].address, answers[0].family);
      },
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), "", 0),
    );
  };
}

/** The rule every hop must pass; `undefined` when it does. */
function hopRefusal(url: URL, opts: SecureGetOptions, redirected: boolean): TransportRefusal | undefined {
  if (!opts.allowInsecure && url.protocol !== "https:") {
    return {
      reason: "insecure-transport",
      url: url.toString(),
      detail:
        `refusing to retrieve ${url.toString()} over "${url.protocol.replace(/:$/, "")}"` +
        `${redirected ? " (reached through a redirect)" : ""}: this consumer dereferences only https URIs ` +
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
  // to carry credentials, and putting them on the wire (or into a redirect
  // chain, a log line, or a `Referer`) is a hazard with no upside.
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
  // A literal IP host skips the lookup of the connection, so it is judged here.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!opts.allowPrivateAddresses && isIP(host) !== 0 && !addressPermitted(host, loopbackAllowed(opts))) {
    return {
      reason: "blocked-address",
      url: url.toString(),
      detail:
        `refusing to retrieve ${url.toString()}: the host is ${host}, which is not a public unicast address ` +
        `(loopback, private, link-local, unique-local, unspecified, carrier-grade NAT, reserved, multicast, or a ` +
        `NAT64, 6to4 or Teredo address of one). A consumer refuses such an address at every connection, since ` +
        `dereferencing a URI out of an untrusted document otherwise turns it into a probe for the network it runs ` +
        `on (pass allowPrivateAddresses: true to override)`,
    };
  }
  return undefined;
}

/** The error codes of a failed certificate or host name verification (Node's tls and OpenSSL's). */
const TLS_FAILURE = /^(ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_(GET|VERIFY)_|HOSTNAME_MISMATCH|ERR_SSL_)/;

/** The innermost `cause` chain of a fetch failure, outermost first. */
function causes(err: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let e: unknown = err; e !== undefined && e !== null && chain.length < 5; e = (e as { cause?: unknown }).cause) chain.push(e);
  return chain;
}

/** Turn a thrown fetch failure into the refusal it stands for. */
function failure(err: unknown, url: URL): TransportRefusal {
  if (isAbortOrTimeout(err)) return { reason: "timeout", url: url.toString() };
  const chain = causes(err);
  const blocked = chain.find((e): e is BlockedAddressError => e instanceof BlockedAddressError);
  if (blocked) {
    return {
      reason: "blocked-address",
      url: url.toString(),
      detail:
        `refusing to connect to ${url.toString()}: ${blocked.message}. A consumer refuses such an address at every ` +
        `connection, since dereferencing a URI out of an untrusted document otherwise turns it into a probe for the ` +
        `network it runs on (pass allowPrivateAddresses: true to override)`,
    };
  }
  const tls = chain.find((e) => typeof (e as { code?: unknown }).code === "string" && TLS_FAILURE.test((e as { code: string }).code));
  if (tls) {
    const { code, message } = tls as { code: string; message?: string };
    return { reason: "tls-error", url: url.toString(), detail: `the certificate of ${url.host} did not verify (${code}${message ? `: ${message}` : ""})` };
  }
  return { reason: "network-error", url: url.toString(), detail: err instanceof Error ? err.message : String(err) };
}

/**
 * GET `url`, following at most five redirects, checking each hop against the
 * transport rules before requesting it. The returned response is unread, and
 * the one deadline `timeoutMs` covers the hops and the reading of the body.
 */
export async function secureGet(url: URL, opts: SecureGetOptions): Promise<SecureGetResult> {
  const enforce = !opts.allowPrivateAddresses;
  const agent = opts.fetchImpl
    ? undefined
    : new Agent({
        keepAliveTimeout: 1,
        keepAliveMaxTimeout: 1,
        connect: {
          lookup: connectLookup(opts.lookup ?? systemAddressLookup, enforce, loopbackAllowed(opts)),
          ...(opts.ca === undefined ? {} : { ca: [...rootCertificates, ...(typeof opts.ca === "string" ? [opts.ca] : opts.ca)] }),
        },
      });
  const doFetch = (opts.fetchImpl ?? undiciFetch) as typeof fetch;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  // `close` lets a response in flight finish, so the body can still be read.
  const release = () => void agent?.close().catch(() => undefined);

  let current = url;
  let redirected = false;
  for (let hop = 0; ; hop++) {
    const refused = hopRefusal(current, opts, redirected);
    if (refused) {
      release();
      return { ok: false, refusal: refused };
    }

    let res: Response;
    try {
      res = await doFetch(current.toString(), {
        method: "GET",
        headers: opts.headers,
        redirect: "manual",
        signal,
        ...(agent ? { dispatcher: agent } : {}),
      } as RequestInit);
    } catch (err) {
      release();
      return { ok: false, refusal: failure(err, current) };
    }

    const location = res.headers.get("location");
    if (REDIRECT_STATUSES.has(res.status) && location !== null) {
      await res.body?.cancel().catch(() => undefined);
      if (hop >= MAX_REDIRECTS) {
        release();
        return { ok: false, refusal: { reason: "too-many-redirects", url: current.toString(), detail: `more than ${MAX_REDIRECTS} redirects` } };
      }
      try {
        current = new URL(location, current);
      } catch {
        release();
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
        const refusedFinal = hopRefusal(finalUrl, opts, true);
        if (refusedFinal) {
          await res.body?.cancel().catch(() => undefined);
          release();
          return { ok: false, refusal: refusedFinal };
        }
        current = finalUrl;
        redirected = redirected || res.redirected === true;
      }
    }
    release();
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
 * The cap counts the bytes after any content coding.
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
