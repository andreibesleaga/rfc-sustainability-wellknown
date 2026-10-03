# Cloudflare Pages
1. Put the document at `.well-known/sustainability-data` in the folder you publish (no extension).
2. Put `_headers` (this folder) at the root of the same output folder.
3. Deploy. Verify: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.host --strict`.

Workers variant (when the site is a Worker, not Pages): return the JSON from a route handler with the
same four headers; the free plan's cron trigger can regenerate it monthly. Transform Rules can add the
headers for a site whose origin cannot be changed.
