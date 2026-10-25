/**
 * Express middleware. Drop-in:
 *
 *   import express from "express";
 *   import { computedAdapter, Publisher, expressSustainability } from "sustainability-wellknown-publisher";
 *   const publisher = new Publisher(computedAdapter({...}));
 *   app.use(expressSustainability(publisher));
 *
 * Express is referenced only via structural (type-only) shapes, so this module
 * compiles and runs without Express installed for non-Express users.
 */
import {
  CarbonTxtServeOptions,
  CARBON_TXT_PATHS,
  carbonTxtResult,
  handleRequest,
  HandlerOptions,
  parseQuery,
  rateLimitGate,
  WELL_KNOWN_PATH,
} from "../handler";
import { Publisher } from "../publisher";

interface ReqLike {
  method?: string;
  path?: string;
  url?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  ip?: string;
  socket?: { remoteAddress?: string };
}
interface ResLike {
  status(code: number): ResLike;
  set(headers: Record<string, string>): ResLike;
  send(body: string): unknown;
  end(body?: string): unknown;
}
type NextLike = (err?: unknown) => void;

export interface ExpressSustainabilityOptions extends HandlerOptions {
  /** When set, also serve a bidirectional carbon.txt at /carbon.txt and /.well-known/carbon.txt. */
  carbonTxt?: CarbonTxtServeOptions;
}

export function expressSustainability(
  publisher: Publisher,
  opts: ExpressSustainabilityOptions = {},
) {
  const carbonPaths = new Set(opts.carbonTxt ? CARBON_TXT_PATHS : []);
  const rateLimited = rateLimitGate(opts, publisher);
  return async function sustainabilityMiddleware(
    req: ReqLike,
    res: ResLike,
    next: NextLike,
  ): Promise<void> {
    const path = req.path ?? (req.url ?? "").split("?")[0];
    const handledPath = path === WELL_KNOWN_PATH || (opts.carbonTxt && carbonPaths.has(path));
    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      // HTTP (RFC 9110): other methods on the well-known path get 405 + Allow.
      if (handledPath) {
        res
          .status(405)
          .set({
            Allow: "GET, HEAD",
            "Content-Type": "application/json",
            ...(opts.cors !== false ? { "Access-Control-Allow-Origin": opts.cors ?? "*" } : {}),
          });
        res.send(JSON.stringify({ error: "method not allowed" }));
        return;
      }
      return next();
    }

    if (opts.carbonTxt && carbonPaths.has(path)) {
      const host = req.headers?.host as string | undefined;
      const result = carbonTxtResult(opts.carbonTxt, opts, host);
      res.status(result.status).set(result.headers);
      if (req.method === "HEAD") res.end();
      else res.send(result.body);
      return;
    }

    if (path !== WELL_KNOWN_PATH) return next();

    const limited = rateLimited(req.ip ?? req.socket?.remoteAddress);
    if (limited) {
      res.status(limited.status).set(limited.headers);
      if (req.method === "HEAD") res.end();
      else res.end(limited.body);
      return;
    }

    const ifNoneMatch = req.headers?.["if-none-match"] as string | undefined;
    const { query } = parseQuery(req.query ?? {});
    const result = await handleRequest(publisher, query, opts, ifNoneMatch);

    res.status(result.status).set(result.headers);
    // `res.end`, not `res.send`: send() appends "; charset=utf-8" to the
    // Content-Type (the registered type defines no parameters) and would
    // give GET and HEAD different header fields.
    if (req.method === "HEAD" || result.status === 304) res.end();
    else res.end(result.body);
  };
}
