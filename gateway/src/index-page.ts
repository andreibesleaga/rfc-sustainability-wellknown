/**
 * The human-readable (`GET /`) and machine-readable (`GET /index.json`) index
 * of everything this gateway serves.
 */
import type { GatewayConfig } from "./config";
import { escapeHtml } from "./http";
import type { Subject } from "./registry";

export const WELL_KNOWN_PATH = "/.well-known/sustainability-data";

/** One paragraph, shown on the index page and carried in `index.json`. */
export const ABOUT =
  "This service is a reference deployment of the /.well-known/sustainability-data " +
  "well-known URI defined in draft-besleaga-sustainability-wellknown. It serves one " +
  "conformant JSON document per reporting subject, each at " +
  "/{domain}/.well-known/sustainability-data, so that the convention can be exercised " +
  "against real, sourced annual disclosures without waiting for each organization to " +
  "deploy its own endpoint. In a real deployment the document lives on the subject's own " +
  "origin; a gateway is only a way to demonstrate and test the format.";

/**
 * The honesty notice. It is stated on the HTML index, carried in index.json,
 * and restated IN BAND in the `provider` member of every third-party document.
 */
export const THIRD_PARTY_NOTICE =
  "Documents served here about third parties are ILLUSTRATIVE MAPPINGS prepared by the " +
  "gateway operator from those organizations' own published reports. They are NOT " +
  "published, reviewed, authorized, or endorsed by their reporting subjects, and this " +
  "gateway is not an authoritative origin for them. Every figure is traceable to the " +
  "public source document named in that document's methodology-uri member; nothing is " +
  "estimated, interpolated, or invented on the subjects' behalf. Documents whose subject " +
  "is a reserved .example name are deliberately synthetic and describe nothing real.";

export interface IndexEntry {
  domain: string;
  path: string;
  target: string;
  "target-type"?: string;
  "reporting-period": string;
  "measurement-method": string;
  "methodology-uri": string;
  "disclosure-uri"?: string;
  provider: string;
  updated: string;
  synthetic: boolean;
  /** "curated file" or the adapter that generated the document. */
  source: string;
}

export interface IndexDocument {
  service: string;
  specification: string;
  about: string;
  notice: string;
  capabilities: "basic";
  self: { path: string; target: string };
  count: number;
  subjects: IndexEntry[];
}

const SPEC_URL =
  "https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/";

function entry(s: Subject, kind: "file" | "adapter"): IndexEntry {
  const d = s.document;
  const e: IndexEntry = {
    domain: s.domain,
    path: `/${s.domain}${WELL_KNOWN_PATH}`,
    target: d.target,
    "reporting-period": d["reporting-period"],
    "measurement-method": d["measurement-method"],
    "methodology-uri": d["methodology-uri"],
    provider: d.provider,
    updated: d.updated,
    synthetic: s.synthetic,
    source: kind === "file" ? "curated data file" : s.source,
  };
  if (d["target-type"]) e["target-type"] = d["target-type"];
  if (d["disclosure-uri"]) e["disclosure-uri"] = d["disclosure-uri"];
  return e;
}

export function buildIndex(
  subjects: Iterable<Subject>,
  self: Subject,
  config: GatewayConfig,
): IndexDocument {
  const list = [...subjects]
    .map((s) => entry(s, s.source.startsWith("adapter:") ? "adapter" : "file"))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return {
    service: config.self.target,
    specification: SPEC_URL,
    about: ABOUT,
    notice: THIRD_PARTY_NOTICE,
    capabilities: "basic",
    self: { path: WELL_KNOWN_PATH, target: self.document.target },
    count: list.length,
    subjects: list,
  };
}

function row(e: IndexEntry): string {
  const badge = e.synthetic
    ? '<span class="badge synthetic">synthetic</span>'
    : '<span class="badge sourced">sourced</span>';
  return `<tr>
  <td><a href="${escapeHtml(e.path)}"><code>${escapeHtml(e.domain)}</code></a> ${badge}</td>
  <td>${escapeHtml(e.target)}${e["target-type"] ? ` <span class="dim">(${escapeHtml(e["target-type"])})</span>` : ""}</td>
  <td><code>${escapeHtml(e["reporting-period"])}</code></td>
  <td><code>${escapeHtml(e["measurement-method"])}</code></td>
  <td><a href="${escapeHtml(e["methodology-uri"])}" rel="noopener noreferrer nofollow">source document</a></td>
</tr>`;
}

export function renderIndexHtml(doc: IndexDocument): string {
  const rows = doc.subjects.map(row).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sustainability-data gateway</title>
<style>
:root { color-scheme: light dark; --fg:#111; --dim:#555; --bg:#fff; --line:#d8d8d8; --accent:#0b5; --warn:#8a4b00; --warnbg:#fff6e6; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#e8e8e8; --dim:#a5a5a5; --bg:#131313; --line:#333; --accent:#3c9; --warn:#ffd08a; --warnbg:#2a1f0d; }
}
* { box-sizing: border-box; }
body { margin:0 auto; padding:2rem 1.25rem 4rem; max-width:60rem; background:var(--bg); color:var(--fg);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
h1 { font-size:1.6rem; margin:0 0 .25rem; }
h2 { font-size:1.15rem; margin:2.5rem 0 .5rem; }
p { margin:.75rem 0; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.9em; }
a { color:inherit; text-underline-offset:2px; }
.sub { color:var(--dim); margin-top:0; }
.notice { border:1px solid var(--line); border-left:4px solid var(--warn); background:var(--warnbg);
  color:var(--fg); padding:.9rem 1rem; border-radius:4px; }
.notice strong { color:var(--warn); }
.scroll { overflow-x:auto; }
table { border-collapse:collapse; width:100%; margin-top:.5rem; min-width:44rem; }
th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); font-weight:600; }
.badge { font-size:.68rem; text-transform:uppercase; letter-spacing:.04em; padding:.1rem .4rem;
  border-radius:3px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
.badge.synthetic { border-color:var(--warn); color:var(--warn); }
.dim { color:var(--dim); }
ul { padding-left:1.2rem; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.9rem; }
</style>
</head>
<body>
<h1>sustainability-data gateway</h1>
<p class="sub">A reference deployment of <code>/.well-known/sustainability-data</code>
(<a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">draft-besleaga-sustainability-wellknown</a>).</p>

<p>${escapeHtml(doc.about)}</p>

<p class="notice"><strong>Please read.</strong> ${escapeHtml(doc.notice)}</p>

<h2>Subjects served (${doc.count})</h2>
<div class="scroll">
<table>
<thead><tr><th>Endpoint</th><th>Reporting subject</th><th>Period</th><th>Method</th><th>Provenance</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<h2>This gateway's own report</h2>
<p>The gateway also reports on itself, as a service, at
<a href="${escapeHtml(doc.self.path)}"><code>${escapeHtml(doc.self.path)}</code></a>
(<code>target</code>: <code>${escapeHtml(doc.self.target)}</code>).</p>

<h2>Service level</h2>
<p>This gateway implements the <strong>Basic</strong> service: no query parameters are
supported. Per the draft, unsupported query parameters are <em>ignored</em> and the Basic
response is returned — they are never an error. Successful responses are
<code>application/json</code> with <code>Cache-Control: public, max-age=86400</code>,
<code>Access-Control-Allow-Origin: *</code>, a strong <code>ETag</code> and
<code>Last-Modified</code>; <code>If-None-Match</code> yields <code>304</code>.
A method other than <code>GET</code> or <code>HEAD</code> yields <code>405</code> with
<code>Allow: GET, HEAD</code>. An unknown subject yields <code>404</code>.</p>

<h2>Machine-readable index</h2>
<p><a href="/index.json"><code>/index.json</code></a> carries the same list, this notice included.</p>

<footer>Operated as a specification-demonstration service. Health check:
<a href="/healthz"><code>/healthz</code></a>.</footer>
</body>
</html>
`;
}
