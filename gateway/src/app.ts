/**
 * Routing and HTTP semantics for the multi-domain gateway.
 *
 * The per-document HTTP behaviour (status codes, `Cache-Control`, `ETag`,
 * conditional GET) is NOT reimplemented here: it is delegated to
 * `handleRequest()` from the published `sustainability-wellknown-publisher`
 * package, which is the same code path the single-origin publisher uses. This
 * module adds the multi-subject routing, `Last-Modified`, the index pages, and
 * the method/404 rules.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  handleRequest,
  importSigningKey,
  lastFullMonthPeriod,
  parseQuery,
  queryFromSearchParams,
  type Period,
  type ServiceQuery,
  type SigningKey,
} from "sustainability-wellknown-publisher";
import { verifyEmbeddedSignature } from "sustainability-wellknown-consumer";
import { demoSpecs } from "./adapters/demo-specs";
import { HELD_MAX, dateTimeOf, selfReportAdapter, startOfDay } from "./adapters/self-report";
import { LIMITS, PUBLIC_BASE_URL, type GatewayConfig, type MediaTypeSetting } from "./config";
import { loadWireExamples, type WireExample } from "./examples";
import { CORS_ORIGIN, corsHeaders, jsonError, methodNotAllowed, notModified, withBody, type Result } from "./http";
import {
  WELL_KNOWN_PATH,
  buildIndex,
  renderIndexHtml,
  type IndexDocument,
} from "./index-page";
import { LiveRegistry, type LiveSpec } from "./live";
import { loadMediaTypeOverrides, MEDIA_TYPE_FILE } from "./media-type";
import { clientKey, createRateLimiter, type RateLimiter } from "./rate-limit";
import { httpDate, loadRegistry, subjectFromAdapter, type Subject } from "./registry";
import { LEGAL_PATH, LEGAL_TEXT } from "./legal";
import { BADGE_ROUTE, VALIDATE_PATH, Validator, badgeSvg, checkHost, isBusy, noticeBadgeSvg, parseOrigin, type ValidatorDeps } from "./validate";
import { crossValidate, type CrossValidation } from "./verify";
import { loadSelfEnteredAt, loadSelfMeasured } from "./self-measured";

/** `/{domain}/.well-known/sustainability-data` — the primary route. */
const SUBJECT_ROUTE = new RegExp(`^/([^/]{1,${LIMITS.maxDomainLength}})/\\.well-known/sustainability-data$`);
/** The recorded input an adapter demonstration transforms, shown next to its declaration. */
const INPUT_ROUTE = new RegExp(`^/([^/]{1,${LIMITS.maxDomainLength}})/input$`);
/** The self report's variant cache: in-progress periods change hourly. */
const SELF_CACHE_TTL_MS = 60 * 60 * 1000;
const SELF_CACHE_ENTRIES = 64;

export interface Gateway {
  server: Server;
  config: GatewayConfig;
  /** Every subject the gateway serves, keyed by its route domain. */
  subjects: Map<string, Subject>;
  /** Wire-format example metadata (subjects also appear in `subjects`). */
  examples: Map<string, WireExample>;
  /** Live/replay adapter-demonstration subjects (also in `subjects`). */
  live: LiveRegistry;
  /** Boot-time validation of every served document with the consumer library. */
  crossValidation: CrossValidation;
  /**
   * Refresh every live-capable demonstration subject (daily timer target).
   * Rebuilds the index when a served document changed.
   */
  refreshLive: () => Promise<void>;
  /** The gateway's own report (`target-type: "service"`). */
  self: Subject;
  /**
   * Returns the self subject for the CURRENT reporting period. This
   * deployment's parameterless report is the latest entered whole calendar month
   * (the draft leaves the choice to the publisher), so when the month rolls over (and
   * no fixed SELF_PERIOD is pinned) the self report is regenerated instead of
   * freezing at whatever month the process booted in.
   */
  refreshSelf?: () => Promise<Subject>;
  /**
   * Per-subject media-type override from `data/_media-type.json`, keyed by
   * domain. A domain absent here inherits `config.mediaType`.
   */
  mediaTypeOverrides: Map<string, MediaTypeSetting>;
  index: IndexDocument;
  indexHtml: string;
  /** The machine-readable index, serialized once per build. */
  indexJson: string;
  /**
   * The key that signs the gateway's own report. Unset, the declaration simply
   * carries no `signed` member, which the draft says means only that the
   * publisher did not sign — not evidence of anything.
   */
  signingKey?: SigningKey;
  /** Per-client request limiter; unset when disabled. */
  rateLimiter?: RateLimiter;
  /** The public validator and badge (undefined when disabled in this deployment). */
  validator?: Validator;
}

export type LogFn = (line: Record<string, unknown>) => void;

const defaultLog: LogFn = (line) => process.stdout.write(JSON.stringify(line) + "\n");

export interface CreateGatewayOptions {
  config: GatewayConfig;
  log?: LogFn;
  /** Injectable clock, so the default self-report period is deterministic. */
  now?: Date;
  /** Injectable RUNNING clock for the month-rollover check (tests). Defaults to `() => new Date()`. */
  clock?: () => Date;
  /**
   * Injectable fetch for the live demonstration upstreams. Tests inject a
   * recorded implementation; `undefined` uses the real network. Passing
   * `null` disables live mode entirely (every demo boots from its fixture).
   */
  fetchImpl?: typeof fetch | null;
  /** Injectable environment for API-key lookups (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /**
   * The public validator's dependencies (its fetch, DNS lookup, clock). Unset
   * uses the real network; `null` disables the /validate and /badge routes.
   * Separate from `fetchImpl`, which governs the live demonstration upstreams.
   */
  validator?: ValidatorDeps | null;
}

/**
 * `Last-Modified` for a served body: the latest `updated` of the objects it
 * holds, as an HTTP-date. An empty array holds none, so it has no date of its own.
 */
function lastUpdatedIn(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { updated?: string } | { updated?: string }[];
    const dates = (Array.isArray(parsed) ? parsed : [parsed]).map((o) => o?.updated).filter((u): u is string => typeof u === "string");
    if (dates.length === 0) return undefined;
    return dates.map(httpDate).sort((x, y) => Date.parse(x) - Date.parse(y))[dates.length - 1];
  } catch {
    return undefined;
  }
}

/**
 * Serve one subject's document.
 *
 * The query goes to the publisher whatever the subject: a Basic publisher
 * honors no parameter and answers the request as if none were sent, an
 * Extended one honors the values that match the draft's ABNF and ignores the
 * rest (draft §Query Parameters; never an error, never repaired). The
 * publisher keys its cache on the honored values only, which keeps the number
 * of entries bounded and gives `Z` and `.000Z` spellings of one instant one
 * entry and one `ETag`.
 */
async function serveDocument(
  subject: Subject,
  config: GatewayConfig,
  ifNoneMatch: string | undefined,
  ifModifiedSince: string | undefined,
  mediaType: MediaTypeSetting,
  query: ServiceQuery = {},
): Promise<Result> {
  const r = await handleRequest(
    subject.publisher,
    query,
    { maxAge: config.maxAge, cors: CORS_ORIGIN, mediaType },
    ifNoneMatch,
  );
  const headers: Record<string, string> = { ...r.headers, "Last-Modified": subject.lastModified };
  // A document about a real third party is an unendorsed mapping. Two headers
  // say so outside the body as well: search engines are asked not to index it
  // (it must never be found in place of the subject's own publication), and
  // the legal notice is named as the terms the document is served under
  // (RFC 6903, "terms-of-service"). They accompany 200 and 304 alike.
  if (isThirdPartyMapping(subject)) {
    headers["X-Robots-Tag"] = "noindex";
    headers["Link"] = `<${(config.baseUrl || PUBLIC_BASE_URL).replace(/\/+$/, "")}${LEGAL_PATH}>; rel="terms-of-service"`;
  }
  // `Last-Modified` is the latest `updated` of the objects returned, on a 304 as
  // on a 200, since a 304 must carry the validators the 200 would have (RFC 9110
  // §15.4.5). The 304 has no body, so the document is read from the publisher's
  // cache, which the request just populated.
  if (r.status === 200 || r.status === 304) {
    let updated: string | undefined;
    if (r.status === 200) {
      updated = lastUpdatedIn(r.body);
    } else {
      try {
        updated = lastUpdatedIn(JSON.stringify(await subject.publisher.getDocument(query)));
      } catch {
        updated = undefined;
      }
    }
    if (updated) headers["Last-Modified"] = updated;
  }
  if (r.status === 200) {
    // RFC 9110 §13.1.3: If-Modified-Since applies to GET/HEAD only when
    // If-None-Match is absent (an ETag comparison always wins). The document
    // is unmodified when its Last-Modified is not later than the given date.
    if (ifNoneMatch === undefined && ifModifiedSince !== undefined) {
      const since = Date.parse(ifModifiedSince);
      const lastModified = Date.parse(headers["Last-Modified"]);
      if (!Number.isNaN(since) && !Number.isNaN(lastModified) && lastModified <= since) {
        return notModified(headers);
      }
    }
    // The `provider` member is human-readable text; the draft's `provider`
    // definition has a publisher state its language. No negotiation is offered,
    // so no `Vary`.
    headers["Content-Language"] = "en";
    return withBody(200, headers, r.body);
  }
  // A 304 keeps only what a cache needs and carries no Content-Length (RFC 9110
  // §8.6: a 304 must not claim a length other than the 200's). 404 and 503
  // leave through the same seam as 200, so they carry nosniff and a length.
  if (r.status === 304) return notModified(headers);
  return withBody(r.status, headers, r.body);
}

/**
 * A curated `data/*.json` document about a real organization: not synthetic
 * (reserved names), and not produced by an adapter demonstration or by the
 * gateway about itself.
 */
export function isThirdPartyMapping(subject: Subject): boolean {
  return !subject.synthetic && !/^(adapter|example):/.test(subject.source);
}

/** Resolve one request to a fully-formed response. Exported for tests. */
export async function route(
  gw: Pick<
    Gateway,
    "config" | "subjects" | "self" | "mediaTypeOverrides" | "index" | "indexHtml" | "indexJson"
  > &
    Partial<Pick<Gateway, "refreshSelf" | "examples" | "signingKey" | "live" | "validator">>,
  method: string,
  rawUrl: string,
  headers: { "if-none-match"?: string; "if-modified-since"?: string } = {},
): Promise<Result> {
  const { path, search } = splitTarget(rawUrl);
  const ifNoneMatch = headers["if-none-match"];
  const ifModifiedSince = headers["if-modified-since"];

  const isKnown =
    path === "/" ||
    path === "/index.json" ||
    path === "/healthz" ||
    path === LEGAL_PATH ||
    path === VALIDATE_PATH ||
    BADGE_ROUTE.test(path) ||
    path === WELL_KNOWN_PATH ||
    SUBJECT_ROUTE.test(path) ||
    INPUT_ROUTE.test(path);

  if (isKnown && method !== "GET" && method !== "HEAD") return methodNotAllowed();

  if (path === "/") {
    return withBody(
      200,
      {
        ...corsHeaders(),
        "Content-Type": "text/html; charset=utf-8",
        "Content-Language": "en",
        "Cache-Control": selfCacheControl(gw.config),
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      },
      gw.indexHtml,
    );
  }

  if (path === "/index.json") {
    return withBody(
      200,
      {
        ...corsHeaders(),
        "Content-Type": "application/json",
        "Content-Language": "en",
        "Cache-Control": selfCacheControl(gw.config),
      },
      gw.indexJson,
    );
  }

  if (path === LEGAL_PATH) {
    return withBody(
      200,
      {
        ...corsHeaders(),
        // Markdown source, served as plain text so a browser shows it instead of downloading it.
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Language": "en",
        "Cache-Control": selfCacheControl(gw.config),
      },
      LEGAL_TEXT,
    );
  }

  if (path === VALIDATE_PATH || BADGE_ROUTE.test(path)) {
    if (!gw.validator) return jsonError(503, "the validator is disabled in this deployment");
    const badge = BADGE_ROUTE.exec(path);
    const target = badge ? checkHost(badge[1]) : parseOrigin(new URLSearchParams(search).get("origin") ?? undefined);
    if (!("error" in target) && gw.validator.excluded(target.host)) {
      const detail = "excluded at the operator's request";
      if (badge) {
        return withBody(400, { ...corsHeaders(), "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
          noticeBadgeSvg("not checked", `${badge[1]}: ${detail}`));
      }
      return jsonError(400, detail);
    }
    if ("error" in target) {
      // A bad badge request still gets an image, so a README never shows a broken icon.
      if (badge) {
        return withBody(400, { ...corsHeaders(), "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" },
          noticeBadgeSvg("not checked", `${badge[1]}: ${target.error}`));
      }
      return jsonError(400, target.error);
    }
    const outcome = await gw.validator.check(target.host);
    if (isBusy(outcome)) {
      // This service did not contact the origin: say so, with no-store, and say when to come back.
      const busy = { "Retry-After": String(outcome.retryAfterSec), "Cache-Control": "no-store" };
      if (badge) {
        return withBody(503, { ...corsHeaders(), "Content-Type": "image/svg+xml; charset=utf-8", ...busy },
          noticeBadgeSvg("try later", "This checking service is busy; the origin was not checked."));
      }
      return jsonError(503, "this service's retrieval budget is spent; retry after the indicated delay", busy);
    }
    const headers = {
      ...corsHeaders(),
      // The outcome is reused for an hour; the badge is a picture of the same outcome.
      "Cache-Control": "public, max-age=3600",
      "X-Robots-Tag": "noindex",
    };
    if (badge) return withBody(200, { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" }, badgeSvg(outcome));
    return withBody(200, { ...headers, "Content-Type": "application/json", "Content-Language": "en" }, JSON.stringify(outcome, null, 2) + "\n");
  }

  if (path === "/healthz") {
    return withBody(
      200,
      { ...corsHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" },
      JSON.stringify({ status: "ok", subjects: gw.subjects.size }) + "\n",
    );
  }

  if (path === WELL_KNOWN_PATH) {
    const self = gw.refreshSelf ? await gw.refreshSelf() : gw.self;
    return serveDocument(self, { ...gw.config, maxAge: selfMaxAge(gw.config) }, ifNoneMatch, ifModifiedSince, gw.config.mediaType, queryOf(search));
  }

  const m = SUBJECT_ROUTE.exec(path);
  if (m) {
    // Case-insensitive host matching (DNS is case-insensitive); the path is not
    // percent-decoded, so an encoded separator simply fails to match.
    const domain = m[1].toLowerCase();
    const subject = gw.subjects.get(domain);
    if (!subject) {
      // This gateway holds nothing for this subject -> 404.
      return jsonError(
        404,
        "no sustainability metadata is published here for that reporting subject",
      );
    }
    const mediaType = gw.mediaTypeOverrides.get(domain) ?? gw.config.mediaType;
    return serveDocument(subject, gw.config, ifNoneMatch, ifModifiedSince, mediaType, queryOf(search));
  }

  const inputMatch = INPUT_ROUTE.exec(path);
  if (inputMatch) {
    const input = gw.live?.managed.get(inputMatch[1].toLowerCase())?.spec.input;
    if (!input) return jsonError(404, "no recorded input is published for that subject");
    const headers: Record<string, string> = {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${gw.config.maxAge}`,
      // An input is a demonstration fixture, not a declaration: keep it out of search results.
      "X-Robots-Tag": "noindex",
    };
    if (input.license) headers["Link"] = `<${input.license.url}>; rel="license"`;
    return withBody(200, headers, JSON.stringify(input.body, null, 2) + "\n");
  }

  return jsonError(404, "not found");
}

/** The request target as logged: the host a validator or badge request names is dropped. */
export function loggedPath(rawUrl: string): string {
  const { path } = splitTarget(rawUrl);
  if (path === VALIDATE_PATH) return `${VALIDATE_PATH}?origin=<host>`;
  if (BADGE_ROUTE.test(path)) return "/badge/<host>.svg";
  return rawUrl.slice(0, 512);
}

/** Path and query string of a request target, split once for routing, rate limiting and parameters. */
export function splitTarget(rawUrl: string): { path: string; search: URLSearchParams } {
  const q = rawUrl.indexOf("?");
  return q === -1
    ? { path: rawUrl, search: new URLSearchParams() }
    : { path: rawUrl.slice(0, q), search: new URLSearchParams(rawUrl.slice(q + 1)) };
}

/**
 * The parameters of a request, as the draft's §Query Parameters reads them,
 * applied with the published library's own `parseQuery`: a value that does not
 * match the ABNF, a name given more than once and a name the draft does not
 * define are IGNORED, never repaired and never answered with an error, so a
 * request carrying only such values is the bare request.
 *
 * `queryFromSearchParams` is what preserves a repeated name; collapsing the
 * query into a plain object first would hide the very duplication the rule is
 * about.
 */
function queryOf(search: URLSearchParams): ServiceQuery {
  return parseQuery(queryFromSearchParams(search)).query;
}

/**
 * Cache lifetime of the gateway's own report: one hour, the model's own
 * resolution. The document changes every hour for a period in progress and
 * every month for the parameterless request. Since -07 the signature travels
 * inside the body, so a cache can no longer hold a document and its signature
 * as two entries taken at different moments; one hour simply keeps the served
 * figures close to the model's resolution. The relayed subjects keep the
 * configured day.
 */
const SELF_MAX_AGE = 3600;
const selfMaxAge = (config: GatewayConfig): number => Math.min(config.maxAge, SELF_MAX_AGE);
const selfCacheControl = (config: GatewayConfig): string => `public, max-age=${selfMaxAge(config)}`;

/** Load data, wire the adapters, and build (but do not start) the HTTP server. */
export async function createGateway(opts: CreateGatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const log = opts.log ?? defaultLog;

  // The origin the declarations are really served from: it resolves the
  // `{base}` token a data file uses to name a declaration relayed here (the
  // downstream demonstration subject's `upstream`), so an upstream chain walk
  // resolves against this deployment and not against some other one.
  const subjects = await loadRegistry(config.dataDir, config.baseUrl || PUBLIC_BASE_URL);
  const mediaTypeOverrides = loadMediaTypeOverrides(config.dataDir);
  const clock = opts.clock ?? (() => new Date());
  /**
   * The clock the self report sees: the injected running clock when there is
   * one (month-rollover tests advance it), else the fixed `now`, else real time.
   */
  const selfClock = () => (opts.clock ? opts.clock() : opts.now ?? new Date());

  // ---- The signing key for the gateway's OWN report (draft §The signed Member).
  // A key that cannot be imported stops the deploy, like a bad data file: a
  // gateway that claims to sign and cannot is worse than one that does not
  // sign. ----
  let signingKey: SigningKey | undefined;
  if (config.signingKeyJwk) {
    try {
      signingKey = await importSigningKey(config.signingKeyJwk);
    } catch (err) {
      throw new Error(`SUSTAINABILITY_SIGNING_KEY: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Worked adapter example #1: the gateway's own report, produced by the
  // published `computedAdapter` rather than hand-written. ----
  const fromFile = config.self.wattsByMonth === undefined && config.self.measured;
  const selfMeasured = config.self.wattsByMonth ?? (fromFile ? loadSelfMeasured(config.dataDir) : {});
  const selfEnteredAt = fromFile ? loadSelfEnteredAt(config.dataDir) : {};
  const selfAdapter = (period: Period | undefined) =>
    selfReportAdapter({
      target: config.self.target,
      provider: config.self.provider,
      methodologyUri: config.self.methodologyUri,
      disclosureUri: config.self.disclosureUri,
      period,
      wattsByMonth: selfMeasured,
      enteredAtByMonth: selfEnteredAt,
      gridIntensity: config.self.gridIntensity,
      liveSince: config.self.liveSince,
      modelChangedAt: config.self.modelChangedAt,
      verifiableAttestationUri: config.self.verifiableAttestationUri,
      clock: selfClock,
    });
  const selfSubject = (period: Period | undefined) =>
    subjectFromAdapter({
      domain: "gateway.invalid", // never routed: served at the bare well-known path
      adapter: selfAdapter(period),
      target: config.self.target,
      targetType: "service",
      label: "adapter:computed (gateway self-report)",
      cacheTtlMs: SELF_CACHE_TTL_MS,
      maxCacheEntries: SELF_CACHE_ENTRIES,
      // The parameterless request is one object, the current report; a request
      // that names a parameter is answered with the objects held. The bound of
      // the held set is the publisher's own, so a selection is never cut.
      representation: "single",
      security: { maxObjects: HELD_MAX },
      // On the day it went live the gateway holds no whole day yet: it still starts, the
      // parameterless request is "no data" and a query is the empty array.
      emptyAt: dateTimeOf(startOfDay(selfClock().getTime())),
      // Draft §The signed Member: the publisher inserts the `signed` member into
      // every object it builds — the parameterless declaration and each
      // object of an Extended trend alike. The gateway implements no signing
      // of its own; it only hands the library the key. The public key travels
      // in the JWS header as `jwk`, which the draft RECOMMENDS so that
      // verification needs nothing but the declaration, and the same key is
      // published out of band at SELF_SIGNING_KEY_URL so a verifier can pin it
      // and match it by `kid`.
      ...(signingKey ? { signing: { key: signingKey } } : {}),
    });
  const self = await selfSubject(config.self.period);

  // ---- Wire-format examples: every case from the repository's canonical
  // example-responses set, served under reserved .example names. ----
  const examples = await loadWireExamples(config.examplesDir);
  for (const ex of examples.values()) {
    if (subjects.has(ex.domain)) {
      throw new Error(`gateway: ${ex.domain} is both a data file and a wire-format example`);
    }
    subjects.set(ex.domain, ex.subject);
  }

  // Bytes of one crawl of everything loaded so far (curated subjects, the
  // self report, the wire-format examples) — the REAL input to the co2js
  // demonstration. Measured before the demo subjects exist, which is the only
  // order that avoids self-reference.
  let crawlBytes = Buffer.byteLength(JSON.stringify(self.document));
  for (const s of subjects.values()) {
    crawlBytes += Buffer.byteLength(JSON.stringify(s.document));
  }

  // ---- Adapter demonstrations: one subject per published adapter, live
  // where an upstream's license permits it, replay otherwise. ----
  const live = new LiveRegistry({
    fetchImpl: opts.fetchImpl === undefined ? fetch : opts.fetchImpl,
    env: opts.env ?? process.env,
    now: () => opts.now ?? clock(),
  });
  const specs: LiveSpec[] = demoSpecs({ config, crawlBytes, wattsByMonth: selfMeasured, now: opts.now ?? clock() });
  for (const spec of specs) {
    if (subjects.has(spec.domain)) {
      throw new Error(`gateway: ${spec.domain} is both a data file and an adapter demo`);
    }
  }
  await live.init(specs);
  for (const m of live.managed.values()) {
    subjects.set(m.spec.domain, m.subject);
    // A spec with its own self-check (the SFC ledger bridge runs both of its
    // depths on the served document) has passed it, or init() would have thrown.
    if (m.spec.selfCheck) log({ ts: clock().toISOString(), level: "info", event: "demo-self-check", domain: m.spec.domain, mode: m.mode, result: "pass" });
  }

  // ---- Consumer cross-validation: every served document must satisfy the
  // published consumer library, or the gateway refuses to start. ----
  const crossValidation = await crossValidate(
    [self, ...subjects.values()].filter((s) => !s.empty),
    examples.values(),
  );

  // ---- Boot self-check of the signature: take the self declaration exactly
  // as it will be served and verify its embedded `signed` member with the
  // consumer library, in-process. A signature the ecosystem's own verifier
  // rejects must not go live. ----
  if (signingKey && !self.empty) {
    const served = await handleRequest(self.publisher, {}, { cors: CORS_ORIGIN });
    const outcome = await verifyEmbeddedSignature(JSON.parse(served.body));
    if (outcome.result.status !== "verified") {
      throw new Error(
        `self-signature check failed: ${
          outcome.result.status === "unverified" ? outcome.result.reason : "the declaration carries no signed member"
        }`,
      );
    }
    log({
      ts: clock().toISOString(),
      level: "info",
      event: "self-signature",
      valid: true,
      alg: outcome.result.alg,
      kid: signingKey.kid,
    });
  }

  for (const domain of mediaTypeOverrides.keys()) {
    if (!subjects.has(domain)) {
      throw new Error(
        `gateway: ${domain} is listed in ${MEDIA_TYPE_FILE} but is not a served subject`,
      );
    }
  }

  const makeIndex = (): IndexDocument =>
    buildIndex(subjects.values(), self, config, {
      demos: [...live.managed.values()],
      examples: [...examples.values()],
      crossValidation,
      signing: signingKey ? { alg: signingKey.alg, kid: signingKey.kid } : undefined,
    });
  let index = makeIndex();
  let indexHtml = renderIndexHtml(index, config.baseUrl);
  let indexJson = JSON.stringify(index, null, 2) + "\n";

  // The self report names a reporting period; with no pinned SELF_PERIOD that
  // default is the latest entered whole month, which goes stale in a long-lived
  // process. Regenerate lazily on the first request after a month rolls over.
  // (The index is period-independent — it carries only the self path/target —
  // so only the subject itself is rebuilt.)
  let currentSelf = self;
  let currentMonth = lastFullMonthPeriod(opts.now ?? clock()).start;
  const refreshSelf = async (): Promise<Subject> => {
    if (config.self.period) return currentSelf;
    // Still holding nothing: look again (a day may have passed) until the first object exists.
    if (currentSelf.empty) currentSelf = await selfSubject(undefined);
    const month = lastFullMonthPeriod(clock()).start;
    if (month !== currentMonth) {
      currentSelf = await selfSubject(undefined);
      currentMonth = month;
    }
    return currentSelf;
  };

  // Daily refresh of the live demonstration subjects: successful live builds
  // replace the served documents; failures keep the last good ones. The index
  // (HTML and JSON) is rebuilt when a document changed or an upstream failed,
  // so its `upstream-error` and `refreshed` fields stay truthful.
  const refreshLive = async (): Promise<void> => {
    const changed = await live.refreshAll();
    const failed = [...live.managed.values()].filter((m) => m.upstreamError).map((m) => m.spec.domain);
    if (changed.length === 0 && failed.length === 0) return;
    for (const m of live.managed.values()) {
      subjects.set(m.spec.domain, m.subject);
    }
    gw.index = index = makeIndex();
    gw.indexHtml = indexHtml = renderIndexHtml(index, config.baseUrl);
    gw.indexJson = indexJson = JSON.stringify(index, null, 2) + "\n";
    log({
      ts: clock().toISOString(),
      level: "info",
      event: "live-refresh",
      changed,
      ...(failed.length > 0 ? { failed } : {}),
    });
  };

  const gw: Gateway = {
    server: undefined as unknown as Server,
    config,
    subjects,
    examples,
    live,
    crossValidation,
    refreshLive,
    self,
    mediaTypeOverrides,
    index,
    indexHtml,
    indexJson,
    refreshSelf,
    signingKey,
    rateLimiter: createRateLimiter(config.rateLimit),
    validator: opts.validator === null ? undefined : new Validator({ clock: opts.clock, exclude: new Set(config.validatorExclude ?? []), ...(opts.validator ?? {}) }),
  };

  gw.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const { path: pathname, search } = splitTarget(rawUrl);

    const finish = (result: Result) => {
      res.writeHead(result.status, result.headers);
      if (method === "HEAD" || result.status === 304) res.end();
      else res.end(result.body);
      log({
        ts: new Date().toISOString(),
        level: result.status >= 500 ? "error" : "info",
        event: "request",
        method,
        // JSON.stringify escapes control characters, so a hostile path cannot
        // forge a log line. Truncated to keep one request to one bounded line.
        // A validator or badge request names another origin: that name is not
        // written to this log (the hosting provider's own request log still has
        // the request line; the legal notice says so).
        path: loggedPath(rawUrl),
        status: result.status,
        bytes: method === "HEAD" ? 0 : Buffer.byteLength(result.body),
        ms: Number(process.hrtime.bigint() - started) / 1e6,
      });
    };

    // Draft Security Considerations: a server that computes answers SHOULD rate-limit; this deployment limits every path. Applied
    // before routing so every path but the health check counts; the platform
    // health checker must never be throttled.
    const limited = async (): Promise<Result | undefined> => {
      if (pathname === "/healthz") return undefined;
      // The validator makes an outbound request on the caller's behalf, so a request that will cause a
      // retrieval has its own, stricter budget; a badge or check answered from the hourly cache costs
      // nothing outbound and only counts against the general limit (shared egress such as GitHub's
      // image proxy must be able to show many badges).
      const badge = BADGE_ROUTE.exec(pathname);
      const validatorRoute = pathname === VALIDATE_PATH || badge !== null;
      let limiter = gw.rateLimiter;
      let strict = false;
      if (validatorRoute && gw.validator?.limiter) {
        const host = badge ? badge[1].toLowerCase() : (new URLSearchParams(search).get("origin") ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
        // Chosen before the "no general limiter" exit, so the validator keeps its own limit even when
        // the deployment turns the general one off.
        if (host && !gw.validator.isFresh(host)) {
          limiter = gw.validator.limiter;
          strict = true;
        }
      }
      if (!limiter) return undefined;
      const decision = await limiter.check(clientKey(req, gw.config.rateLimit.trustProxy));
      if (decision.allowed) return undefined;
      // The per-client validator budget is the same kind of limit as the global one: this service did not
      // try, so it answers 503 with Retry-After and says nothing about the origin. The general limit is 429.
      const status = strict ? 503 : 429;
      if (badge) {
        // Never JSON on a badge URL: a README shows an image or nothing.
        return withBody(status, { ...corsHeaders(), "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(decision.retryAfterSec) },
          noticeBadgeSvg("try later", "Too many checks from this client; the origin was not checked."));
      }
      return jsonError(status, strict ? "this client's check budget is spent; retry after the indicated delay" : "rate limit exceeded; retry after the indicated delay", {
        "Retry-After": String(decision.retryAfterSec),
        "Cache-Control": "no-store",
      });
    };

    limited()
      .then(
        (refusal) =>
          refusal ??
          route(gw, method, rawUrl, {
            "if-none-match": req.headers["if-none-match"] as string | undefined,
            "if-modified-since": req.headers["if-modified-since"] as string | undefined,
          }),
      )
      .then(finish)
      .catch((err: unknown) => {
        log({
          ts: new Date().toISOString(),
          level: "error",
          event: "unhandled",
          method,
          path: loggedPath(rawUrl),
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) finish(jsonError(500, "internal server error"));
        else res.end();
      });
  });

  // Bound how long a slow client may hold a connection open.
  gw.server.headersTimeout = 10_000;
  gw.server.requestTimeout = 15_000;

  return gw;
}
