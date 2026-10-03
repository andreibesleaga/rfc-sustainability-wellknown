// Fastify 5: one route for the declaration (the publisher package also ships `fastifySustainability`).
import Fastify from "fastify";
import { BODY, HEADERS, PATH, fresh } from "./declaration.mjs";

const app = Fastify();
app.route({ method: ["GET", "HEAD"], url: PATH, handler: (req, reply) =>
  fresh(req.headers["if-none-match"]) ? reply.headers(HEADERS).code(304).send() : reply.headers(HEADERS).send(BODY) });
app.route({ method: ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"], url: PATH,
  handler: (req, reply) => reply.header("Allow", "GET, HEAD").code(405).send({ error: "method not allowed" }) });
app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
