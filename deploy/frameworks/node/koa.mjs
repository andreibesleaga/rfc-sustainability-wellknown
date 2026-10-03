// Koa 3: one middleware for the declaration.
import Koa from "koa";
import { BODY, HEADERS, PATH, fresh } from "./declaration.mjs";

const app = new Koa();
app.use(async (ctx, next) => {
  if (ctx.path !== PATH) return next();
  if (ctx.method !== "GET" && ctx.method !== "HEAD") {
    ctx.status = 405; ctx.set("Allow", "GET, HEAD"); ctx.body = { error: "method not allowed" }; return;
  }
  ctx.set(HEADERS);
  if (fresh(ctx.get("if-none-match"))) { ctx.status = 304; return; }
  ctx.status = 200; ctx.body = BODY;
});
app.listen(Number(process.env.PORT ?? 3000));
