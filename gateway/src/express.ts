/**
 * OPTIONAL Express mounting.
 *
 * The gateway's default server is `node:http` (see `app.ts`) for one reason:
 * the draft's Mandatory Minimum Supported Service pins exact status codes and
 * header sets — `HEAD` returning byte-identical headers with no body, `405`
 * with `Allow`, `304` without `Content-Type` — and a framework that helpfully
 * adds `X-Powered-By`, rewrites `ETag`, or synthesises its own `HEAD` handling
 * gets in the way of proving that. The core server has no dependencies and is
 * what the Dockerfile runs.
 *
 * Teams that already have an Express app can mount the very same `route()`
 * resolver instead, with no behavioural difference:
 *
 * ```ts
 * import express from "express";
 * import { createGateway } from "./app";
 * import { loadConfig } from "./config";
 * import { gatewayMiddleware } from "./express";
 *
 * const gw = await createGateway({ config: loadConfig() });
 * const app = express();
 * app.disable("x-powered-by");
 * app.disable("etag");           // the publisher supplies the strong ETag
 * app.use(gatewayMiddleware(gw));
 * app.listen(process.env.PORT ?? 8080, "0.0.0.0");
 * ```
 *
 * `express` is a devDependency here, not a runtime one — nothing in the
 * deployed image imports this file.
 */
import { route, type Gateway } from "./app";

/** Minimal structural types, so this file compiles without `@types/express`. */
interface ReqLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResLike {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: string): unknown;
}

export function gatewayMiddleware(gw: Gateway) {
  return function sustainabilityGateway(
    req: ReqLike,
    res: ResLike,
    next: (err?: unknown) => void,
  ): void {
    const method = req.method ?? "GET";
    const url = req.originalUrl ?? req.url ?? "/";
    const inm = req.headers["if-none-match"];
    route(gw, method, url, { "if-none-match": Array.isArray(inm) ? inm[0] : inm })
      .then((result) => {
        res.writeHead(result.status, result.headers);
        if (method === "HEAD" || result.status === 304) res.end();
        else res.end(result.body);
      })
      .catch(next);
  };
}
