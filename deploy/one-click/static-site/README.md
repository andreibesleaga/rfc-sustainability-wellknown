# Static-site template: one file, one click

A complete site: `index.html`, the declaration at `.well-known/sustainability-data`, and the header
configuration for Netlify (`_headers`, `netlify.toml`) and Vercel (`vercel.json`); Cloudflare Pages
reads the same `_headers`. Edit the declaration (your target, provider, methodology link, period and
figures), deploy, and verify:

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
