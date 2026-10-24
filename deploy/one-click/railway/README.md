# One-click node: a signed `/.well-known/sustainability-data` from environment variables

A tiny service on the publisher library. Set the variables in `.env.example`, deploy, done: the
library serves the declaration with the right headers, answers HEAD and 405, revalidates with ETag,
and signs every response (Ed25519; the public key travels in the signature). Nothing is written to disk.

## Variables

| Name | Required | Meaning |
|---|---|---|
| `SD_TARGET` | yes | what the figures are about (your host, organisation, service…) |
| `SD_PROVIDER` | yes | who publishes them and how to reach you (a role, not a person) |
| `SD_METHODOLOGY_URI` | yes | an `https://` page saying how the figures were obtained |
| `SD_PERIOD` | one of the two ways | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: the whole year, month or day in UTC, a completed period |
| `SD_START`, `SD_END` | one of the two ways | the period as two RFC 3339 date-times in upper case (`2026-09-01T00:00:00Z`, `2026-10-01T00:00:00Z`); `end` is excluded, so the next period starts where this one ends. Give both or neither; when given they win over `SD_PERIOD`. Write the offset of your accounting day (`+08:00`) when it does not start at midnight UTC |
| `SD_MEASUREMENT_METHOD` | yes | `hardware-metered` (a meter reading), `hardware-estimated`, `cloud-billing` or `third-party-modeled`; never defaulted, because it is a claim |
| `SD_ENERGY_KWH`, `SD_CARBON_KGCO2E`, `SD_DISCLOSURE_URI` | at least one | the figures, or a link to your report |
| `SD_SCOPE_1`, `SD_SCOPE_2`, `SD_SCOPE_3` | no | kgCO2e, like `SD_CARBON_KGCO2E` (negative only for removals) |
| `SD_TARGET_TYPE`, `SD_RENEWABLE_PERCENT`, `SD_CARBON_ACCOUNTING`, `SD_UPDATED` | no | as the draft defines them; `SD_TARGET_TYPE` is one of `origin` (default), `path`, `organization`, `facility`, `service`, `product`, `device`, `tenant`, `data-source` (a `path` target begins with `/`) |
| `SD_SIGNING_KEY_JWK` | no | a persistent private signing key (secret); without it each start uses a new key |

A value the draft does not allow stops the service at start with a message naming the variable, rather than
publishing a document that a consumer would reject. `.env.example` lists them all.

The node declares `capabilities` `basic`: it publishes one current report as one JSON object and ignores every query
parameter (`target`, `start`, `end`, `granularity` or any other), always answering 200 with that object. To hold several
periods and answer ranges, use the publisher library's Extended mode instead.

## Railway
Create a new project from this folder (Railway builds the Dockerfile), set the variables, deploy, then
point a domain of yours at the service (Settings → Networking → custom domain; CNAME at your DNS). The
declaration is then served from your own name, which is what makes it your origin's declaration.
Without `SD_SIGNING_KEY_JWK` each start signs with a fresh key (the log shows only its public half). To keep one
key: `npx -y -p sustainability-wellknown-publisher sustainability-publisher keygen --out key.jwk` on your machine,
then set `SD_SIGNING_KEY_JWK` to the file's content as a secret; never commit the file. To list this as a Railway template (owner step): dashboard → the project →
"Create template", add the variable descriptions from `.env.example`.

## Anywhere else
`docker build -t sustainability-data-node . && docker run -p 8080:8080 --env-file .env sustainability-data-node`
works on Render, Fly.io, Scaleway Serverless Containers, Google Cloud Run, Azure Container Apps and a VPS.

## Verify
`npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.domain.example --strict --verify`

Tests: `npm test` (starts the server on a loopback port and checks the document and its signature).

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
