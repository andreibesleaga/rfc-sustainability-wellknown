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
  WELL_KNOWN_PATH,
} from "../handler";
import { Publisher } from "../publisher";

interface ReqLike {
  method?: string;
  path?: string;
  url?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}
interface ResLike {
  status(code: number): ResLike;
  set(headers: Record<string, string>): ResLike;
  send(body: string): unknown;
  end(): unknown;
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
  return async function sustainabilityMiddleware(
    req: ReqLike,
    res: ResLike,
    next: NextLike,
  ): Promise<void> {
    const path = req.path ?? (req.url ?? "").split("?")[0];
    const handledPath = path === WELL_KNOWN_PATH || (opts.carbonTxt && carbonPaths.has(path));
    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      // Draft: other methods on the well-known path SHOULD get 405 + Allow.
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

    const ifNoneMatch = req.headers?.["if-none-match"] as string | undefined;
    const result = await handleRequest(publisher, parseQuery(req.query ?? {}), opts, ifNoneMatch);

    res.status(result.status).set(result.headers);
    if (req.method === "HEAD" || result.status === 304) {
      res.end();
    } else {
      res.send(result.body);
    }
  };
}
