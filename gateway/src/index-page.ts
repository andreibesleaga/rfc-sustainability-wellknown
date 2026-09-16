/**
 * The human-readable (`GET /`) and machine-readable (`GET /index.json`) index
 * of everything this gateway serves.
 */
import type { GatewayConfig } from "./config";
import type { WireExample } from "./examples";
import { escapeHtml } from "./http";
import type { ManagedSubject } from "./live";
import type { Subject } from "./registry";
import type { CrossValidation } from "./verify";

import { WELL_KNOWN_PATH } from "sustainability-wellknown-publisher";
export { WELL_KNOWN_PATH };

/** One paragraph, shown on the index page and carried in `index.json`. */
export const ABOUT =
  "This gateway serves one conformant declaration per reporting subject at " +
  "/{domain}/.well-known/sustainability-data, so the format can be " +
  "tested against real, sourced disclosures before organizations publish their own. In " +
  "real use the declaration lives on the subject's own origin; a gateway only demonstrates " +
  "and tests the format.";

/**
 * The honesty notice. It is stated on the HTML index, carried in index.json,
 * and restated IN BAND in the `provider` member of every third-party document.
 */
export const THIRD_PARTY_NOTICE =
  "The declarations about third parties are ILLUSTRATIVE MAPPINGS, prepared by the gateway " +
  "operator from those organizations' own published reports. They are NOT published, " +
  "reviewed, authorized or endorsed by their reporting subjects, and this gateway is not an " +
  "authoritative source for them. Every figure is read from, or is the stated sum of figures " +
  "read from, the public source document named in the declaration's methodology-uri member; " +
  "nothing is estimated or apportioned on a subject's behalf. Subjects with a reserved " +
  ".example name are synthetic and describe nothing real.";

export interface IndexEntry {
  domain: string;
  path: string;
  target: string;
  "target-type"?: string;
  "reporting-period": string;
  "measurement-method": string;
  "methodology-uri": string;
  "disclosure-uri"?: string;
  /** The declarations this subject's figures derive from (draft -07 §Upstream Declarations). */
  upstream?: { declaration: string; role?: string }[];
  provider: string;
  updated: string;
  synthetic: boolean;
  /** "curated file" or the adapter that generated the document. */
  source: string;
}

/** One adapter-demonstration subject (live or replay). */
export interface DemoEntry {
  domain: string;
  path: string;
  /** Which published adapter produced the document (the Subject's source label). */
  adapter: string;
  /** "live" = real upstream at last refresh; "replay" = recorded response. */
  mode: "live" | "replay";
  upstream: string;
  attribution: string;
  /** ISO timestamp of the last successful (re)build. */
  refreshed: string;
  target: string;
  "reporting-period": string;
  /** Present when the last live refresh failed and older data is being served. */
  "upstream-error"?: string;
}

/** One wire-format example case. */
export interface ExampleEntry {
  domain: string;
  path: string;
  case: string;
  shape: "object" | "array";
  entries: number;
  /** For the declared-extended array cases: the period that, sliced at `granularity`, is the whole trend. */
  period?: string;
  /** Honored granularity parameter, for the declared-extended array cases. */
  granularity?: string;
  file: string;
  note: string;
  target: string;
  "reporting-period": string;
}

export interface IndexDocument {
  service: string;
  specification: string;
  about: string;
  notice: string;
  /** Service level of the RELAYED subject documents (the self report is Extended, see `self`). */
  capabilities: "basic";
  self: {
    path: string;
    target: string;
    /** The self report honours `period` and `granularity` (draft Extended service). */
    capabilities: "extended";
    /** The instant the gateway went live; the model counts no hours before it. */
    "live-since": string;
    /** Working Extended requests on the self report. */
    "extended-examples": string[];
    /**
     * The OPTIONAL signature EMBEDDED in each self declaration object as its
     * `signed` member (draft -07 §Signing), or null when the deployment holds
     * no key. There is no separate signature resource: the signature travels
     * inside the body.
     */
    signature: { member: "signed"; alg: string; kid: string; "public-key-url": string | null } | null;
    /** The third-party attestation the self report links to, or null. */
    attestation: { uri: string; note: string } | null;
  };
  count: number;
  subjects: IndexEntry[];
  /** Boot-time validation of every served document by the consumer library. */
  "consumer-cross-validation": {
    validator: string;
    "documents-validated": number;
    note: string;
  };
  /** One demonstration subject per published publisher adapter. */
  "adapter-demonstrations": {
    note: string;
    count: number;
    entries: DemoEntry[];
  };
  /** Every case from the repository's canonical example-responses set. */
  "wire-format-examples": {
    note: string;
    count: number;
    entries: ExampleEntry[];
  };
}

export const DEMO_NOTE =
  "One subject per upstream-backed adapter of the published sustainability-wellknown-publisher " +
  "package, so every adapter runs end to end here. Live subjects fetch a real upstream daily " +
  "(only where the license permits attributed republication; the attribution is in the " +
  "document). Replay subjects run the same adapter code against a recorded response, because " +
  "no free legal live access exists; their figures are synthetic and say so in the document. " +
  "All use reserved .example names and describe no real organization.";

export const EXAMPLES_NOTE =
  "Every case of the specification's canonical example-responses set, served live. Trend " +
  "cases follow the draft's rule: the parameterless request answers the most recent entry, " +
  "and the sorted array is returned only for a period sliced by a finer granularity, on " +
  "documents that declare capabilities:extended. All figures are synthetic; the subjects " +
  "are reserved .example names.";

export const CROSS_VALIDATION_NOTE =
  "At start-up, every document served here is produced by the published publisher library " +
  "and validated by the published consumer library — the same code a third party would " +
  "run. A validation failure stops the gateway from starting.";

/** Blob root of the repository's documentation, for the page's "more detail" links. */
const REPO_DOCS = "https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main";
const REPO = "https://github.com/andreibesleaga/rfc-sustainability-wellknown";

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
  if (d.upstream) e.upstream = d.upstream;
  return e;
}

export interface IndexExtras {
  demos: ManagedSubject[];
  examples: WireExample[];
  crossValidation: CrossValidation;
  /** Set when the gateway signs its own report. */
  signing?: { alg: string; kid: string };
}


/** Carried in index.json next to the attestation URI. Also the front page's disclosure. */
export const ATTESTATION_NOTE =
  "A W3C Verifiable Credential (Data Model 2.0, secured as vc+jwt) in which the issuer " +
  "attests the MODEL behind this gateway's own report — not any third party's figures. " +
  "The operator of this gateway and the issuer of that credential are the same person: " +
  "the credential demonstrates the mechanism and is not independent assurance.";

/** Wrap document-derived text so a right-to-left value cannot reorder the page around it. */
function bdi(text: string): string {
  return `<bdi>${escapeHtml(text)}</bdi>`;
}

function demoEntry(m: ManagedSubject): DemoEntry {
  const d = m.subject.document;
  const e: DemoEntry = {
    domain: m.spec.domain,
    path: `/${m.spec.domain}${WELL_KNOWN_PATH}`,
    adapter: m.subject.source,
    mode: m.mode,
    upstream: m.spec.upstream,
    attribution: m.spec.attribution,
    refreshed: m.refreshedAt,
    target: d.target,
    "reporting-period": d["reporting-period"],
  };
  if (m.upstreamError) e["upstream-error"] = m.upstreamError;
  return e;
}

function exampleEntry(x: WireExample): ExampleEntry {
  const d = x.subject.document;
  const e: ExampleEntry = {
    domain: x.domain,
    path: `/${x.domain}${WELL_KNOWN_PATH}`,
    case: x.caseName,
    shape: x.shape,
    entries: x.entries,
    file: x.file,
    note: x.note,
    target: d.target,
    "reporting-period": d["reporting-period"],
  };
  if (x.granularity) {
    e.period = x.period;
    e.granularity = x.granularity;
  }
  return e;
}

/** One clickable request on this deployment, with what a click is expected to show. */
export interface LiveRequest {
  /** Relative path (same origin) or absolute URL (external). */
  href: string;
  /** What the request demonstrates. */
  what: string;
  /** The expected outcome, in words. */
  expect: string;
}

/**
 * Every working GET this deployment answers, derived from the index so the
 * list is right on any deployment: the self report at each service level, its
 * embedded signature and its attestation, one declaration of each relayed
 * kind, the upstream chain, and the draft's error cases. The front page
 * renders them as hyperlinks so a reader can verify each behaviour with a
 * click.
 */
export function liveRequests(doc: IndexDocument): LiveRequest[] {
  const self = doc.self;
  const year = self["live-since"].slice(0, 4);
  const [monthly, monthlyTrend, daily] = self["extended-examples"];
  const subject = doc.subjects[0];
  const demo = doc["adapter-demonstrations"].entries[0];
  const trend = doc["wire-format-examples"].entries.find((x) => x.granularity);
  const withUpstream = doc.subjects.filter((s) => s.upstream && s.upstream.length > 0);
  // tenant-demo.example is the worked upstream pair of the specification's own example; prefer it, whatever the registry order.
  const downstream = withUpstream.find((s) => s.domain === "tenant-demo.example") ?? withUpstream[0];
  const out: LiveRequest[] = [
    { href: self.path, what: "the gateway's own report, parameterless", expect: "200, the most recently completed month" },
    { href: monthly, what: "Extended: one month since go-live", expect: "200, that month's figures" },
    { href: monthlyTrend, what: "Extended: a year sliced monthly", expect: "200, a sorted array, one entry per month" },
    { href: daily, what: "Extended: a month sliced daily", expect: "200, a sorted array, one entry per day" },
    { href: `${self.path}?period=${Number(year) - 1}`, what: "Extended: a period before go-live", expect: "404, the draft's no-data rule" },
    { href: `${self.path}?period=${year}&granularity=weekly`, what: "Extended: an unknown granularity value", expect: "200, the parameter is ignored" },
    { href: `${self.path}?period=${year}&period=${Number(year) - 1}`, what: "Extended: a parameter given twice", expect: "400, the request is ambiguous" },
    { href: `${self.path}?target=/other`, what: "Extended: the target parameter", expect: "404 — one process has no path prefixes, so the published set is empty" },
  ];
  if (self.signature) {
    out.push({
      href: self.path,
      what: `the same report, read for its \`signed\` member (${self.signature.alg}, embedded in the object)`,
      expect: "200; the declaration carries `signed`, a JWS over itself — there is no separate signature resource",
    });
    if (self.signature["public-key-url"]) {
      out.push({ href: self.signature["public-key-url"], what: "the signing public key, hosted out of band", expect: "200, application/jwk+json" });
    }
  }
  if (self.attestation) {
    out.push({ href: self.attestation.uri, what: "the third-party attestation the self document links to", expect: "200, application/vc+jwt" });
  }
  if (subject) {
    out.push(
      { href: subject.path, what: `a curated subject declaration (${subject.domain})`, expect: "200, application/sustainability-data+json" },
      { href: `${subject.path}?period=${year}`, what: "a Basic subject with a query parameter", expect: "200, the parameter is ignored" },
    );
  }
  if (downstream && downstream.upstream) {
    out.push({
      href: downstream.upstream[0].declaration,
      what: `the upstream chain: the declaration ${downstream.domain} names as its ${downstream.upstream[0].role ?? "upstream"} provider`,
      expect: "200, the tenant-scoped declaration this gateway serves for that upstream — what `--upstream` walks",
    });
  }
  if (demo) out.push({ href: demo.path, what: `an adapter demonstration (${demo.domain})`, expect: "200, mapped from its upstream" });
  if (trend) {
    out.push(
      { href: `${trend.path}?period=${trend.period}&granularity=${trend.granularity}`, what: `a wire-format example declaring Extended (${trend.domain}): a period sliced finer`, expect: `200, its sorted trend array (${trend.entries} entries)` },
      { href: `${trend.path}?granularity=${trend.granularity}`, what: `the same example, granularity alone`, expect: "200, one object — not finer than the default period" },
    );
  }
  out.push(
    { href: `/nobody.example${WELL_KNOWN_PATH}`, what: "an unknown subject", expect: "404" },
    { href: "/index.json", what: "the machine-readable index", expect: "200, application/json" },
    { href: "/healthz", what: "the health check", expect: "200" },
  );
  return out;
}

export function buildIndex(
  subjects: Iterable<Subject>,
  self: Subject,
  config: GatewayConfig,
  extras?: IndexExtras,
): IndexDocument {
  const demoDomains = new Set((extras?.demos ?? []).map((m) => m.spec.domain));
  const exampleDomains = new Set((extras?.examples ?? []).map((x) => x.domain));
  const list = [...subjects]
    .filter((s) => !demoDomains.has(s.domain) && !exampleDomains.has(s.domain))
    .map((s) => entry(s, s.source.startsWith("adapter:") ? "adapter" : "file"))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const demos = (extras?.demos ?? [])
    .map(demoEntry)
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const examples = (extras?.examples ?? []).map(exampleEntry);
  return {
    service: config.self.target,
    specification: SPEC_URL,
    about: ABOUT,
    notice: THIRD_PARTY_NOTICE,
    capabilities: "basic",
    self: {
      path: WELL_KNOWN_PATH,
      target: self.document.target,
      capabilities: "extended",
      "live-since": config.self.liveSince,
      "extended-examples": [
        `${WELL_KNOWN_PATH}?period=${config.self.liveSince.slice(0, 7)}`,
        `${WELL_KNOWN_PATH}?period=${config.self.liveSince.slice(0, 4)}&granularity=monthly`,
        `${WELL_KNOWN_PATH}?period=${config.self.liveSince.slice(0, 7)}&granularity=daily`,
      ],
      signature: extras?.signing
        ? {
            member: "signed",
            alg: extras.signing.alg,
            kid: extras.signing.kid,
            "public-key-url": config.self.signingKeyUrl ?? null,
          }
        : null,
      attestation: config.self.verifiableAttestationUri
        ? { uri: config.self.verifiableAttestationUri, note: ATTESTATION_NOTE }
        : null,
    },
    count: list.length,
    subjects: list,
    "consumer-cross-validation": {
      validator: extras?.crossValidation.validator ?? "not run",
      "documents-validated": extras?.crossValidation.documentsValidated ?? 0,
      note: CROSS_VALIDATION_NOTE,
    },
    "adapter-demonstrations": {
      note: DEMO_NOTE,
      count: demos.length,
      entries: demos,
    },
    "wire-format-examples": {
      note: EXAMPLES_NOTE,
      count: examples.length,
      entries: examples,
    },
  };
}

function row(e: IndexEntry): string {
  const badge = e.synthetic
    ? '<span class="badge synthetic">synthetic</span>'
    : '<span class="badge sourced">sourced</span>';
  return `<tr>
  <td><a href="${escapeHtml(e.path)}"><code>${escapeHtml(e.domain)}</code></a> ${badge}</td>
  <td>${bdi(e.target)}${e["target-type"] ? ` <span class="dim">(${escapeHtml(e["target-type"])})</span>` : ""}</td>
  <td><code>${escapeHtml(e["reporting-period"])}</code></td>
  <td><code>${escapeHtml(e["measurement-method"])}</code></td>
  <td><a href="${escapeHtml(e["methodology-uri"])}" rel="noopener noreferrer nofollow" aria-label="${escapeHtml(e.domain)}: source document">source document</a></td>
</tr>`;
}

function demoRow(e: DemoEntry): string {
  const badge =
    e.mode === "live"
      ? '<span class="badge live">live</span>'
      : '<span class="badge replay">replay</span>';
  const err = e["upstream-error"]
    ? `<br><span class="dim">last live attempt failed; serving last good data</span>`
    : "";
  return `<tr>
  <td><a href="${escapeHtml(e.path)}"><code>${escapeHtml(e.domain)}</code></a> ${badge}</td>
  <td><code>${escapeHtml(e.adapter.replace(/^adapter:/, ""))}</code></td>
  <td>${bdi(e.upstream)}<br><span class="dim">${bdi(e.attribution)}</span>${err}</td>
  <td><code>${escapeHtml(e["reporting-period"])}</code></td>
</tr>`;
}

function exampleRow(e: ExampleEntry): string {
  const shape =
    e.shape === "array"
      ? `array (${e.entries})${e.granularity ? ` <span class="dim">?period=${escapeHtml(e.period ?? "")}&amp;granularity=${escapeHtml(e.granularity)}</span>` : ""}`
      : "object";
  return `<tr>
  <td><a href="${escapeHtml(e.path)}"><code>${escapeHtml(e.domain)}</code></a> <span class="badge example">example</span></td>
  <td>${bdi(e.case)}</td>
  <td>${shape}</td>
  <td>${bdi(e.note)}</td>
</tr>`;
}

function liveRow(r: LiveRequest): string {
  const external = /^https?:/.test(r.href);
  const rel = external ? ' rel="noopener noreferrer"' : "";
  return `<tr>
  <td><a href="${escapeHtml(r.href)}"${rel}><code>${escapeHtml(r.href)}</code></a></td>
  <td>${escapeHtml(r.what)}</td>
  <td>${escapeHtml(r.expect)}</td>
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sustainability Data Reference Gateway</title>
<style>
:root { color-scheme: light; --fg:#111; --dim:#555; --bg:#fff; --line:#d8d8d8; --accent:#087f4b; --warn:#8a4b00; --warnbg:#fff6e6; --tint:8%; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; --fg:#e8e8e8; --dim:#b0b0b0; --bg:#131313; --line:#3a3a3a; --accent:#4fd39b; --warn:#ffd08a; --warnbg:#2a1f0d; --tint:14%; }
}
:root[data-theme="dark"] { color-scheme: dark; --fg:#e8e8e8; --dim:#b0b0b0; --bg:#131313; --line:#3a3a3a; --accent:#4fd39b; --warn:#ffd08a; --warnbg:#2a1f0d; --tint:14%; }
* { box-sizing: border-box; }
body { margin:0 auto; padding:2rem 1.25rem 4rem; max-width:60rem; background:var(--bg); color:var(--fg);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
h1 { font-size:1.6rem; margin:0 0 .25rem; }
h2 { font-size:1.15rem; margin:2.5rem 0 .75rem; padding:.45rem .7rem; border-radius:4px;
  border-left:4px solid var(--h2-hue, var(--line)); background:color-mix(in srgb, var(--bg) calc(100% - var(--tint)), var(--h2-hue, var(--fg)) var(--tint)); }
/* One hue per section, cycling through eight; the tint stays light enough for the text in both themes. */
h2:nth-of-type(8n+1) { --h2-hue:#0b7a4b; } h2:nth-of-type(8n+2) { --h2-hue:#1f6fb2; }
h2:nth-of-type(8n+3) { --h2-hue:#8a4b00; } h2:nth-of-type(8n+4) { --h2-hue:#6b3fa0; }
h2:nth-of-type(8n+5) { --h2-hue:#b3261e; } h2:nth-of-type(8n+6) { --h2-hue:#0e7c86; }
h2:nth-of-type(8n+7) { --h2-hue:#7a6a00; } h2:nth-of-type(8n+8) { --h2-hue:#555; }
.top { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; }
.theme { font-size:.85rem; color:var(--dim); }
.theme select { font:inherit; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:3px; padding:.15rem .3rem; }
.skip { position:absolute; left:-999px; top:0; background:var(--bg); color:var(--fg); padding:.5rem; border:1px solid var(--line); }
.skip:focus { left:1rem; z-index:1; }
:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.refs li { margin:.3rem 0; }
p { margin:.75rem 0; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.9em; }
a { color:inherit; text-underline-offset:2px; }
.sub { color:var(--dim); margin-top:0; }
.notice { border:1px solid var(--line); border-left:4px solid var(--warn); background:var(--warnbg);
  color:var(--fg); padding:.9rem 1rem; border-radius:4px; }
.notice strong { color:var(--warn); }
.scroll { overflow-x:auto; }
.fig { margin:1.5rem 0 0; max-width:800px; }
.fig svg { width:100%; height:auto; display:block; }
.fig .stage rect { fill:none; stroke:var(--line); stroke-width:1; }
.fig .stage.out rect { stroke:var(--accent); }
.fig text { font-family:inherit; text-anchor:middle; }
.fig .t { font-size:14px; font-weight:600; fill:var(--fg); }
.fig .s { font-size:11px; fill:var(--dim); }
.fig .arrow path { stroke:var(--line); stroke-width:1.5; fill:none; marker-end:url(#fa); }
.fig .wire rect { fill:none; stroke:var(--line); stroke-dasharray:3 3; }
.fig .k, .fig .k2 { text-anchor:start; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
.fig .k { font-size:13px; fill:var(--fg); }
.fig .k2 { font-size:11px; fill:var(--dim); }
.fig figcaption { color:var(--dim); font-size:.85rem; margin-top:.5rem; }
table { border-collapse:collapse; width:100%; margin-top:.5rem; min-width:44rem; }
th,td { text-align:left; padding:.5rem .6rem; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:.78rem; text-transform:uppercase; letter-spacing:.04em; color:var(--dim); font-weight:600; }
.badge { font-size:.75rem; text-transform:uppercase; letter-spacing:.04em; padding:.1rem .4rem;
  border-radius:3px; border:1px solid var(--line); color:var(--dim); white-space:nowrap; }
.badge.synthetic { border-color:var(--warn); color:var(--warn); }
.badge.sourced { border-color:var(--accent); color:var(--accent); }
.badge.live { border-color:var(--accent); color:var(--accent); }
.badge.replay { border-color:var(--warn); color:var(--warn); }
.badge.example { border-color:var(--line); color:var(--dim); }
.dim { color:var(--dim); }
pre.cmd { overflow-x:auto; border:1px solid var(--line); border-radius:4px; padding:.75rem .9rem;
  background:var(--warnbg); background:color-mix(in srgb, var(--bg) 92%, var(--fg) 8%); }
pre.cmd code { font-size:.82em; white-space:pre; }
ul { padding-left:1.2rem; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.9rem; }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="top">
<div>
<h1>Sustainability Data Reference Gateway</h1>
<p class="sub">A reference deployment of <code>/.well-known/sustainability-data</code>
(<a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">draft-besleaga-sustainability-wellknown</a>).</p>
</div>
<label class="theme">Theme <select id="theme">
<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
</select></label>
</div>
<main id="main">

<p>${escapeHtml(doc.about)}</p>

<p class="notice"><strong>Please read.</strong> ${escapeHtml(doc.notice)}</p>

<figure class="fig">
<svg viewBox="0 0 800 232" role="img" aria-labelledby="figtitle figdesc" preserveAspectRatio="xMidYMid meet">
<defs><marker id="fa" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--line)"/></marker></defs>
<title id="figtitle">How this gateway produces a conformant document</title>
<desc id="figdesc">Heterogeneous source data passes through adapters, unit and period
normalization, and schema validation, and is served over HTTPS at
/.well-known/sustainability-data with the media type application/sustainability-data+json.</desc>
<g class="stage">
<rect x="4" y="30" width="140" height="76" rx="5"/>
<text class="t" x="74" y="60">Sources</text>
<text class="s" x="74" y="80">files, APIs,</text>
<text class="s" x="74" y="95">exporters</text>
</g>
<g class="stage">
<rect x="172" y="30" width="140" height="76" rx="5"/>
<text class="t" x="242" y="60">Adapters</text>
<text class="s" x="242" y="80">per-source</text>
<text class="s" x="242" y="95">mapping</text>
</g>
<g class="stage">
<rect x="340" y="30" width="140" height="76" rx="5"/>
<text class="t" x="410" y="60">Normalize</text>
<text class="s" x="410" y="80">units, period,</text>
<text class="s" x="410" y="95">reporting subject</text>
</g>
<g class="stage">
<rect x="508" y="30" width="140" height="76" rx="5"/>
<text class="t" x="578" y="60">Validate</text>
<text class="s" x="578" y="80">CDDL and JTD</text>
<text class="s" x="578" y="95">schemas</text>
</g>
<g class="stage out">
<rect x="676" y="30" width="120" height="76" rx="5"/>
<text class="t" x="736" y="60">Serve</text>
<text class="s" x="736" y="80">HTTPS, ETag,</text>
<text class="s" x="736" y="95">conditional GET</text>
</g>
<g class="arrow">
<path d="M148 68 H166"/><path d="M316 68 H334"/>
<path d="M484 68 H502"/><path d="M652 68 H670"/>
</g>
<g class="wire">
<rect x="4" y="140" width="792" height="72" rx="5"/>
<text class="k" x="24" y="166">GET /.well-known/sustainability-data</text>
<text class="k2" x="24" y="192">200 &#8594; Content-Type: application/sustainability-data+json &#183; X-Content-Type-Options: nosniff</text>
</g>
</svg>
<figcaption>Every declaration below is produced by this path. The media type and the HTTPS
requirement are those of draft revision -07; a deployment kept on the generic
<code>application/json</code> type is still served, and flagged as such.</figcaption>
</figure>

<h2>Subjects served (${doc.count})</h2>
<div class="scroll">
<table>
<thead><tr><th>Endpoint</th><th>Reporting subject</th><th>Period</th><th>Method</th><th>Provenance</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<h2>Adapter demonstrations (${doc["adapter-demonstrations"].count})</h2>
<p>${escapeHtml(doc["adapter-demonstrations"].note)}</p>
<div class="scroll">
<table>
<thead><tr><th>Endpoint</th><th>Adapter</th><th>Upstream &amp; attribution</th><th>Period</th></tr></thead>
<tbody>
${doc["adapter-demonstrations"].entries.map(demoRow).join("\n")}
</tbody>
</table>
</div>

<h2>Wire-format examples (${doc["wire-format-examples"].count})</h2>
<p>${escapeHtml(doc["wire-format-examples"].note)}</p>
<div class="scroll">
<table>
<thead><tr><th>Endpoint</th><th>Case</th><th>Shape</th><th>Demonstrates</th></tr></thead>
<tbody>
${doc["wire-format-examples"].entries.map(exampleRow).join("\n")}
</tbody>
</table>
</div>

<h2>This gateway's own report</h2>
<p>The gateway also reports on itself, as a service, at
<a href="${escapeHtml(doc.self.path)}"><code>${escapeHtml(doc.self.path)}</code></a>
(<code>target</code>: <code>${bdi(doc.self.target)}</code>). The figures are a <strong>model,
not a measurement</strong>: a constant container power draw, times the hours the gateway has
been live, times a cited grid intensity. The document says so
(<code>measurement-method: third-party-modeled</code>) and every constant is in the
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology</a> it links.</p>

<p>This one document offers the draft's <strong>Extended</strong> service. Any period since
go-live (<code>${escapeHtml(doc.self["live-since"])}</code>) can be requested with
<code>period</code> (<code>YYYY</code>, <code>YYYY-MM</code> or <code>YYYY-MM-DD</code>) and
sliced with <code>granularity</code> (<code>monthly</code> or <code>daily</code>). A period
before go-live returns <code>404</code>; a period in progress reports the completed part so far;
a parameter given twice, or a <code>period</code> that is not a real calendar date, returns
<code>400</code>; a <code>target</code> returns <code>404</code>, because one process has no path
prefixes and the published prefix set is therefore empty. Without parameters the answer is the
most recently completed month.</p>
<pre class="cmd"><code>${doc.self["extended-examples"].map((p) => `curl -s "<span class="host">${BASE_TOKEN}</span>${escapeHtml(p)}"`).join("\n")}</code></pre>

<h2>Integrity and attestation</h2>
${
  doc.self.signature
    ? `<p><strong>Signature.</strong> The gateway's own declaration is signed <em>in place</em>:
each object carries a <code>signed</code> member (<code>${escapeHtml(doc.self.signature.alg)}</code>,
key id <code>${bdi(doc.self.signature.kid)}</code>), a JWS Compact Serialization (RFC 7515 &#167;7.1,
<code>cty: sustainability-data+json</code>) whose payload is that same object without
<code>signed</code>. There is no separate signature resource: the signature travels inside the
body, so a cache that serves a re-encoded copy cannot separate the two, and each object of an
Extended trend array carries its own. The public key is in the signature's header${
        doc.self.signature["public-key-url"]
          ? ` and also published at <a href="${escapeHtml(doc.self.signature["public-key-url"])}" rel="noopener noreferrer"><code>${escapeHtml(doc.self.signature["public-key-url"])}</code></a>, so a verifier can pin it`
          : ""
      }. A signature proves that the object you hold is the object this key signed, and that
successive declarations came from the same key. It does not prove who holds the key, and says
nothing about whether the figures are accurate: a correctly signed estimate is still an
estimate. The precedent for carrying a signature as a member of the object it secures is the
<code>signed_metadata</code> parameter of
<a href="https://www.rfc-editor.org/rfc/rfc8414" rel="noopener noreferrer">RFC 8414</a>.</p>`
    : `<p><strong>Signature.</strong> This deployment does not sign its own report: its
declaration carries no <code>signed</code> member, which the draft defines as meaning only that
the publisher does not sign — not evidence of anything.</p>`
}
${
  doc.self.attestation
    ? `<p><strong>Attestation.</strong> The self document links, through
<code>verifiable-attestation-uri</code>, to
<a href="${escapeHtml(doc.self.attestation.uri)}" rel="noopener noreferrer"><code>${escapeHtml(doc.self.attestation.uri)}</code></a>:
a W3C Verifiable Credential (Data Model 2.0) secured as <code>vc+jwt</code>, valid five years,
in which the issuer attests the <em>model</em> behind the report — its constants and formula — so
every month's document is covered without re-issuing. This is the draft's only mechanism that
speaks to authenticity. <strong>The operator of this gateway and the issuer of that credential are the
same person.</strong> The credential demonstrates the mechanism — a second key, a second identity,
a statement verifiable against a published key — and is not independent assurance of the figures
(<a href="${REPO_DOCS}/SIGNING-AND-ATTESTATION.md" rel="noopener noreferrer">how signing and attestation are deployed</a>).</p>`
    : `<p><strong>Attestation.</strong> The self document carries no
<code>verifiable-attestation-uri</code>: no third-party statement about it exists.</p>`
}
<p>The gateway's own declaration carries no <code>upstream</code> member: the hosting platform
publishes no declaration of its own, so naming one would be false.</p>

<p>The third-party declarations are deliberately <em>not</em> signed or attested: this gateway can
vouch for its own bytes, never for another organization's figures, and a <code>signed</code> member
on a relayed declaration would suggest otherwise. The reference consumer reports a signature as
<em>verified</em>, <em>unsigned</em> or <em>unverified</em> — never the data as
"true" or "false":</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --strict --verify-attestation
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --verify --verify-attestation</code></pre>

<h2>Consumer cross-validation</h2>
<p>${escapeHtml(doc["consumer-cross-validation"].note)}
This deployment: <code>${escapeHtml(doc["consumer-cross-validation"].validator)}</code>
validated <strong>${doc["consumer-cross-validation"]["documents-validated"]}</strong>
documents at start-up (every subject listed above, the gateway's own report, and the
Extended variants it checks).</p>

<h2>Service level</h2>
<p>The third-party declarations offer the <strong>Basic</strong> service: this gateway supports
none of the query parameters for them, so it ignores them and returns the Basic response, never
an error. Two exceptions: the gateway's own report is Extended (above), and the wire-format
examples that declare <code>capabilities: "extended"</code> honour <code>period</code> and
<code>granularity</code>, answering a sorted trend array only for a granularity finer than the
period, as the draft defines.</p>
<ul>
<li><strong>Media type.</strong> Successful responses use
<code>application/sustainability-data+json</code>, the type draft -07 requires, with
<code>X-Content-Type-Options: nosniff</code>. Error responses (<code>400</code>,
<code>404</code>, <code>405</code>, <code>503</code>) use <code>application/json</code>, also
with <code>nosniff</code>.</li>
<li><strong>Caching.</strong> <code>Cache-Control: public, max-age=86400</code> for the relayed
subjects and <code>max-age=3600</code> for the gateway's own report and this page;
a strong <code>ETag</code> and <code>Last-Modified</code>; <code>If-None-Match</code> answers
<code>304</code>. Responses carry <code>Access-Control-Allow-Origin: *</code>. The signature is
inside the body, so there is no second resource whose cache entry could drift out of step with
the declaration's.</li>
<li><strong>Methods.</strong> <code>GET</code> and <code>HEAD</code> only; any other method
answers <code>405</code> with <code>Allow: GET, HEAD</code>. An unknown subject answers
<code>404</code>.</li>
<li><strong>Generic media type.</strong> The service-wide default can be switched to the
generic <code>application/json</code> type (not conformant publishing, but a type a consumer
MAY still process) with the <code>SUSTAINABILITY_MEDIA_TYPE</code> variable, and one subject can
be pinned to it regardless of the default, to show such a subject next to conformant ones; this
deployment pins none (<a href="${REPO_DOCS}/gateway/GUIDE.md" rel="noopener noreferrer">operator guide</a>).</li>
<li><strong>Extensions.</strong> The top-level member set is closed, so data this specification
does not define travels inside the OPTIONAL <code>extensions</code> member, an object whose keys
are absolute URIs (<a href="https://www.rfc-editor.org/rfc/rfc3986" rel="noopener noreferrer">RFC 3986</a>,
ASCII, scheme in lowercase, no fragment): either an <code>https</code> URI under the definer's control, which should identify documentation
of the extension, or <code>urn:uuid:</code> plus a lowercase hyphenated UUID
(<a href="https://www.rfc-editor.org/rfc/rfc9562" rel="noopener noreferrer">RFC 9562</a>) for a
definer without a domain. A key is an identifier compared as a string, never dereferenced, and
there is no registry; a consumer that does not implement one ignores its value. The names this
gateway uses are listed in its
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology document</a>.
Seven documents served here carry the member:
<a href="/tenant-demo.example${WELL_KNOWN_PATH}"><code>tenant-demo.example</code></a>,
<a href="/device.example${WELL_KNOWN_PATH}"><code>device.example</code></a>,
<a href="/extended.example${WELL_KNOWN_PATH}"><code>extended.example</code></a>,
<a href="/microsoft.com${WELL_KNOWN_PATH}"><code>microsoft.com</code></a>,
<a href="/ovhcloud.com${WELL_KNOWN_PATH}"><code>ovhcloud.com</code></a>,
<a href="/sfc-network.example${WELL_KNOWN_PATH}"><code>sfc-network.example</code></a> and
<a href="/sfc-operator.example${WELL_KNOWN_PATH}"><code>sfc-operator.example</code></a>.</li>
</ul>

<p>Check any of this with a click. Each link is a working <code>GET</code> on this deployment
(or on the operator's site, for a hosted key or credential); the right-hand column is the
expected response. Headers, conditional requests and the <code>405</code> case need a client
that shows them — the commands in the next section do.</p>
<div class="scroll">
<table>
<thead><tr><th>Request</th><th>Demonstrates</th><th>Expected</th></tr></thead>
<tbody>
${liveRequests(doc).map(liveRow).join("\n")}
</tbody>
</table>
</div>

<h2>Verify these declarations yourself</h2>
<p>Every declaration here can be fetched and validated with the specification's reference
consumer
(<a href="https://www.npmjs.com/package/sustainability-wellknown-consumer" rel="noopener noreferrer"><code>sustainability-wellknown-consumer</code></a>,
0.7.0 or later — the revision that implements -07). <code>--strict</code> runs the conformance
battery — schema, media type, caching, conditional requests, methods, the optional embedded
signature — and labels each check with the strength of the requirement: a failed
<code>MUST</code> is a conformance failure; an unmet <code>SHOULD</code>, or the generic media
type, is reported but does not fail the battery
(<a href="${REPO_DOCS}/consumer/README.md" rel="noopener noreferrer">consumer documentation</a>).</p>

<p>The gateway's own report, at this origin's true well-known location:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --strict</code></pre>

<p>Any subject — curated, adapter demonstration or wire-format example — by its
path-prefixed base URL; the consumer resolves the well-known path under the prefix:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/cloudflare.com --strict
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/grid-intensity-demo.example --strict
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/yearly.example --strict
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/&lt;any-domain-above&gt; --strict</code></pre>

<p>An Extended trend array, by the full declaration URL with a <code>period</code> and a finer
<code>granularity</code>:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch "<span class="host">${BASE_TOKEN}</span>/yearly.example${WELL_KNOWN_PATH}?period=2025&amp;granularity=monthly"</code></pre>

<p>The embedded signature, the upstream chain and the attestation, on the declarations that
carry them:</p>
<pre class="cmd"><code>npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --verify
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/tenant-demo.example --upstream</code></pre>

<p>To just fetch and read a declaration (or pipe it into your own tooling):</p>
<pre class="cmd"><code>curl -s <span class="host">${BASE_TOKEN}</span>/wikimedia.org${WELL_KNOWN_PATH} | python3 -m json.tool</code></pre>

<p>Independently of this project's tooling, the JSON validates against the specification's
<a href="${REPO}/tree/main/schemas-validators" rel="noopener noreferrer">JTD and CDDL schemas</a>.</p>

<h2>Machine-readable index and documentation</h2>
<p><a href="/index.json"><code>/index.json</code></a> carries the same list, notices included.
Full detail: the
<a href="${REPO_DOCS}/gateway/README.md" rel="noopener noreferrer">gateway README</a>,
<a href="${REPO_DOCS}/gateway/GUIDE.md" rel="noopener noreferrer">operator guide</a>,
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology and provenance rules</a>,
<a href="${REPO_DOCS}/gateway/data/README.md" rel="noopener noreferrer">per-subject sources</a>,
<a href="${REPO_DOCS}/SIGNING-AND-ATTESTATION.md" rel="noopener noreferrer">signing and attestation</a>,
and the <a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">Internet-Draft</a>.</p>

<h2>References</h2>
<ul class="refs">
<li><a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">draft-besleaga-sustainability-wellknown</a> — the Internet-Draft this gateway implements (IETF Datatracker).</li>
<li><a href="https://andreibesleaga.substack.com/p/the-digital-sustainability-data-protocol" rel="noopener noreferrer">The Digital Sustainability Data Protocol</a> — the author's article introducing the idea and its motivation (an earlier name for this convention).</li>
<li><a href="${REPO}" rel="noopener noreferrer">Specification repository</a> — draft sources, schemas, reference publisher and consumer, this gateway, and its documentation.</li>
<li><a href="https://www.npmjs.com/package/sustainability-wellknown-publisher" rel="noopener noreferrer">sustainability-wellknown-publisher</a> and <a href="https://www.npmjs.com/package/sustainability-wellknown-consumer" rel="noopener noreferrer">sustainability-wellknown-consumer</a> — the reference implementations on npm.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8615" rel="noopener noreferrer">RFC 8615</a> — Well-Known URIs, the registry the path belongs to (<a href="https://www.iana.org/assignments/well-known-uris/" rel="noopener noreferrer">IANA registry</a>).</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc9110" rel="noopener noreferrer">RFC 9110</a> — HTTP Semantics (methods, conditional requests, caching headers used here).</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8927" rel="noopener noreferrer">RFC 8927</a> (JSON Type Definition) and <a href="https://www.rfc-editor.org/rfc/rfc8610" rel="noopener noreferrer">RFC 8610</a> (CDDL) — the two schema languages the declaration is defined in.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc3986" rel="noopener noreferrer">RFC 3986</a> — URI Generic Syntax; the keys of the <code>extensions</code> member are absolute URIs, compared as strings and never dereferenced.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc9562" rel="noopener noreferrer">RFC 9562</a> — UUIDs; the lowercase, hyphenated text form an <code>extensions</code> key takes after <code>urn:uuid:</code>, for a definer without a domain.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc7515" rel="noopener noreferrer">RFC 7515</a> — JSON Web Signature; &#167;7.1 defines the Compact Serialization the <code>signed</code> member carries, and &#167;4.1.10 the <code>cty</code> that types its payload.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8414" rel="noopener noreferrer">RFC 8414</a> — OAuth 2.0 Authorization Server Metadata; its <code>signed_metadata</code> parameter is the precedent for a signature embedded in the object it secures, whose payload takes precedence over the members around it.</li>
<li><a href="https://www.w3.org/TR/vc-data-model-2.0/" rel="noopener noreferrer">W3C Verifiable Credentials Data Model 2.0</a> and <a href="https://www.w3.org/TR/vc-jose-cose/" rel="noopener noreferrer">Securing Verifiable Credentials using JOSE and COSE</a> — the shape of the attestation.</li>
<li><a href="https://ghgprotocol.org/" rel="noopener noreferrer">GHG Protocol</a> — the scope and accounting definitions the carbon members follow; <a href="https://sci.greensoftware.foundation/" rel="noopener noreferrer">Software Carbon Intensity</a> — the <code>sci-score</code> member.</li>
</ul>
</main>

<footer>
<p>A specification-demonstration service. Health check:
<a href="/healthz"><code>/healthz</code></a>.</p>
<p><strong>Operator &amp; contact:</strong> Andrei Nicolae Besleaga, andrei.besleaga@ieee.org.
Not affiliated with, and not endorsed by, any reporting subject listed above; company names
only identify whose published reports the documents are mapped from. Reporting subjects may
request corrections or removal at the address above.</p>
<p><strong>Disclaimer:</strong> This site is for informational and specification-demonstration
purposes only and is provided &quot;as is&quot;, without warranty of any kind. Figures are
traceable to the cited public source documents but may lag the subjects&#39; own publications;
the cited sources remain the authoritative record. Nothing here is investment, ESG-rating or
compliance advice.</p>
<p><strong>Privacy:</strong> No cookies, analytics or tracking. The theme choice above is kept
only in your browser's local storage. The hosting provider (Railway) may process IP addresses
in standard server logs for operation and security.</p>
<p>The repository's code and its own documents are published under the BSD 3-Clause License at
<a href="https://github.com/andreibesleaga/rfc-sustainability-wellknown" rel="noopener noreferrer">github.com/andreibesleaga/rfc-sustainability-wellknown</a>.</p>
</footer>
<script>
var themeSelect = document.getElementById("theme");
function applyTheme(v) { v === "light" || v === "dark" ? document.documentElement.setAttribute("data-theme", v) : document.documentElement.removeAttribute("data-theme"); themeSelect.value = v === "light" || v === "dark" ? v : "system"; }
try { applyTheme(localStorage.getItem("theme")); } catch (e) { applyTheme(); }
themeSelect.onchange = function () { try { localStorage.setItem("theme", themeSelect.value); } catch (e) {} applyTheme(themeSelect.value); };
</script>${hostScript}
</body>
</html>
`;
}
