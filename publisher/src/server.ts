/**
 * Standalone HTTP server using only the Node core `http` module (no framework).
 * Any web server (nginx, Apache, a CDN) can reverse-proxy `/.well-known/sustainability`
 * to this process. See `server-configurations/` in the repo root.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import {
  CarbonTxtServeOptions,
  CARBON_TXT_PATHS,
  carbonTxtResult,
  handleRequest,
  HandlerOptions,
  parseQuery,
  WELL_KNOWN_PATH,
} from "./handler";
import { Publisher } from "./publisher";

export interface ServerOptions extends HandlerOptions {
  /** Also answer at "/sustainability" (handy behind a path-stripping proxy). */
  extraPaths?: string[];
  /** When set, also serve a bidirectional carbon.txt at /carbon.txt and /.well-known/carbon.txt. */
  carbonTxt?: CarbonTxtServeOptions;
}

export function createSustainabilityServer(
  publisher: Publisher,
  opts: ServerOptions = {},
): Server {
  const paths = new Set([WELL_KNOWN_PATH, ...(opts.extraPaths ?? [])]);
  const carbonPaths = new Set(opts.carbonTxt ? CARBON_TXT_PATHS : []);

  // CORS header echoed on every response (incl. 404/405/500) so cross-origin
  // aggregators can read error statuses, not just 200s.
  const corsHeaders = (): Record<string, string> =>
    opts.cors === false ? {} : { "Access-Control-Allow-Origin": opts.cors ?? "*" };

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const isSustainability = paths.has(url.pathname);
      const isCarbonTxt = carbonPaths.has(url.pathname);

      if (!isSustainability && !isCarbonTxt) {
        res.writeHead(404, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { ...corsHeaders(), Allow: "GET, HEAD" });
        res.end();
        return;
      }

      if (isCarbonTxt) {
        const result = carbonTxtResult(opts.carbonTxt!, opts, req.headers.host);
        res.writeHead(result.status, result.headers);
        if (req.method === "HEAD") res.end();
        else res.end(result.body);
        return;
      }

      const query = parseQuery(Object.fromEntries(url.searchParams.entries()));
      const ifNoneMatch = req.headers["if-none-match"] as string | undefined;
      const result = await handleRequest(publisher, query, opts, ifNoneMatch);

      res.writeHead(result.status, result.headers);
      if (req.method === "HEAD" || result.status === 304) res.end();
      else res.end(result.body);
    } catch (err) {
      // Last-resort guard: anything thrown outside handleRequest's own catch
      // (e.g. a bad derived header) must still yield a response, not a hung socket.
      (opts.onError ?? ((e: unknown) => console.error("sustainability-publisher:", e)))(err);
      if (!res.headersSent) {
        res.writeHead(500, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error" }));
      } else {
        res.end();
      }
    }
  });
}
