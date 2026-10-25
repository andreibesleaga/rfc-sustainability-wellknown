/**
 * Public validator and badge.
 *
 *   GET /validate?origin=https://host      → JSON: what one retrieval of that
 *                                            origin's declaration found
 *   GET /badge/<host>.svg                  → an SVG badge saying the same
 *
 * What it is: a statement about the bytes an origin served at one moment,
 * made with the published consumer library — the same check anyone can run
 * with `sustainability-fetch`. What it is not: an endorsement, a registry, or
 * a record. Nothing is stored beyond a one-hour in-memory cache, and the
 * target is fetched once per hour at most, however often the badge is viewed.
 *
 * Guards (the target is chosen by the requester, so this is a request-forgery
 * surface): https only; a registered DNS name only (no IP literals, no
 * `localhost`, no single-label or `.local`/`.internal` names); the consumer's
 * own transport protections then refuse a name that resolves to a private or
 * link-local address (the consumer checks the address in the lookup of the
 * connection it actually opens, on every hop, so a DNS answer that changes
 * after the check cannot pass; true when no `fetchImpl` is injected, as in
 * production; only an https request on port 443 to the checked name is ever
 * attempted); 64 KiB body cap; 5-second timeout; one retrieval in flight per
 * host; a global budget of new retrievals per minute across all clients; a
 * stricter per-client rate limit for requests that cause a retrieval (a badge
 * served from the cache does not); an operator-maintained exclusion list for
 * hosts whose operators asked not to be fetched.
 */
import {
  fetchSustainability,
  isBlockedAddress,
  systemAddressLookup,
  type AddressLookup,
  type FetchResult,
  type MediaTypeClassification,
  type Period,
  type SignatureResult,
} from "sustainability-wellknown-consumer";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

export const VALIDATE_PATH = "/validate";
export const BADGE_ROUTE = /^\/badge\/([A-Za-z0-9.-]{1,253})\.svg$/;

/** A registered DNS name: labels of letters, digits and hyphens, at least two of them. */
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;
const NEVER = /^(localhost|.*\.(localhost|local|internal|home|lan|arpa|test|example|invalid|onion))$/;

export const CACHE_TTL_MS = 3_600_000;
export const MAX_BODY_BYTES = 65_536;
export const TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 2_000;

export interface ValidationOutcome {
  origin: string;
  /**
   * `valid`: a schema-valid declaration with the draft's media type (or `json`, noted). `invalid`: the origin
   * answered, but not with a usable declaration. `unreachable`: this service contacted the origin and got no
   * usable response. Never used for "this service did not try" (see `Busy`).
   */
  status: "valid" | "invalid" | "unreachable";
  /** When the check was made (not when the badge was viewed). */
  checked: string;
  mediaType?: MediaTypeClassification;
  /**
   * `current`: the body is a declaration of the current revision as served.
   * `legacy`: the consumer's compatibility reading changed it (`converted`,
   * `disregarded`): the origin has not moved to the current revision. Only
   * set on a `valid` outcome.
   */
  format?: "current" | "legacy";
  /** What the compatibility reading read in another spelling, as member paths (`period`, `[1].carbon-unit`). */
  converted?: string[];
  /** What the compatibility reading did not use, as member paths (`measurement-method`). */
  disregarded?: string[];
  /** The `unsigned`, `verified` or `unverified` outcome of the embedded signature, over every object of the body. */
  signature?: "verified" | "unverified" | "unsigned";
  /** The `period` of the first object of the body, when there is one. */
  period?: Period;
  target?: string;
  /** Advisory findings that do not make the declaration invalid (`code: message`). */
  warnings?: string[];
  detail: string;
  /** Always present: the check says nothing about accuracy. */
  note: string;
}

/** This service did not try: its retrieval budget for the minute is spent. */
export interface Busy {
  busy: true;
  retryAfterSec: number;
}

export function isBusy(r: ValidationOutcome | Busy): r is Busy {
  return (r as Busy).busy === true;
}

export interface ValidatorDeps {
  /** Replaces the consumer's own connection (tests). Leave unset in a deployment: see the constructor. */
  fetchImpl?: typeof fetch;
  lookup?: AddressLookup;
  clock?: () => Date;
  /** Checks per client per minute on these two routes, counted only when a retrieval is needed (default 6). */
  perMinute?: number;
  ttlMs?: number;
  /** New retrievals per minute across all clients (default 30): the outbound guard that needs no client identity. */
  outboundPerMinute?: number;
  /** Hosts whose operators asked not to be fetched; refused before any lookup, never cached. */
  exclude?: ReadonlySet<string>;
}

export interface HostRefusal {
  status: 400;
  error: string;
}

/** The host a request may name, or why it may not. */
export function parseOrigin(raw: string | undefined): { host: string } | HostRefusal {
  if (!raw) return { status: 400, error: "origin is required: ?origin=https://host" };
  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return { status: 400, error: "origin is not a URL" };
  }
  if (url.protocol !== "https:") return { status: 400, error: "only https origins are checked" };
  if (url.port) return { status: 400, error: "only port 443 is checked" };
  if (url.username || url.password) return { status: 400, error: "credentials in the origin are not accepted" };
  if (url.pathname !== "/" || url.search || url.hash) return { status: 400, error: "give the origin only, without a path" };
  return checkHost(url.hostname);
}

export function checkHost(hostname: string): { host: string } | HostRefusal {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isBlockedAddress(host) || /^[\d.]+$/.test(host) || host.startsWith("[") || host.includes(":")) {
    return { status: 400, error: "an IP address is not checked; name the host" };
  }
  if (!HOST_RE.test(host) || NEVER.test(host)) return { status: 400, error: "not a public DNS name" };
  return { host };
}

const NOTE = "A check says what bytes the origin served at that moment and whether they are a schema-valid declaration; it says nothing about the accuracy of the figures and is not an endorsement.";

export class Validator {
  private readonly cache = new Map<string, { outcome: ValidationOutcome; expires: number }>();
  private readonly inFlight = new Map<string, Promise<ValidationOutcome>>();
  readonly limiter: RateLimiter | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly lookup: AddressLookup;
  private readonly clock: () => Date;
  private readonly ttlMs: number;
  private readonly exclude: ReadonlySet<string>;
  private readonly outboundPerMinute: number;
  private outbound: number[] = [];

  constructor(deps: ValidatorDeps = {}) {
    // Unset in production, on purpose: the consumer then makes the request itself, through a connection whose
    // address check refuses a private, loopback or link-local answer at every hop. A fetch passed in (a test's
    // stand-in) opens no connection through the consumer, so that check does not apply to it.
    this.fetchImpl = deps.fetchImpl;
    this.lookup = deps.lookup ?? systemAddressLookup;
    this.clock = deps.clock ?? (() => new Date());
    this.ttlMs = deps.ttlMs ?? CACHE_TTL_MS;
    this.exclude = deps.exclude ?? new Set();
    this.outboundPerMinute = deps.outboundPerMinute ?? 30;
    this.limiter = createRateLimiter({ perMinute: deps.perMinute ?? 6, trustProxy: 1 });
  }

  /** True when the operator excluded this host at its operator's request. */
  excluded(host: string): boolean {
    return this.exclude.has(host);
  }

  /** True when answering for this host needs no retrieval (cached and unexpired, or already in flight). */
  isFresh(host: string): boolean {
    const hit = this.cache.get(host);
    return (hit !== undefined && hit.expires > this.clock().getTime()) || this.inFlight.has(host);
  }

  /** Whether one more retrieval fits in this minute's global budget; records it when it does. */
  private takeOutbound(): boolean {
    const now = this.clock().getTime();
    this.outbound = this.outbound.filter((t) => now - t < 60_000);
    if (this.outbound.length >= this.outboundPerMinute) return false;
    this.outbound.push(now);
    return true;
  }

  /**
   * The cached outcome for a host, or a fresh one; one retrieval in flight per host. When this
   * service's own retrieval budget for the minute is spent, the answer is `{ busy, retryAfterSec }`:
   * the origin was not contacted, so nothing is said about it. An excluded host is the caller's to
   * refuse before calling (see `excluded`).
   */
  async check(host: string): Promise<ValidationOutcome | Busy> {
    const now = this.clock().getTime();
    const hit = this.cache.get(host);
    if (hit && hit.expires > now) return hit.outcome;
    const pending = this.inFlight.get(host);
    if (pending) return pending;
    if (!this.takeOutbound()) {
      const oldest = this.outbound[0] ?? now;
      return { busy: true, retryAfterSec: Math.max(1, Math.ceil((60_000 - (now - oldest)) / 1000)) };
    }
    const run = this.retrieve(host).then((outcome) => {
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(host, { outcome, expires: now + this.ttlMs });
      this.inFlight.delete(host);
      return outcome;
    }, (err) => {
      this.inFlight.delete(host);
      throw err;
    });
    this.inFlight.set(host, run);
    return run;
  }

  private async retrieve(host: string): Promise<ValidationOutcome> {
    const origin = `https://${host}`;
    const checked = this.clock().toISOString();
    let result: FetchResult;
    try {
      result = await fetchSustainability(origin, {
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
        lookup: this.lookup,
        timeoutMs: TIMEOUT_MS,
        maxBytes: MAX_BODY_BYTES,
        maxObjects: 400,
        // Every signed object is verified, with the compatibility reading the objects get.
        verifySignature: true,
      });
    } catch (err) {
      return { origin, status: "unreachable", checked, detail: err instanceof Error ? err.message : String(err), note: NOTE };
    }
    if (result.status === "ok") {
      const objects = Array.isArray(result.document) ? result.document : [result.document];
      const first = objects[0];
      const signature = signatureOf(result.signatures ?? []);
      const converted = result.converted ?? [];
      const disregarded = result.disregarded ?? [];
      const legacy = result.legacy === true;
      return {
        origin,
        status: "valid",
        checked,
        mediaType: result.mediaType,
        format: legacy ? "legacy" : "current",
        converted,
        disregarded,
        signature,
        ...(first ? { period: first.period, target: first.target } : {}),
        ...(result.warnings?.length ? { warnings: result.warnings } : {}),
        detail:
          objects.length === 0
            ? "no report: the body is an empty array, which is valid and states nothing"
            : `schema-valid declaration served as ${result.mediaType === "json" ? "application/json (tolerated; the draft's media type is application/sustainability-data+json)" : "application/sustainability-data+json"}` +
              (legacy ? "; read from an earlier revision of the draft, so the origin has not moved to the current one" : ""),
        note: noteOf(result.signatures ?? [], result.warnings ?? []),
      };
    }
    const reachable = new Set(["invalid", "wrong-media-type", "too-many-objects", "too-large"]);
    const detail = describe(result);
    return { origin, status: reachable.has(result.status) ? "invalid" : "unreachable", checked, detail, note: NOTE };
  }
}

/** One word for the signatures of a body: any that failed makes it unverified, else any that verified makes it verified. */
function signatureOf(signatures: SignatureResult[]): "verified" | "unverified" | "unsigned" {
  if (signatures.some((s) => s.status === "unverified")) return "unverified";
  return signatures.some((s) => s.status === "verified") ? "verified" : "unsigned";
}

/** The standing note, with what a reader needs to know about a verified signature and about the advisory findings. */
function noteOf(signatures: SignatureResult[], warnings: string[]): string {
  let note = NOTE;
  if (signatures.some((s) => s.status === "verified" && s.keyTrust === "declaration-only")) {
    note += " A verified signature made with the key the declaration carries in its own header proves integrity only: that the object was not changed after signing, and nothing about who holds the key.";
  }
  if (warnings.length > 0) note += ` Advisory: ${warnings.slice(0, 3).join(" | ")}`;
  return note;
}

function describe(r: FetchResult): string {
  switch (r.status) {
    case "not-found": return "404: the origin publishes no declaration";
    case "invalid": return `not a valid declaration: ${r.errors.slice(0, 3).join("; ")}`;
    case "wrong-media-type": return `served as ${r.mediaType ?? "no media type"}, not application/sustainability-data+json`;
    case "http-error": return `HTTP ${r.httpStatus}`;
    case "timeout": return `no response within ${r.timeoutMs} ms`;
    case "too-large": return `body larger than the ${MAX_BODY_BYTES / 1024} KiB limit of this check`;
    case "too-many-objects": return `more objects than this check reads (${r.count} > ${r.max})`;
    case "insecure-transport": return `refused: ${r.detail}`;
    case "too-many-redirects": return `more than five redirects, or a loop: ${r.detail}`;
    case "refused-uri": return `refused: ${r.detail}`;
    default: return r.status;
  }
}

/** Brown, not grey: a notice is not an outcome, and white text on it keeps a contrast of 4.5 or more. */
const NOTICE_COLOUR = "#7a5200";
const COLOURS = { valid: "#2e7d32", invalid: "#c62828", unreachable: "#616161" } as const;

/** A flat badge in the common two-cell style for a check's outcome. */
export function badgeSvg(outcome: ValidationOutcome): string {
  // A document read from an earlier revision is valid, and the badge says it is not in the current form.
  const word = outcome.status === "valid" && outcome.format === "legacy" ? "valid (legacy)" : outcome.status;
  return badgeImage(
    `${word} · ${outcome.checked.slice(0, 10)}`,
    COLOURS[outcome.status],
    `${outcome.origin}: ${outcome.status}, checked ${outcome.checked}. ${outcome.detail}`,
  );
}

/** A grey badge for when no check was made (bad request, exclusion, this service busy); says nothing about the origin. */
export function noticeBadgeSvg(text: string, title: string): string {
  return badgeImage(text, NOTICE_COLOUR, title);
}

/** The two-cell badge; text is escaped, widths estimated from length. */
function badgeImage(right: string, colour: string, title: string): string {
  const left = "sustainability-data";
  const w = (s: string) => Math.round(s.length * 6.4) + 12;
  const lw = w(left);
  const rw = w(right);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${esc(left)}: ${esc(right)}">
<title>${esc(title)}</title>
<rect width="${lw}" height="20" fill="#555"/>
<rect x="${lw}" width="${rw}" height="20" fill="${colour}"/>
<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${esc(left)}</text>
<text x="${lw + rw / 2}" y="14">${esc(right)}</text>
</g>
</svg>
`;
}
