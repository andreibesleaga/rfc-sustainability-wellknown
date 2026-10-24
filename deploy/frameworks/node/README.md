# Node.js
`express.mjs`, `fastify.mjs`, `koa.mjs` are complete servers (`npm install`, then `PORT=3000 npm run express`); they serve
`data/sustainability-data.json` beside the recipe, or the file named by `SD_FILE`;
they are started and validated in CI. The Next.js, Nuxt, SvelteKit and Astro files are the one route each
framework needs (reviewed, not started in CI), placed at the path shown in their first line; the document lives at
`data/sustainability-data.json` in the project (not under `public/`, so the extensionless canonical path
is the only one served).

For a signed, Extended service (periods, granularity, signatures) use the publisher package instead:
`npm install sustainability-wellknown-publisher`, then `expressSustainability(publisher)` or
`fastifySustainability`, or the standalone `sustainability-publisher` command.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
