# Azure: Static Web Apps, or Blob static website

**Static Web Apps** (free tier): `staticwebapp.config.json` (this folder) at the app root sets the four
headers on the route and keeps the SPA fallback away from `/.well-known/*` (a fallback that answers
every path with HTML is the commonest way a deployment fails the check). The document goes to
`.well-known/sustainability-data` in the app's output folder.

**Blob static website**: set the blob's `Content-Type` and `Cache-Control` properties
(`az storage blob upload --content-type application/sustainability-data+json --content-cache-control "public, max-age=86400"`),
enable CORS on the storage account for GET/HEAD from `*`; `nosniff` needs Azure Front Door or CDN
rules-engine response headers. Carbon data: Azure Carbon Optimization (free, monthly, kgCO2e,
resource-level) can feed a `cloud-billing` figure.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
