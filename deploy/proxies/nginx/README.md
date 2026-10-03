# nginx
Put `sustainability-data.conf` inside your `server { }` block (or `include` it) and the document at
`<root>/.well-known/sustainability-data`. `limit_except` turns other methods into `403`; the full file in
`server-configurations/nginx.conf` answers `405` with `Allow` instead and hardens TRACE.
