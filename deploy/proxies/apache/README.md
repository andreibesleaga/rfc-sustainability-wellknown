# Apache / LiteSpeed
`.htaccess` (this folder) at the site root; the document at `.well-known/sustainability-data`; the file
`sustainability-405.json` (in `../../www/`) at the site root too, for the 405 body. A direct GET of that file
answers 200 with the JSON and an `Allow: GET, HEAD` header, which is harmless. Works on
shared hosting where only `.htaccess` can be edited (LiteSpeed honours it). The full virtual-host file
with a `405` body and TRACE hardening is `server-configurations/apache.conf`.
