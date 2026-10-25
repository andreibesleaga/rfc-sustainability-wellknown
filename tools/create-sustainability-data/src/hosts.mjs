/**
 * The configuration each static host needs so that the file is served with the media type of the draft.
 */
export const HOSTS = ["file", "cloudflare-pages", "netlify", "vercel", "nginx", "apache", "caddy"];

const HEADERS = `/.well-known/sustainability-data
  Content-Type: application/sustainability-data+json
  X-Content-Type-Options: nosniff
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
`;

/** The files to write for a host, relative to the output folder. */
export function filesFor(host, doc) {
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  const files = { ".well-known/sustainability-data": body };
  switch (host) {
    case "cloudflare-pages":
    case "netlify":
      files["_headers"] = HEADERS;
      break;
    case "vercel":
      files["vercel.json"] = `${JSON.stringify({ headers: [{ source: "/.well-known/sustainability-data", headers: [
        { key: "Content-Type", value: "application/sustainability-data+json" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Cache-Control", value: "public, max-age=86400" },
      ] }] }, null, 2)}\n`;
      break;
    case "nginx":
      files["sustainability-data.nginx.conf"] = `location = /.well-known/sustainability-data {
    default_type application/sustainability-data+json;
    add_header Cache-Control "public, max-age=86400" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header X-Content-Type-Options "nosniff" always;
    limit_except GET HEAD { deny all; }  # other methods get 403 here; for 405 with Allow: GET, HEAD use server-configurations/nginx.conf
}
`;
      break;
    case "apache":
      files[".htaccess"] = `<Files "sustainability-data">
    ForceType application/sustainability-data+json
    Header set X-Content-Type-Options "nosniff"
    Header set Access-Control-Allow-Origin "*"
    Header set Cache-Control "public, max-age=86400"
</Files>
`;
      break;
    case "caddy":
      files["Caddyfile.snippet"] = `@decl path /.well-known/sustainability-data
handle @decl {
\theader Content-Type application/sustainability-data+json
\theader X-Content-Type-Options nosniff
\theader Access-Control-Allow-Origin *
\theader Cache-Control "public, max-age=86400"
\tfile_server
}
`;
      break;
    case "file":
      break;
    default:
      throw new Error(`host must be one of ${HOSTS.join(", ")}`);
  }
  return files;
}
