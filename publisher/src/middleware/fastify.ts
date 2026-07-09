/**
 * Fastify plugin. Register with:
 *
 *   await app.register(fastifySustainability, { publisher });
 *
 * Fastify is referenced structurally so this compiles without Fastify installed.
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

type FastifyHandler = (req: any, reply: any) => Promise<unknown>;

interface FastifyRouteOptions {
  method: string | string[];
  url: string;
  handler: FastifyHandler;
}

/**
 * Structural shape of the subset of Fastify used here. `route` (present on a
 * real Fastify instance) lets us register a single handler for every HTTP
 * method so non-GET/HEAD requests can be answered with 405 rather than falling
 * through to Fastify's default 404. `get` is the fallback for minimal test
 * doubles that only implement route-per-method registration.
 */
interface FastifyLike {
  get(path: string, handler: FastifyHandler): unknown;
  route?(opts: FastifyRouteOptions): unknown;
}

export interface FastifyPluginOptions extends HandlerOptions {
  publisher: Publisher;
  /** When set, also serve a bidirectional carbon.txt at /carbon.txt and /.well-known/carbon.txt. */
  carbonTxt?: CarbonTxtServeOptions;
}

/**
 * HTTP methods registered so a single handler sees every request to the path.
 * GET is registered too so Fastify auto-generates the matching HEAD route.
 */
const ALL_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

/**
 * Register a handler for all methods on a path. On a real Fastify instance
 * (which has `route`) this routes every method to `handler`, so the handler can
 * emit 405 for non-GET/HEAD. Minimal test doubles that expose only `get` get
 * the handler registered there instead (the handler still branches on
 * `req.method`, so a POST-shaped request is answered with 405).
 */
function registerAllMethods(fastify: FastifyLike, path: string, handler: FastifyHandler): void {
  if (typeof fastify.route === "function") {
    fastify.route({ method: ALL_METHODS, url: path, handler });
  } else {
    fastify.get(path, handler);
  }
}

/** True for methods other than GET/HEAD (which get the 405 treatment). */
function isDisallowed(method: string | undefined): boolean {
  const m = (method ?? "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD";
}

export async function fastifySustainability(
  fastify: FastifyLike,
  options: FastifyPluginOptions,
): Promise<void> {
  const { publisher, carbonTxt, ...handlerOpts } = options;
  const cors: Record<string, string> =
    handlerOpts.cors !== false
      ? { "Access-Control-Allow-Origin": handlerOpts.cors ?? "*" }
      : {};

  /** Emit 405 + Allow: GET, HEAD, mirroring express.ts and server.ts. */
  const send405 = (reply: any) => {
    reply
      .code(405)
      .headers({ Allow: "GET, HEAD", "Content-Type": "application/json", ...cors });
    return reply.send(JSON.stringify({ error: "method not allowed" }));
  };

  registerAllMethods(fastify, WELL_KNOWN_PATH, async (req: any, reply: any) => {
    if (isDisallowed(req.method)) return send405(reply);
    const ifNoneMatch = req.headers?.["if-none-match"];
    const result = await handleRequest(
      publisher,
      parseQuery(req.query ?? {}),
      handlerOpts,
      ifNoneMatch,
    );
    reply.code(result.status).headers(result.headers);
    if (result.status === 304 || String(req.method).toUpperCase() === "HEAD") {
      return reply.send();
    }
    return reply.send(result.body);
  });

  if (carbonTxt) {
    for (const path of CARBON_TXT_PATHS) {
      registerAllMethods(fastify, path, async (req: any, reply: any) => {
        if (isDisallowed(req.method)) return send405(reply);
        const result = carbonTxtResult(carbonTxt, handlerOpts, req.headers?.host);
        reply.code(result.status).headers(result.headers);
        if (String(req.method).toUpperCase() === "HEAD") return reply.send();
        return reply.send(result.body);
      });
    }
  }
}

// Fastify auto-encapsulation opt-out marker (read by fastify-plugin if used).
(fastifySustainability as any)[Symbol.for("skip-override")] = true;
