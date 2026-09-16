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
  badRequestResult,
  handleRequest,
  importSigningKey,
  parseQuery,
  queryFromSearchParams,
  type ServiceQuery,
  type SigningKey,
} from "sustainability-wellknown-publisher";
import { verifyEmbeddedSignature } from "sustainability-wellknown-consumer";
import { demoSpecs } from "./adapters/demo-specs";
import { lastCompletedMonth, selfReportAdapter } from "./adapters/self-report";
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
import { loadNoData, NO_DATA_FILE, type NoDataEntry } from "./no-data";
import { clientKey, createRateLimiter, type RateLimiter } from "./rate-limit";
import { loadRegistry, subjectFromAdapter, type Subject } from "./registry";
import { crossValidate, type CrossValidation } from "./verify";

/** `/{domain}/.well-known/sustainability-data` — the primary route. */
const SUBJECT_ROUTE = new RegExp(`^/([^/]{1,${LIMITS.maxDomainLength}})/\\.well-known/sustainability-data$`);
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
   * Returns the self subject for the CURRENT reporting period. The draft's
   * Basic service requires the most recently completed period, so when the
   * month rolls over (and no fixed SELF_PERIOD is pinned) the self report is
   * regenerated instead of freezing at whatever month the process booted in.
   */
  refreshSelf?: () => Promise<Subject>;
  /** Subjects known to publish nothing machine-readable, keyed by domain. */
  noData: Map<string, NoDataEntry>;
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
}

/** `Last-Modified` for a served body: the `updated` of the object, or of an array's last entry. */
function lastUpdatedIn(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { updated?: string } | { updated?: string }[];
    const last = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
    const d = new Date(String(last?.updated));
    return Number.isNaN(d.getTime()) ? undefined : d.toUTCString();
  } catch {
    return undefined;
  }
}

/**
 * Serve one subject's document.
 *
 * The query is dropped for every subject except the wire-format examples that
 * themselves declare `capabilities: "extended"`: the draft requires a server
 * that does not support the Extended parameters to IGNORE them and return the
 * Basic response rather than fail, and dropping the query also collapses every
 * query string onto a single cache entry (the draft's Denial-of-Service
 * guidance — a bounded cache-key space). For the declared-extended examples
 * only `granularity` is passed through; the handler ignores unknown values,
 * so the key space stays bounded there too.
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
  // A query variant describes a different period than the subject's own
  // document, so its `Last-Modified` comes from the variant's `updated`.
  if (r.status === 200 && Object.values(query).some((v) => v !== undefined)) {
    const variantUpdated = lastUpdatedIn(r.body);
    if (variantUpdated) headers["Last-Modified"] = variantUpdated;
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
    // The `provider` member is human-readable text; the draft's
    // Internationalization Considerations ask publishers to identify its
    // language at the HTTP layer. No negotiation is offered, so no `Vary`.
    headers["Content-Language"] = "en";
    return withBody(200, headers, r.body);
  }
  return { status: r.status, headers, body: r.body };
}

/** Resolve one request to a fully-formed response. Exported for tests. */
export async function route(
  gw: Pick<
    Gateway,
    "config" | "subjects" | "self" | "noData" | "mediaTypeOverrides" | "index" | "indexHtml" | "indexJson"
  > &
    Partial<Pick<Gateway, "refreshSelf" | "examples" | "signingKey">>,
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
    path === WELL_KNOWN_PATH ||
    SUBJECT_ROUTE.test(path);

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

  if (path === "/healthz") {
    return withBody(
      200,
      { ...corsHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" },
      JSON.stringify({ status: "ok", subjects: gw.subjects.size }) + "\n",
    );
  }

  if (path === WELL_KNOWN_PATH) {
    const self = gw.refreshSelf ? await gw.refreshSelf() : gw.self;
    // The self report is an Extended publisher, so the draft's numbered
    // query procedure applies in full: a repeated defined parameter or a
    // malformed `period` is 400, an unknown `granularity` value is ignored,
    // and a `target` is matched against the published prefix set — which for
    // one process with no path prefixes is empty, so any value is 404.
    const parsed = extendedQuery(search, { maxAge: selfMaxAge(gw.config) });
    if (!parsed.ok) return parsed.result;
    return serveDocument(self, { ...gw.config, maxAge: selfMaxAge(gw.config) }, ifNoneMatch, ifModifiedSince, gw.config.mediaType, parsed.query);
  }

  const m = SUBJECT_ROUTE.exec(path);
  if (m) {
    // Case-insensitive host matching (DNS is case-insensitive); the path is not
    // percent-decoded, so an encoded separator simply fails to match.
    const domain = m[1].toLowerCase();
    const subject = gw.subjects.get(domain);
    if (!subject) {
      // Draft "no-data rule": nothing published for this subject -> 404. For a
      // subject the operator deliberately looked for and could not publish, the
      // status is the same 404 but the body carries the finding and its
      // evidence, so the absence is legible rather than indistinguishable from
      // a typo.
      const gap = gw.noData.get(domain);
      if (gap) {
        return withBody(
          404,
          { ...corsHeaders(), "Content-Type": "application/json", "Content-Language": "en" },
          JSON.stringify(
            {
              status: 404,
              error: "no sustainability metadata is published here for that reporting subject",
              reason: gap.status,
              entity: gap.entity,
              finding: gap.finding,
              evidence: gap.evidence,
              ...(gap.see ? { see: `/${gap.see}${WELL_KNOWN_PATH}` } : {}),
              checked: gap.checked,
            },
            null,
            2,
          ) + "\n",
        );
      }
      return jsonError(
        404,
        "no sustainability metadata is published here for that reporting subject",
      );
    }
    // Extended parameters pass through only for the wire-format examples that
    // declare `capabilities: "extended"`; the publisher's own selection rule
    // then decides (an array only for a granularity finer than the period),
    // and the draft's numbered procedure gives 400 for a repeated or
    // malformed parameter and 404 for an unpublished `target`. Every other
    // subject is Basic: it supports none of the parameters, so the draft says
    // it MUST ignore them and return the Basic response, never an error.
    const mediaType = gw.mediaTypeOverrides.get(domain) ?? gw.config.mediaType;
    let query: ServiceQuery = {};
    if (gw.examples?.get(domain)?.granularity) {
      const parsed = extendedQuery(search, { maxAge: gw.config.maxAge });
      if (!parsed.ok) return parsed.result;
      query = parsed.query;
    }
    return serveDocument(subject, gw.config, ifNoneMatch, ifModifiedSince, mediaType, query);
  }

  return jsonError(404, "not found");
}

/** Path and query string of a request target, split once for routing, rate limiting and parameters. */
export function splitTarget(rawUrl: string): { path: string; search: URLSearchParams } {
  const q = rawUrl.indexOf("?");
  return q === -1
    ? { path: rawUrl, search: new URLSearchParams() }
    : { path: rawUrl.slice(0, q), search: new URLSearchParams(rawUrl.slice(q + 1)) };
}

/**
 * The draft's Extended query procedure for a subject this gateway does honour
 * the parameters on, applied with the published library's own `parseQuery`:
 *
 *  - a defined parameter given more than once, or a `period` that is not a
 *    real calendar year/month/day, is `400 Bad Request` (steps 1 and 2);
 *  - a `granularity` value that is not `monthly` or `daily` is ignored (step 3);
 *  - a `target` is compared with the publisher's PUBLISHED set of path
 *    prefixes (step 4). This gateway publishes an empty prefix set for every
 *    subject it serves — one process with no path prefixes, and relayed
 *    documents whose subjects are whole organizations — so a `target` matches
 *    nothing and the answer is `404`. The value is never echoed: every
 *    unmatched target gets the identical response (Privacy Considerations).
 *
 * `queryFromSearchParams` is what preserves a repeated name; collapsing the
 * query into a plain object first would hide the very duplication step 1 is
 * about.
 */
type ExtendedQuery = { ok: true; query: ServiceQuery } | { ok: false; result: Result };

function extendedQuery(search: URLSearchParams, opts: { maxAge: number }): ExtendedQuery {
  const parsed = parseQuery(queryFromSearchParams(search));
  if (!parsed.ok) {
    const r = badRequestResult(parsed.error, { maxAge: opts.maxAge, cors: CORS_ORIGIN });
    return { ok: false, result: withBody(r.status, r.headers, r.body) };
  }
  if (parsed.query.target !== undefined) {
    return {
      ok: false,
      result: jsonError(404, "no declaration published for the requested target"),
    };
  }
  return { ok: true, query: { period: parsed.query.period, granularity: parsed.query.granularity } };
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
  const noData = loadNoData(config.dataDir);
  const mediaTypeOverrides = loadMediaTypeOverrides(config.dataDir);
  const clock = opts.clock ?? (() => new Date());
  /**
   * The clock the self report sees: the injected running clock when there is
   * one (month-rollover tests advance it), else the fixed `now`, else real time.
   */
  const selfClock = () => (opts.clock ? opts.clock() : opts.now ?? new Date());

  // ---- The signing key for the gateway's OWN report (draft -07 §Signing).
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
  const selfAdapter = (period: string | undefined) =>
    selfReportAdapter({
      target: config.self.target,
      provider: config.self.provider,
      methodologyUri: config.self.methodologyUri,
      disclosureUri: config.self.disclosureUri,
      period,
      watts: config.self.watts,
      gridIntensity: config.self.gridIntensity,
      liveSince: config.self.liveSince,
      verifiableAttestationUri: config.self.verifiableAttestationUri,
      clock: selfClock,
    });
  const selfSubject = (period: string | undefined) =>
    subjectFromAdapter({
      domain: "gateway.invalid", // never routed: served at the bare well-known path
      adapter: selfAdapter(period),
      target: config.self.target,
      targetType: "service",
      label: "adapter:computed (gateway self-report)",
      cacheTtlMs: SELF_CACHE_TTL_MS,
      maxCacheEntries: SELF_CACHE_ENTRIES,
      // Draft -07 §Signing: the publisher inserts the `signed` member into
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
  const specs: LiveSpec[] = demoSpecs({ config, crawlBytes });
  for (const spec of specs) {
    if (subjects.has(spec.domain)) {
      throw new Error(`gateway: ${spec.domain} is both a data file and an adapter demo`);
    }
  }
  await live.init(specs);
  for (const m of live.managed.values()) {
    subjects.set(m.spec.domain, m.subject);
  }

  // ---- Consumer cross-validation: every served document must satisfy the
  // published consumer library, or the gateway refuses to start. ----
  const crossValidation = await crossValidate(
    [self, ...subjects.values()],
    examples.values(),
  );

  // ---- Boot self-check of the signature: take the self declaration exactly
  // as it will be served and verify its embedded `signed` member with the
  // consumer library, in-process. A signature the ecosystem's own verifier
  // rejects must not go live. ----
  if (signingKey) {
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

  for (const domain of noData.keys()) {
    if (subjects.has(domain)) {
      throw new Error(
        `gateway: ${domain} is listed in ${NO_DATA_FILE} but also has a data file — ` +
          `a subject either publishes something or it does not`,
      );
    }
  }

  for (const domain of mediaTypeOverrides.keys()) {
    if (!subjects.has(domain)) {
      throw new Error(
        `gateway: ${domain} is listed in ${MEDIA_TYPE_FILE} but is not a served subject`,
      );
    }
  }

  const makeIndex = (): IndexDocument =>
    buildIndex(subjects.values(), self, config, noData.values(), {
      demos: [...live.managed.values()],
      examples: [...examples.values()],
      crossValidation,
      signing: signingKey ? { alg: signingKey.alg, kid: signingKey.kid } : undefined,
    });
  let index = makeIndex();
  let indexHtml = renderIndexHtml(index, config.baseUrl);
  let indexJson = JSON.stringify(index, null, 2) + "\n";

  // The self report names a reporting period; with no pinned SELF_PERIOD that
  // default is the last completed month, which goes stale in a long-lived
  // process. Regenerate lazily on the first request after a month rolls over.
  // (The index is period-independent — it carries only the self path/target —
  // so only the subject itself is rebuilt.)
  let currentSelf = self;
  let currentMonth = config.self.period ?? lastCompletedMonth(opts.now ?? clock());
  const refreshSelf = async (): Promise<Subject> => {
    if (config.self.period) return currentSelf;
    const month = lastCompletedMonth(clock());
    if (month !== currentMonth) {
      currentSelf = await selfSubject(month);
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
    noData,
    mediaTypeOverrides,
    index,
    indexHtml,
    indexJson,
    refreshSelf,
    signingKey,
    rateLimiter: createRateLimiter(config.rateLimit),
  };

  gw.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const { path: pathname } = splitTarget(rawUrl);

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
        path: rawUrl.slice(0, 512),
        status: result.status,
        bytes: method === "HEAD" ? 0 : Buffer.byteLength(result.body),
        ms: Number(process.hrtime.bigint() - started) / 1e6,
      });
    };

    // Draft Security Considerations §Denial of Service: rate-limit the well-known URI. Applied
    // before routing so every path but the health check counts; the platform
    // health checker must never be throttled.
    const limited = async (): Promise<Result | undefined> => {
      if (!gw.rateLimiter || pathname === "/healthz") return undefined;
      const decision = await gw.rateLimiter.check(clientKey(req, gw.config.rateLimit.trustProxy));
      if (decision.allowed) return undefined;
      return jsonError(429, "rate limit exceeded; retry after the indicated delay", {
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
          path: rawUrl.slice(0, 512),
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
