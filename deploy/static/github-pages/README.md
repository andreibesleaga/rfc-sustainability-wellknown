# GitHub Pages — cannot serve it conformantly
GitHub Pages serves an extensionless file as `application/octet-stream` and offers no custom response
headers; Jekyll cannot change that. Options: publish the site through Cloudflare Pages or Netlify
(free; `_headers` recipe), or keep GitHub Pages for the site and serve the declaration from a tiny
Worker/Pages project on a subdomain, or use the reference gateway as a relay with your consent.
Do not publish the file as `sustainability-data.json`: the canonical path has no extension.
