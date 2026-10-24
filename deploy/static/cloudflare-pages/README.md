# Cloudflare Pages
1. Put the document at `.well-known/sustainability-data` in the folder you publish (no extension).
2. Put `_headers` (this folder) at the root of the same output folder.
3. Deploy. Verify: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.host --strict`.

Workers variant (when the site is a Worker, not Pages): return the JSON from a route handler with the
same four headers; the free plan's cron trigger can regenerate it monthly. Transform Rules can add the
headers for a site whose origin cannot be changed.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
