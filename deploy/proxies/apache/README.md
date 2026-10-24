# Apache / LiteSpeed
`.htaccess` (this folder) at the site root; the document at `.well-known/sustainability-data`; the file
`sustainability-405.json` (in `../../www/`) at the site root too, for the 405 body. A direct GET of that file
answers 200 with the JSON and an `Allow: GET, HEAD` header, which is harmless. Works on
shared hosting where only `.htaccess` can be edited (LiteSpeed honours it). The full virtual-host file
with a `405` body and TRACE hardening is `server-configurations/apache.conf`.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
