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

interface FastifyLike {
  get(path: string, handler: (req: any, reply: any) => Promise<unknown>): unknown;
}

export interface FastifyPluginOptions extends HandlerOptions {
  publisher: Publisher;
  /** When set, also serve a bidirectional carbon.txt at /carbon.txt and /.well-known/carbon.txt. */
  carbonTxt?: CarbonTxtServeOptions;
}

export async function fastifySustainability(
  fastify: FastifyLike,
  options: FastifyPluginOptions,
): Promise<void> {
  const { publisher, carbonTxt, ...handlerOpts } = options;
  fastify.get(WELL_KNOWN_PATH, async (req: any, reply: any) => {
    const ifNoneMatch = req.headers?.["if-none-match"];
    const result = await handleRequest(
      publisher,
      parseQuery(req.query ?? {}),
      handlerOpts,
      ifNoneMatch,
    );
    reply.code(result.status).headers(result.headers);
    return result.status === 304 ? reply.send() : reply.send(result.body);
  });

  if (carbonTxt) {
    for (const path of CARBON_TXT_PATHS) {
      fastify.get(path, async (req: any, reply: any) => {
        const result = carbonTxtResult(carbonTxt, handlerOpts, req.headers?.host);
        reply.code(result.status).headers(result.headers);
        return reply.send(result.body);
      });
    }
  }
}

// Fastify auto-encapsulation opt-out marker (read by fastify-plugin if used).
(fastifySustainability as any)[Symbol.for("skip-override")] = true;
