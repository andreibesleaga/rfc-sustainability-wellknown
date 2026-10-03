# Netlify
Either `_headers` or the `[[headers]]` block of `netlify.toml` (this folder); both set the same four
headers. The document goes to `.well-known/sustainability-data` in the publish directory. Netlify
serves extensionless files as-is, so the `Content-Type` rule is what gives it the right type.
