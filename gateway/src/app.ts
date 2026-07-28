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
import { handleRequest } from "sustainability-wellknown-publisher";
import { keplerReplayAdapter } from "./adapters/kepler-replay";
import { selfReportAdapter } from "./adapters/self-report";
import { LIMITS, type GatewayConfig } from "./config";
import { CORS_ORIGIN, corsHeaders, jsonError, methodNotAllowed, withBody, type Result } from "./http";
import {
  WELL_KNOWN_PATH,
  buildIndex,
  renderIndexHtml,
  type IndexDocument,
} from "./index-page";
import { loadRegistry, subjectFromAdapter, type Subject } from "./registry";

/** `/{domain}/.well-known/sustainability-data` — the primary route. */
const SUBJECT_ROUTE = /^\/([^/]{1,253})\/\.well-known\/sustainability-data$/;

/** Domain served by the adapter-generated demonstration document. */
export const KEPLER_DEMO_DOMAIN = "kepler-demo.example";

export interface Gateway {
  server: Server;
  config: GatewayConfig;
  /** Every subject the gateway serves, keyed by its route domain. */
  subjects: Map<string, Subject>;
  /** The gateway's own report (`target-type: "service"`). */
  self: Subject;
  index: IndexDocument;
  indexHtml: string;
}

export type LogFn = (line: Record<string, unknown>) => void;

const defaultLog: LogFn = (line) => process.stdout.write(JSON.stringify(line) + "\n");

export interface CreateGatewayOptions {
  config: GatewayConfig;
  log?: LogFn;
  /** Injectable clock, so the default self-report period is deterministic. */
  now?: Date;
}

/**
 * Serve one subject's document.
 *
 * The query is deliberately dropped: this gateway declares `capabilities:
 * "basic"`, and the draft requires a server that does not support the Extended
 * parameters to IGNORE them and return the Basic response rather than fail. It
 * also collapses every query string onto a single cache entry, which is the
 * draft's Denial-of-Service guidance (a bounded cache-key space).
 */
async function serveDocument(
  subject: Subject,
  config: GatewayConfig,
  ifNoneMatch: string | undefined,
): Promise<Result> {
  const r = await handleRequest(
    subject.publisher,
    {},
    { maxAge: config.maxAge, cors: CORS_ORIGIN },
    ifNoneMatch,
  );
  const headers: Record<string, string> = { ...r.headers, "Last-Modified": subject.lastModified };
  if (r.status === 200) {
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
  gw: Pick<Gateway, "config" | "subjects" | "self" | "index" | "indexHtml">,
  method: string,
  rawUrl: string,
  headers: { "if-none-match"?: string } = {},
): Promise<Result> {
  const url = new URL(rawUrl, "http://gateway.invalid");
  const path = url.pathname;
  const ifNoneMatch = headers["if-none-match"];

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
        "Cache-Control": `public, max-age=${gw.config.maxAge}`,
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
        "Cache-Control": `public, max-age=${gw.config.maxAge}`,
      },
      JSON.stringify(gw.index, null, 2) + "\n",
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
    return serveDocument(gw.self, gw.config, ifNoneMatch);
  }

  const m = SUBJECT_ROUTE.exec(path);
  if (m) {
    // Case-insensitive host matching (DNS is case-insensitive); the path is not
    // percent-decoded, so an encoded separator simply fails to match.
    const domain = m[1].toLowerCase();
    const subject =
      domain.length <= LIMITS.maxDomainLength ? gw.subjects.get(domain) : undefined;
    if (!subject) {
      // Draft "no-data rule": nothing published for this subject -> 404.
      return jsonError(
        404,
        "no sustainability metadata is published here for that reporting subject",
      );
    }
    return serveDocument(subject, gw.config, ifNoneMatch);
  }

  return jsonError(404, "not found");
}

/** Load data, wire the adapters, and build (but do not start) the HTTP server. */
export async function createGateway(opts: CreateGatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const log = opts.log ?? defaultLog;

  const subjects = await loadRegistry(config.dataDir);

  // ---- Worked adapter example #1: the gateway's own report, produced by the
  // published `computedAdapter` rather than hand-written. ----
  const self = await subjectFromAdapter({
    domain: "gateway.invalid", // never routed: served at the bare well-known path
    adapter: selfReportAdapter({
      target: config.self.target,
      provider: config.self.provider,
      methodologyUri: config.self.methodologyUri,
      disclosureUri: config.self.disclosureUri,
      period: config.self.period,
      watts: config.self.watts,
      gridIntensity: config.self.gridIntensity,
      now: opts.now,
    }),
    target: config.self.target,
    targetType: "service",
    label: "adapter:computed (gateway self-report)",
  });

  // ---- Worked adapter example #2: kepler-prometheus in replay mode, served
  // under a reserved .example name because its figures are synthetic. ----
  const keplerDemo = await subjectFromAdapter({
    domain: KEPLER_DEMO_DOMAIN,
    adapter: keplerReplayAdapter({
      target: KEPLER_DEMO_DOMAIN,
      methodologyUri: config.self.methodologyUri,
      gridIntensity: config.self.gridIntensity,
    }),
    target: KEPLER_DEMO_DOMAIN,
    targetType: "service",
    label: "adapter:kepler-prometheus (recorded fixture, replay mode)",
  });
  if (subjects.has(keplerDemo.domain)) {
    throw new Error(`gateway: ${keplerDemo.domain} is both a data file and an adapter subject`);
  }
  subjects.set(keplerDemo.domain, keplerDemo);

  const index = buildIndex(subjects.values(), self, config);
  const indexHtml = renderIndexHtml(index);
  const gw: Gateway = {
    server: undefined as unknown as Server,
    config,
    subjects,
    self,
    index,
    indexHtml,
  };

  gw.server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";

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

    route(gw, method, rawUrl, { "if-none-match": req.headers["if-none-match"] as string | undefined })
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
