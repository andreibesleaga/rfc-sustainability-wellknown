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
import { handleRequest, HandlerOptions, parseQuery, WELL_KNOWN_PATH } from "../handler";
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

export function expressSustainability(publisher: Publisher, opts: HandlerOptions = {}) {
  return async function sustainabilityMiddleware(
    req: ReqLike,
    res: ResLike,
    next: NextLike,
  ): Promise<void> {
    const path = req.path ?? (req.url ?? "").split("?")[0];
    if (path !== WELL_KNOWN_PATH) return next();
    if (req.method && req.method !== "GET" && req.method !== "HEAD") return next();

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
