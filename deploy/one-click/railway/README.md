# One-click node: a signed `/.well-known/sustainability-data` from environment variables

A tiny service on the publisher library. Set the variables in `.env.example`, deploy, done: the
library serves the declaration with the right headers, answers HEAD and 405, revalidates with ETag,
and signs every response (EdDSA; the public key travels in the signature). Nothing is written to disk.

## Variables

| Name | Required | Meaning |
|---|---|---|
| `SD_TARGET` | yes | what the figures are about (your host, organisation, service…) |
| `SD_PROVIDER` | yes | who publishes them and how to reach you (a role, not a person) |
| `SD_METHODOLOGY_URI` | yes | an `https://` page saying how the figures were obtained |
| `SD_PERIOD` | yes | `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, a completed period |
| `SD_MEASUREMENT_METHOD` | yes | `hardware-metered` (a meter reading), `hardware-estimated`, `cloud-billing` or `third-party-modeled`; never defaulted, because it is a claim |
| `SD_ENERGY_KWH`, `SD_CARBON_KGCO2E`, `SD_DISCLOSURE_URI` | at least one | the figures, or a link to your report |
| `SD_SCOPE_1`, `SD_SCOPE_2`, `SD_SCOPE_3` | no | kgCO2e, like `SD_CARBON_KGCO2E` (negative only for removals) |
| `SD_TARGET_TYPE`, `SD_RENEWABLE_PERCENT`, `SD_CARBON_ACCOUNTING`, `SD_UPDATED` | no | as the draft defines them |
| `SD_SIGNING_KEY_JWK` | no | a persistent private signing key (secret); without it each start uses a new key |

A value the draft does not allow stops the service at start with a message naming the variable, rather than
publishing a document that a consumer would reject. `.env.example` lists them all.

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
