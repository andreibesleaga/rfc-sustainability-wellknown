/**
 * Standalone HTTP server using only the Node core `http` module (no framework).
 * Any web server (nginx, Apache, a CDN) can reverse-proxy `/.well-known/sustainability`
 * to this process. See `server-configurations/` in the repo root.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { handleRequest, HandlerOptions, parseQuery, WELL_KNOWN_PATH } from "./handler";
import { Publisher } from "./publisher";

export interface ServerOptions extends HandlerOptions {
  /** Also answer at "/sustainability" (handy behind a path-stripping proxy). */
  extraPaths?: string[];
}

export function createSustainabilityServer(
  publisher: Publisher,
  opts: ServerOptions = {},
): Server {
  const paths = new Set([WELL_KNOWN_PATH, ...(opts.extraPaths ?? [])]);

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!paths.has(url.pathname)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    const query = parseQuery(Object.fromEntries(url.searchParams.entries()));
    const ifNoneMatch = req.headers["if-none-match"] as string | undefined;
    const result = await handleRequest(publisher, query, opts, ifNoneMatch);

    res.writeHead(result.status, result.headers);
    if (req.method === "HEAD" || result.status === 304) res.end();
    else res.end(result.body);
  });
}
