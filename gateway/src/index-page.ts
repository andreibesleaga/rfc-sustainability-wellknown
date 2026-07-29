/**
 * The human-readable (`GET /`) and machine-readable (`GET /index.json`) index
 * of everything this gateway serves.
 */
import type { GatewayConfig } from "./config";
import { escapeHtml } from "./http";
import type { NoDataEntry } from "./no-data";
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
  /** Subjects looked for and found to publish nothing machine-readable. */
  "no-machine-readable-data": {
    note: string;
    count: number;
    subjects: NoDataEntry[];
  };
}

/** Why the no-data list exists at all. Carried in index.json verbatim. */
export const NO_DATA_NOTE =
  "These subjects were looked for and could not honestly be published: the operator found " +
  "no primary source carrying the figures this format needs. They are listed rather than " +
  "quietly omitted, because a registry that showed only the organizations that do publish " +
  "would overstate how much of the web is actually measurable — the gap is the evidence. " +
  "Requesting one of their documents returns 404, the specification's no-data rule.";

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
  noData: Iterable<NoDataEntry> = [],
): IndexDocument {
  const list = [...subjects]
    .map((s) => entry(s, s.source.startsWith("adapter:") ? "adapter" : "file"))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const gaps = [...noData].sort((a, b) => a.domain.localeCompare(b.domain));
  return {
    service: config.self.target,
    specification: SPEC_URL,
    about: ABOUT,
    notice: THIRD_PARTY_NOTICE,
    capabilities: "basic",
    self: { path: WELL_KNOWN_PATH, target: self.document.target },
    count: list.length,
    subjects: list,
    "no-machine-readable-data": {
      note: NO_DATA_NOTE,
      count: gaps.length,
      subjects: gaps,
    },
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

const STATUS_LABEL: Record<string, string> = {
  "publishes-no-quantitative-data": "publishes no figures",
  "consolidated-into-parent": "consolidated into parent",
};

function gapRow(e: NoDataEntry): string {
  const evidence = e.evidence
    .map(
      (u, i) =>
        `<a href="${escapeHtml(u)}" rel="noopener noreferrer nofollow">source ${i + 1}</a>`,
    )
    .join(", ");
  return `<tr>
  <td><code>${escapeHtml(e.domain)}</code></td>
  <td>${escapeHtml(e.entity)}<br><span class="dim">${escapeHtml(STATUS_LABEL[e.status] ?? e.status)}${e.see ? ` — see <code>${escapeHtml(e.see)}</code>` : ""}</span></td>
  <td>${escapeHtml(e.finding)}</td>
  <td>${evidence}<br><span class="dim">checked ${escapeHtml(e.checked)}</span></td>
</tr>`;
}

export function renderIndexHtml(doc: IndexDocument, baseUrl = ""): string {
  // With no configured BASE_URL the commands render a placeholder host and a
  // three-line script swaps in location.origin — the page must show correct,
  // copy-pasteable commands on whatever domain it is actually served from.
  const BASE_TOKEN = baseUrl ? escapeHtml(baseUrl) : "https://&lt;this-gateway&gt;";
  const hostScript = baseUrl
    ? ""
    : `
<script>
for (const el of document.querySelectorAll(".host")) el.textContent = location.origin;
</script>`;
  const rows = doc.subjects.map(row).join("\n");
  const gaps = doc["no-machine-readable-data"];
  const gapSection =
    gaps.count === 0
      ? ""
      : `
<h2>Publishes no machine-readable data (${gaps.count})</h2>
<p>${escapeHtml(gaps.note)}</p>
<div class="scroll">
<table>
<thead><tr><th>Domain</th><th>Entity</th><th>Finding</th><th>Evidence</th></tr></thead>
<tbody>
${gaps.subjects.map(gapRow).join("\n")}
</tbody>
</table>
</div>
`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sustainability-data Repository Gateway</title>
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
.badge.sourced { border-color:var(--accent); color:var(--accent); }
.dim { color:var(--dim); }
pre.cmd { overflow-x:auto; border:1px solid var(--line); border-radius:4px; padding:.75rem .9rem;
  background:var(--warnbg); background:color-mix(in srgb, var(--bg) 92%, var(--fg) 8%); }
pre.cmd code { font-size:.82em; white-space:pre; }
ul { padding-left:1.2rem; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.9rem; }
</style>
</head>
<body>
<h1>sustainability-data Repository Gateway</h1>
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
${gapSection}
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

<h2>Verify these documents yourself</h2>
<p>Every document served here can be fetched and validated with the specification's
published reference consumer
(<a href="https://www.npmjs.com/package/sustainability-wellknown-consumer" rel="noopener noreferrer"><code>sustainability-wellknown-consumer</code></a>,
version 0.5.2 or later). <code>--strict</code> runs the full conformance battery —
schema validation, media type, caching, conditional requests, method handling — and
labels each check with the strength of the requirement it tests (a failed
<code>MUST</code> is a conformance failure; an unmet <code>SHOULD</code> is a warning).</p>

<p>The gateway's own report, at this origin's true well-known location:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --strict</code></pre>

<p>Any subject document, by giving its path-prefixed base URL — the consumer resolves
<code>/.well-known/sustainability-data</code> under the prefix:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/cloudflare.com --strict
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/microsoft.com --strict
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/&lt;any-domain-above&gt; --strict</code></pre>

<p>To just fetch and read a document (or pipe it into your own tooling):</p>
<pre class="cmd"><code>curl -s <span class="host">${BASE_TOKEN}</span>/wikimedia.org${WELL_KNOWN_PATH} | python3 -m json.tool</code></pre>

<p>Independent of this project's tooling, the JSON validates against the
specification's published
<a href="https://github.com/andreibesleaga/rfc-sustainability-wellknown/tree/main/schemas-validators" rel="noopener noreferrer">JTD and CDDL schemas</a>.</p>

<h2>Machine-readable index</h2>
<p><a href="/index.json"><code>/index.json</code></a> carries the same list, this notice included.</p>

<footer>Operated as a specification-demonstration service. Health check:
<a href="/healthz"><code>/healthz</code></a>.</footer>${hostScript}
</body>
</html>
`;
}
