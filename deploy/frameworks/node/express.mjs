// Express 5: one route for the declaration. For a dynamic, signed, Extended service use the
// publisher package's `expressSustainability(publisher)` middleware instead (see ../../../publisher/README.md).
import express from "express";
import { BODY, HEADERS, PATH, fresh } from "./declaration.mjs";

const app = express();
app.set("etag", false); // the recipe sets its own strong validator
app.route(PATH)
  .get((req, res) => (fresh(req.get("if-none-match")) ? res.set(HEADERS).status(304).end() : res.set(HEADERS).send(BODY)))
  .head((req, res) => res.set(HEADERS).status(fresh(req.get("if-none-match")) ? 304 : 200).end())
  .all((req, res) => res.set("Allow", "GET, HEAD").status(405).json({ error: "method not allowed" }));
app.listen(Number(process.env.PORT ?? 3000));
