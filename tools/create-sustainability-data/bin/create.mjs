#!/usr/bin/env node
/**
 * create-sustainability-data: seven questions, one conformant file, the host's configuration.
 *
 *   npx create-sustainability-data                 # interactive
 *   npx create-sustainability-data --target example.com --provider "Example Ltd (https://example.com/contact)" \
 *       --methodology-uri https://example.com/methodology --period 2026-09 --energy-kwh 12.5 \
 *       --carbon-kgco2e 3.06 --host netlify --out ./site
 *
 * Writes <out>/.well-known/sustainability-data plus the host's file (_headers, vercel.json, a
 * server snippet) and prints the command that checks the result. Nothing is estimated: a figure
 * you do not have is left out, and a file with no figure needs a disclosure link.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";

export const HOSTS = ["file", "cloudflare-pages", "netlify", "vercel", "nginx", "apache", "caddy"];
const METHODS = ["third-party-modeled", "hardware-estimated", "cloud-billing", "hardware-metered"];
const TYPES = ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"];

const KNOWN_OPTIONS = ["out", "host", "target", "target-type", "provider", "methodology-uri", "period", "energy-kwh", "carbon-kgco2e", "disclosure-uri", "measurement-method", "updated"];

export function parseArgs(args) {
  const o = { out: ".", host: "file", "target-type": "origin", "measurement-method": "third-party-modeled" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    if (k === "help" || k === "yes") { o[k] = true; continue; }
    if (!KNOWN_OPTIONS.includes(k)) throw new Error(`unknown option ${a} (see --help)`);
    const v = args[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
    o[k] = v;
  }
  return o;
}

const HEADERS = `/.well-known/sustainability-data
  Content-Type: application/sustainability-data+json
  X-Content-Type-Options: nosniff
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=86400
`;

/** YYYY, YYYY-MM or YYYY-MM-DD that exists in the calendar. */
export function isPeriod(p) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(p);
  if (!m) return false;
  const [, y, mo, d] = m;
  if (mo !== undefined && (Number(mo) < 1 || Number(mo) > 12)) return false;
  if (d !== undefined) {
    const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return false;
  }
  return true;
}

/** The declaration from answers; throws when the answers cannot make one. */
export function declarationFrom(a) {
  const need = (k) => {
    if (!a[k] || String(a[k]).trim() === "") throw new Error(`${k} is required`);
    return String(a[k]).trim();
  };
  const num = (k) => {
    if (a[k] === undefined || a[k] === "") return undefined;
    const n = Number(a[k]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a non-negative number`);
    return n;
  };
  const methodology = need("methodology-uri");
  if (!/^https:\/\//.test(methodology)) throw new Error("methodology-uri must start with https://");
  const period = need("period");
  if (!isPeriod(period)) throw new Error("period must be YYYY, YYYY-MM or YYYY-MM-DD, a real calendar date");
  const energy = num("energy-kwh");
  const carbon = num("carbon-kgco2e");
  const disclosure = a["disclosure-uri"] ? String(a["disclosure-uri"]).trim() : "";
  if (disclosure && !/^https:\/\//.test(disclosure)) throw new Error("disclosure-uri must start with https://");
  if (energy === undefined && carbon === undefined && !disclosure) {
    throw new Error("give energy-kwh, carbon-kgco2e or disclosure-uri: a declaration carries a figure or an evidence link");
  }
  if (!METHODS.includes(a["measurement-method"])) throw new Error(`measurement-method must be one of ${METHODS.join(", ")}`);
  if (!TYPES.includes(a["target-type"])) throw new Error(`target-type must be one of ${TYPES.join(", ")}`);
  const updated = a.updated ? new Date(a.updated) : new Date();
  if (Number.isNaN(updated.getTime())) throw new Error("updated must be a date and time, e.g. 2026-10-01T00:00:00Z");
  const doc = {
    updated: updated.toISOString().replace(/\.\d{3}Z$/, "Z"),
    capabilities: "basic",
    provider: need("provider"),
    "measurement-method": a["measurement-method"],
    "methodology-uri": methodology,
    "reporting-period": period,
    target: need("target"),
    "target-type": a["target-type"],
  };
  if (energy !== undefined) { doc["energy-consumption"] = energy; doc["energy-unit"] = "kWh"; }
  if (carbon !== undefined) { doc["carbon-footprint"] = carbon; doc["carbon-unit"] = "kgCO2e"; }
  if (disclosure) doc["disclosure-uri"] = disclosure;
  return doc;
}

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
    limit_except GET HEAD { deny all; }
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

async function ask(rl, q, d) {
  const v = (await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim();
  return v === "" ? d : v;
}

async function main() {
  const a = parseArgs(argv.slice(2));
  if (a.help) {
    console.log(`usage: create-sustainability-data [--target HOST] [--provider TEXT] [--methodology-uri URL] [--period YYYY-MM] [--energy-kwh N] [--carbon-kgco2e N] [--disclosure-uri URL] [--measurement-method TOKEN] [--target-type TYPE] [--host ${HOSTS.join("|")}] [--out DIR]`);
    return;
  }
  const interactive = stdin.isTTY && !a.yes && (!a.target || !a.provider || !a["methodology-uri"] || !a.period);
  if (interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    a.target = await ask(rl, "1/7 What are the figures about? (your host name, e.g. example.com)", a.target);
    a.provider = await ask(rl, "2/7 Who publishes them, and how to reach you? (a role, not a person)", a.provider);
    a["methodology-uri"] = await ask(rl, "3/7 Public page that says how you obtained them (https://...)", a["methodology-uri"]);
    a.period = await ask(rl, "4/7 Reporting period (YYYY, YYYY-MM or YYYY-MM-DD, completed)", a.period);
    a["energy-kwh"] = await ask(rl, "5/7 Energy in kWh (leave empty if you do not have it)", a["energy-kwh"] ?? "");
    a["carbon-kgco2e"] = await ask(rl, "6/7 Carbon in kgCO2e (leave empty if you do not have it)", a["carbon-kgco2e"] ?? "");
    a["disclosure-uri"] = await ask(rl, "7/7 Link to your report or disclosure page (https://..., optional)", a["disclosure-uri"] ?? "");
    a["measurement-method"] = await ask(rl, `How were they obtained? (${METHODS.join(" | ")})`, a["measurement-method"]);
    a.host = await ask(rl, `Host (${HOSTS.join(" | ")})`, a.host);
    a.out = await ask(rl, "Output folder", a.out);
    rl.close();
  }
  const doc = declarationFrom(a);
  const files = filesFor(a.host, doc);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(a.out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    console.log(`wrote ${p}`);
  }
  console.log(`\nDeploy, then check:\n  npx -y -p sustainability-wellknown-consumer sustainability-fetch https://${doc.target} --strict`);
}

/** True when this file is the program being run, also through an npm bin symlink or on Windows. */
function isMainModule() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    exit(1);
  });
}
