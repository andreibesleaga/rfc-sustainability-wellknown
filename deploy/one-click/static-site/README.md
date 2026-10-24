# Static-site template: one file, one click

A complete site: `index.html`, the declaration at `.well-known/sustainability-data`, and the header
configuration for Netlify (`_headers`, `netlify.toml`) and Vercel (`vercel.json`); Cloudflare Pages
reads the same `_headers`. Edit the declaration (your target, provider, methodology link, `period` and
figures; the period is a `start` and an `end` date-time, `end` excluded), deploy, and verify:

```
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.host --strict
```

## Deploy buttons
These work once this folder lives in its own public repository (owner step: create
`sustainability-data-site-template` from this folder, then replace the URL below):

```markdown
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/andreibesleaga/sustainability-data-site-template)
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/andreibesleaga/sustainability-data-site-template)
```

A deployment made from the template is that person's origin, served from their name once they attach
a custom domain; the platform's own `*.netlify.app` / `*.vercel.app` name counts as an origin too.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
