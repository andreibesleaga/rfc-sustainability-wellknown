# Netlify
Either `_headers` or the `[[headers]]` block of `netlify.toml` (this folder); both set the same four
headers. The document goes to `.well-known/sustainability-data` in the publish directory. Netlify
serves extensionless files as-is, so the `Content-Type` rule is what gives it the right type.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
