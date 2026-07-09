# Using `sustainability-wellknown-publisher`

This gateway is designed to be used in **three different ways**, all from the same
package — pick whichever fits your deployment, or mix them across environments
(e.g. the standalone binary in production, the library form in a test harness).

| Mode | When to use it | Section |
|---|---|---|
| **Standalone server** | You just want `/.well-known/sustainability` running; no existing Node app | [§1](#1-standalone-server-cli) |
| **Embedded middleware** | You already have an Express/Fastify app and want to add the endpoint to it | [§2](#2-embedded-middleware-in-an-existing-app) |
| **Library / programmatic** | You're on a different framework (Koa, Next.js, a serverless function, a plain `http` server, a cron job, a test) | [§3](#3-library-programmatic-usage-any-framework) |

Then: [§4 Writing a custom adapter](#4-writing-a-custom-adapter-extensibility),
[§5 Deployment recipes](#5-deployment-recipes), [§6 Installing from npm](#6-installing-from-npm),
[§7 Configuration reference](#7-configuration-reference).

---

## 1. Standalone server (CLI)

Zero code. Point the bundled CLI at a config file (see `examples/*.json` for one
per adapter) and it serves the endpoint directly.

```bash
npm install -g sustainability-wellknown-publisher   # or use npx, see §6
sustainability-publisher --config config.json --port 8080
curl http://localhost:8080/.well-known/sustainability
```

Or print one document and exit (for a cron job that writes a static file, feeding
`server-configurations/`'s static-file deployment):

```bash
sustainability-publisher --config config.json --once > /var/www/metadata/sustainability.json
```

Flags: `--config <path>` (required), `--port <n>` (default 8080), `--once` (print
and exit instead of serving), `--emit-carbon-txt` (also print a matching
carbon.txt to stderr). See `bin/sustainability-publisher.js` / `src/cli.ts`.

## 2. Embedded middleware in an existing app

If you already run Express or Fastify, add the endpoint to your existing server
instead of running a second process.

```ts
import express from "express";
import { Publisher, computedAdapter, expressSustainability } from "sustainability-wellknown-publisher";

const publisher = new Publisher(
  computedAdapter({
    provider: "Example Corp (sustain@example.org)",
    methodologyUri: "https://example.com/methodology",
    energy: { value: 1250, unit: "kWh" },
    gridIntensity: 276,
    capabilities: "extended",
  }),
);

const app = express();
app.use(expressSustainability(publisher));   // handles GET/HEAD, 405s, caching, carbon.txt
app.listen(3000);
```

Fastify is the same shape with `fastifySustainability` (see `README.md` §Fastify
plugin for the full example). Both middlewares implement every draft-required
behavior (405+`Allow`, conditional requests, CORS, optional bidirectional
carbon.txt) — you don't need to reimplement anything from §3 below unless you're
on a framework without a bundled middleware.

## 3. Library / programmatic usage (any framework)

Everything the middlewares do is built from two plain functions/classes you can
call directly: `new Publisher(adapter, options)` and `handleRequest(publisher, query, opts)`
(from `src/handler.ts`, also exported from the package root). This is the path for
Koa, Next.js API routes, AWS Lambda / Cloud Functions, Cloudflare Workers, a plain
`http.createServer`, a CI check, or a unit test.

### 3a. Just get the document (simplest — no HTTP semantics needed)

```ts
import { Publisher, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));
const doc = await publisher.getDocument({ period: "2026-02" }); // validated, ready to serve/store
```

This is enough for a cron job, a build step, or feeding a static-file deployment
(§1's `--once` is a thin CLI wrapper around exactly this call).

### 3b. Full HTTP semantics without an Express/Fastify dependency

`handleRequest` implements everything the middlewares do (status codes, `Allow`,
`ETag`/conditional requests, CORS, caching headers) as a plain function returning
`{ status, headers, body }` — wire it into any request/response model:

```ts
import { Publisher, handleRequest, parseQuery, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

// Next.js (Pages Router) API route, app/.well-known/sustainability/route.ts (App Router
// equivalent is analogous), AWS Lambda (API Gateway proxy integration), Cloudflare
// Workers `fetch` handler, Koa middleware, or a plain node:http server — all follow
// this same shape: parse the incoming query string, call handleRequest, map the
// result onto your framework's response object.

async function onRequest(rawQuery: Record<string, string | string[]>, method: string, ifNoneMatch?: string) {
  const result = await handleRequest(publisher, parseQuery(rawQuery), {}, ifNoneMatch);
  return result; // { status, headers, body } — send as-is
}
```

Concretely, for a plain Node HTTP server:

```ts
import { createServer } from "node:http";
import { URL } from "node:url";
import { Publisher, handleRequest, parseQuery, WELL_KNOWN_PATH, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== WELL_KNOWN_PATH) return res.writeHead(404).end();
  const query = Object.fromEntries(url.searchParams);
  const result = await handleRequest(publisher, parseQuery(query), {}, req.headers["if-none-match"] as string);
  res.writeHead(result.status, result.headers);
  res.end(req.method === "HEAD" ? undefined : result.body);
}).listen(8080);
```

For a serverless function (AWS Lambda behind API Gateway, a Cloudflare Worker,
etc.), the pattern is identical: extract the query string and `If-None-Match`
header from whatever event object your platform hands you, call `handleRequest`,
and map `{status, headers, body}` onto your platform's response shape. `Publisher`
holds no server-specific state, so it's safe to construct once per cold start
(module scope) and reuse across invocations — see §5 for a worked serverless note.

### 3c. Advanced: build the pipeline yourself

If you need to hook in at a lower level (e.g. inspect the raw adapter output
before validation, or apply your own caching layer instead of `Publisher`'s
built-in one), the individual pipeline stages are all exported: an adapter's
`fetch()`, `normalize()`, `secureReports()`, `validateDocument()`/`assertValid()`.
`Publisher.build()` is a thin, ~15-line composition of exactly these four calls
(`src/publisher.ts`) — read it as the reference wiring if you need to diverge
from it.

## 4. Writing a custom adapter (extensibility)

The package ships ten adapters (`static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`,
`watershed`), but any data source can plug in by implementing one interface:

```ts
export interface SourceAdapter {
  name: string;
  capabilities: "basic" | "extended";
  fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]>;
}
```

`RawMetrics` (from `src/types.ts`) is the gateway's internal, camelCase model —
`normalize()` converts it to the draft's wire field names/units, so your adapter
never has to think about `energy-consumption` vs `energyKwh` unit conversion,
rounding, or JSON key casing. A minimal custom adapter:

```ts
import { Publisher, RawMetrics, SourceAdapter } from "sustainability-wellknown-publisher";

function myAdapter(): SourceAdapter {
  return {
    name: "my-internal-metering-system",
    capabilities: "extended",
    async fetch(query): Promise<RawMetrics> {
      const row = await myInternalMeteringApi.getLatest(query.target);
      return {
        provider: "My Company (sustain@mycompany.example)",
        measurementMethod: "hardware-metered",
        methodologyUri: "https://mycompany.example/methodology",
        reportingPeriod: row.period,        // "YYYY", "YYYY-MM", or "YYYY-MM-DD"
        energy: { value: row.kwh, unit: "kWh" },
        carbon: { value: row.gCO2e, unit: "gCO2e" },
      };
    },
  };
}

const publisher = new Publisher(myAdapter());
```

Study `src/adapters/computed.ts` (simplest) and `src/adapters/enterprise/watershed.ts`
(shows fail-loud validation of upstream data — never silently publish a guessed
period or a zero that should have been "not reported") as the two reference
shapes to copy from. Every built-in adapter also ships a `fixture`/`fixturePages`
replay-mode option for offline testing without live credentials — copy that
pattern too if you want your custom adapter to be test-friendly.

**Returning an array** (`RawMetrics[]`) from `fetch()` signals a trend; the
gateway sorts it, applies the safeguards (366-cap, most-recent-first truncation),
and — per the draft's response-shape rule — still collapses to a single object
unless the request's `granularity` parameter was set. You don't need to implement
that rule yourself; `Publisher.build()` already does.

## 5. Deployment recipes

**Docker** (standalone server):
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY bin ./bin
COPY config.json ./config.json
EXPOSE 8080
CMD ["node", "bin/sustainability-publisher.js", "--config", "config.json", "--port", "8080"]
```

**Behind nginx/Apache for TLS + rate limiting**: run the standalone server (or
your embedded app) on a local port and reverse-proxy to it — see
`server-configurations/nginx.conf` and `apache.conf` for the tested, commented-out
`proxy_pass`/`ProxyPass` blocks (verified end-to-end against this gateway).

**Serverless (Lambda / Cloud Functions / Workers)**: construct `Publisher` once
at module scope (cold-start init), and call `handleRequest` per invocation (§3b).
Prefer a longer `cacheTtlMs` (the in-memory cache survives warm invocations on
most platforms) or set `cacheTtlMs: 0` and rely on your platform's own edge/CDN
caching using the `Cache-Control`/`ETag` headers the gateway already returns.

**Static-file deployment (no Node runtime at all)**: run `--once` on a schedule
(cron/CI) to regenerate a static JSON file, and serve it with the plain
`server-configurations/` snippets (no reverse proxy needed) — this gets you the
Basic service level with zero ongoing Node process, at the cost of no dynamic
Extended query-parameter support (see those files' READMEs for the tradeoff).

## 6. Installing from npm

Published: **[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)**.

```bash
npm install sustainability-wellknown-publisher
```

A git checkout or a git-based install also work, e.g. for tracking `main` ahead of
a release:

```bash
npm install /path/to/rfc-sustainability-wellknown/publisher
npm install github:andreibesleaga/rfc-sustainability-wellknown#main:publisher
```

Publishing itself (`npm publish`, from a clean `publisher/` directory, after
`npm run build`) is a deliberate, one-way step — do it when you're ready to
commit to that package name and version publicly, not as part of routine repo
maintenance.

## 7. Configuration reference

The three option bags accepted by `new Publisher(adapter, options)`:

- **`PublisherOptions`** (`src/publisher.ts`): `cacheTtlMs` (default 86 400 000 =
  24h; `0` disables caching), `maxCacheEntries` (default 256, bounds the
  per-query-variant cache), `security` (see below), `normalize` (`carbonUnit` to
  force a specific output unit).
- **`SecurityOptions`** (`src/security.ts`): `maxObjects` (default 366),
  `enforceDailyFloor` (default `true`), `applyNoise` (default `false`; when
  `true`, deterministic per-period ~1% noise per the draft's Hardware
  Fingerprinting rules).
- **Handler/middleware options** (`HandlerOptions`, `src/handler.ts`): `cors`
  (default `"*"`; `false` disables), `onError` (hook for 503 logging),
  `carbonTxt` (see `README.md` §Adapters for the bidirectional carbon.txt setup).

See `README.md` for the full adapter-by-adapter config field reference and the
JSON config-file schema used by the CLI.
