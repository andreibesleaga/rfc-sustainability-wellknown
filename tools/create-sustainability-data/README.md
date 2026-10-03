# create-sustainability-data

Seven questions, one conformant `/.well-known/sustainability-data` file, plus the configuration for
your host (Cloudflare Pages, Netlify, Vercel, nginx, Apache, Caddy, or just the file).

```bash
npx create-sustainability-data            # interactive
npx create-sustainability-data --target example.com --provider "Example Ltd (https://example.com/contact)" \
  --methodology-uri https://example.com/methodology --period 2026-09 --energy-kwh 12.5 --host netlify --out ./site
```

Nothing is estimated: a figure you do not have is left out; a file with no figure needs a disclosure
link. Then deploy and check: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.com --strict`.
No dependencies. Not yet published to npm (owner step: `npm publish --access public` from this folder).

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
