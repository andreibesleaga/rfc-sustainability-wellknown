# nginx
Put `sustainability-data.conf` inside your `server { }` block (or `include` it) and the document at
`<root>/.well-known/sustainability-data`. `limit_except` turns other methods into `403`; the full file in
`server-configurations/nginx.conf` answers `405` with `Allow` instead and hardens TRACE.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
