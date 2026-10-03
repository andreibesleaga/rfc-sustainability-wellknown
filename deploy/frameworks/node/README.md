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
