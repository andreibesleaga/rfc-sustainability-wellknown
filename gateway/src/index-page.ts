/**
 * The human-readable (`GET /`) and machine-readable (`GET /index.json`) index
 * of everything this gateway serves.
 */
import type { GatewayConfig } from "./config";
import { ISSUES_URL, LEGAL_PATH, OPERATOR_CONTACT_URL, OPERATOR_NAME } from "./legal";
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
  "Declarations about third parties are ILLUSTRATIVE MAPPINGS the gateway operator read from " +
  "each organization's own published report, named in methodology-uri; no figure is estimated. " +
  "They are not reviewed, authorized or endorsed by those organizations, and this gateway is " +
  "not an authoritative source for them. Names ending .example are synthetic.";

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
  /** The repository file this declaration is served from, for a curated data file. */
  "source-file"?: string;
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
  /** The recorded input the adapter transforms, served at `path`. */
  input?: { path: string; note: string; "live-url"?: string; license?: string };
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
  /** The canonical file in the repository, which the served document reproduces. */
  "source-file": string;
  note: string;
  target: string;
  "reporting-period": string;
}

export interface IndexDocument {
  service: string;
  specification: string;
  about: string;
  notice: string;
  /** Where the legal notice and the correction/removal procedure are published. */
  legal: string;
  /** Operator contact for corrections and removal requests. */
  contact: { name: string; website: string; issues: string };
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
  /**
   * Every served subject whose document carries the OPTIONAL `extensions`
   * member, computed from the documents themselves so the list cannot drift.
   */
  "extension-carriers": string[];
  /** Every case from the repository's canonical example-responses set. */
  "wire-format-examples": {
    note: string;
    count: number;
    entries: ExampleEntry[];
  };
}

export const DEMO_NOTE =
  "One subject per upstream-backed adapter: the eight of the published " +
  "sustainability-wellknown-publisher package and three that live in this gateway (DIST, the " +
  "IETF GREEN power-and-energy YANG model and, experimentally, the SFC ledger bridge, whose synthetic " +
  "declaration is signed with a public test key), so every adapter runs end to end here. Live subjects fetch a real upstream daily " +
  "(only where the license permits attributed republication; the attribution is in the " +
  "document). Replay subjects run the same adapter code against a recorded response, because " +
  "no free legal live access exists; their figures are synthetic and say so in the document. " +
  "All use reserved .example names and describe no real organization.";

export const EXAMPLES_NOTE =
  "Every case in the specification's example set, served live, with synthetic figures under " +
  "reserved .example names. A trend example (one that declares capabilities: extended) answers " +
  "a request without parameters with its newest entry as one object (-07 allows an object or an " +
  "array), and a request for a finer granularity with the sorted array of entries.";

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
  if (kind === "file") e["source-file"] = `${REPO}/blob/main/gateway/data/${s.domain}.json`;
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
  const input = m.spec.input;
  if (input) {
    e.input = { path: `/${m.spec.domain}/input`, note: input.note };
    if (input.liveUrl) e.input["live-url"] = input.liveUrl;
    if (input.license) e.input.license = input.license.name;
  }
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
    "source-file": `${REPO}/blob/main/example-responses/${x.file}`,
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
    { href: monthlyTrend, what: "Extended: a year sliced monthly", expect: "200, a sorted array, one entry per month since go-live" },
    { href: daily, what: "Extended: a month sliced daily", expect: "200, a sorted array, one entry per day since go-live" },
    { href: `${self.path}?period=${Number(year) - 1}`, what: "Extended: a period before go-live", expect: "404, the draft's no-data rule" },
    { href: `${self.path}?period=${year}&granularity=weekly`, what: "Extended: an unknown granularity value", expect: "200, the parameter is ignored" },
    { href: `${self.path}?period=${year}&period=${Number(year) - 1}`, what: "Extended: a parameter given twice", expect: "400, the request is ambiguous" },
    { href: `${self.path}?target=/other`, what: "Extended: the target parameter", expect: "404 — one process has no path prefixes, so the published set is empty; byte for byte the no-data 404 above" },
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
    out.push({ href: self.attestation.uri, what: "the attestation credential the self report links to", expect: "200, application/vc+jwt" });
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
  // Materialized once: `subjects` may be a single-pass iterator.
  const all = [...subjects];
  const extensionCarriers = all
    .filter((s) => {
      const ext = (s.document as { extensions?: unknown }).extensions;
      return typeof ext === "object" && ext !== null && Object.keys(ext).length > 0;
    })
    .map((s) => s.domain)
    .sort((a, b) => a.localeCompare(b));
  const list = all
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
    legal: LEGAL_PATH,
    contact: { name: OPERATOR_NAME, website: OPERATOR_CONTACT_URL, issues: ISSUES_URL },
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
    "extension-carriers": extensionCarriers,
    "wire-format-examples": {
      note: EXAMPLES_NOTE,
      count: examples.length,
      entries: examples,
    },
  };
}

/** "N documents served here carry the member: a, b and c." — from the served documents. */
function carriersSentence(domains: string[]): string {
  if (domains.length === 0) return "No document served here carries the member.";
  const links = domains.map(
    (d) => `<a href="/${escapeHtml(d)}${WELL_KNOWN_PATH}"><code>${escapeHtml(d)}</code></a>`,
  );
  const joined = links.length === 1 ? links[0] : `${links.slice(0, -1).join(",\n")} and\n${links[links.length - 1]}`;
  const n = domains.length === 1 ? "One document served here carries" : `${domains.length} documents served here carry`;
  return `${n} the member:\n${joined}.`;
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
  <td><a href="${escapeHtml(e["methodology-uri"])}" rel="noopener noreferrer nofollow" aria-label="${escapeHtml(e.domain)}: ${e.synthetic ? "methodology" : "source document"}">${e.synthetic ? "methodology" : "source document"}</a>${e["source-file"] ? `<br><a href="${escapeHtml(e["source-file"])}" rel="noopener noreferrer" class="dim" aria-label="${escapeHtml(e.domain)}: data file">data file</a>` : ""}</td>
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
  <td>${inputCell(e)}</td>
  <td>${bdi(e.upstream)}<br><span class="dim">${bdi(e.attribution)}</span>${err}</td>
  <td><code>${escapeHtml(e["reporting-period"])}</code></td>
</tr>`;
}

/** Input → declaration, so the transformation can be read from one row. */
function inputCell(e: DemoEntry): string {
  if (!e.input) return '<span class="dim">none: computed</span>';
  const live = e.input["live-url"]
    ? ` · <a href="${escapeHtml(e.input["live-url"])}" rel="noopener noreferrer nofollow">live upstream</a>`
    : "";
  const licence = e.input.license ? ` <span class="dim">(${escapeHtml(e.input.license)})</span>` : "";
  return `<a href="${escapeHtml(e.input.path)}">input</a> → <a href="${escapeHtml(e.path)}">declaration</a>${live}${licence}` +
    `<br><span class="dim">${bdi(e.input.note)}</span>`;
}

function exampleRow(e: ExampleEntry): string {
  const shape =
    e.shape === "array"
      ? e.granularity
        ? `array (${e.entries}) <span class="dim">?period=${escapeHtml(e.period ?? "")}&amp;granularity=${escapeHtml(e.granularity)}</span>`
        : `object <span class="dim">(the file holds ${e.entries}; the newest is served)</span>`
      : "object";
  return `<tr>
  <td><a href="${escapeHtml(e.path)}"><code>${escapeHtml(e.domain)}</code></a> <span class="badge example">example</span></td>
  <td>${bdi(e.case)}<br><a href="${escapeHtml(e["source-file"])}" rel="noopener noreferrer" class="dim">source file</a></td>
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
<meta name="description" content="A live reference deployment of the /.well-known/sustainability-data well-known URI (draft-besleaga-sustainability-wellknown): machine-readable energy and carbon declarations, worked examples of every case in the draft, and an open-source publisher and consumer.">
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
.visually-hidden { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden;
  clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0; }
pre.check { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: .5rem 0 1rem; }
.check input { flex: 1 1 18rem; min-width: 12rem; padding: .4rem .6rem; font: inherit; }
.check button { padding: .4rem .9rem; font: inherit; }
.cmd { overflow-x:auto; border:1px solid var(--line); border-radius:4px; padding:.75rem .9rem;
  background:var(--warnbg); background:color-mix(in srgb, var(--bg) 92%, var(--fg) 8%); }
pre.cmd code { font-size:.82em; white-space:pre; }
ul { padding-left:1.2rem; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.9rem; }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<div>
<h1>Sustainability Data Reference Gateway</h1>
<p class="sub">A reference deployment of <code>/.well-known/sustainability-data</code>
(<a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">draft-besleaga-sustainability-wellknown</a>).</p>
</div>
<label class="theme">Theme <select id="theme">
<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
</select></label>
</header>
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
<div class="scroll" role="region" tabindex="0" aria-label="Subjects served by this gateway, scrollable">
<table>
<caption class="visually-hidden">Subjects served by this gateway</caption>
<thead><tr><th scope="col">Endpoint</th><th scope="col">Reporting subject</th><th scope="col">Period</th><th scope="col">Method</th><th scope="col">Provenance</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<h2>Adapter demonstrations (${doc["adapter-demonstrations"].count})</h2>
<p>${escapeHtml(doc["adapter-demonstrations"].note)}</p>
<div class="scroll" role="region" tabindex="0" aria-label="Adapter demonstrations, scrollable">
<table>
<caption class="visually-hidden">Adapter demonstrations</caption>
<thead><tr><th scope="col">Endpoint</th><th scope="col">Adapter</th><th scope="col">Input → declaration</th><th scope="col">Upstream &amp; attribution</th><th scope="col">Period</th></tr></thead>
<tbody>
${doc["adapter-demonstrations"].entries.map(demoRow).join("\n")}
</tbody>
</table>
</div>

<h2>Wire-format examples (${doc["wire-format-examples"].count})</h2>
<p>${escapeHtml(doc["wire-format-examples"].note)}</p>
<div class="scroll" role="region" tabindex="0" aria-label="Wire-format examples, scrollable">
<table>
<caption class="visually-hidden">Wire-format examples</caption>
<thead><tr><th scope="col">Endpoint</th><th scope="col">Case</th><th scope="col">Shape</th><th scope="col">Demonstrates</th></tr></thead>
<tbody>
${doc["wire-format-examples"].entries.map(exampleRow).join("\n")}
</tbody>
</table>
</div>

<h2>This gateway's own report</h2>
<p>At <a href="${escapeHtml(doc.self.path)}"><code>${escapeHtml(doc.self.path)}</code></a>
(<code>target</code> <code>${bdi(doc.self.target)}</code>). <strong>A model, not a measurement</strong>
(<code>third-party-modeled</code>): average power × hours live × a cited grid intensity. Power is
a fixed assumption, except months the operator entered from the host's usage metrics, which the
report's <code>provider</code> field lists. Every constant is in the
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology</a>.</p>
<ul>
<li><strong>Queries (Extended service).</strong> <code>period</code> = <code>YYYY</code>,
<code>YYYY-MM</code> or <code>YYYY-MM-DD</code>, any time since go-live
(<code>${escapeHtml(doc.self["live-since"])}</code>); <code>granularity</code> = <code>monthly</code>
or <code>daily</code>. No parameters: the last complete month.</li>
<li><strong>Errors and limits.</strong> A period before go-live: <code>404</code>. A period
still in progress: the part so far. A repeated parameter or an impossible date: <code>400</code>.
Any <code>target</code>: <code>404</code> (one process, no path prefixes to publish).</li>
</ul>
<pre class="cmd"><code>${doc.self["extended-examples"].map((p) => `curl -s "<span class="host">${BASE_TOKEN}</span>${escapeHtml(p)}"`).join("\n")}</code></pre>

<h2>Integrity and attestation</h2>
<ul>
${
  doc.self.signature
    ? `<li><strong>Signature.</strong> The report is signed <em>in place</em>: each object carries a
<code>signed</code> member (<code>${escapeHtml(doc.self.signature.alg)}</code>, key id
<code>${bdi(doc.self.signature.kid)}</code>), a JWS over the same object without it
(<code>cty: sustainability-data+json</code>); each object of a trend array carries its own. The
public key is in the signature's header${
        doc.self.signature["public-key-url"]
          ? ` and at <a href="${escapeHtml(doc.self.signature["public-key-url"])}" rel="noopener noreferrer"><code>${escapeHtml(doc.self.signature["public-key-url"])}</code></a> to pin`
          : ""
      }. It proves the signed copy is intact and comes from the same key as before — not who holds
the key, and not that the figures are right. Precedent:
<a href="https://www.rfc-editor.org/rfc/rfc8414" rel="noopener noreferrer">RFC 8414</a>
<code>signed_metadata</code>.</li>`
    : `<li><strong>Signature.</strong> This deployment does not sign its own report: no
<code>signed</code> member, which the draft says means only that the publisher does not sign.</li>`
}
${
  doc.self.attestation
    ? `<li><strong>Attestation.</strong>
<a href="${escapeHtml(doc.self.attestation.uri)}" rel="noopener noreferrer"><code>${escapeHtml(doc.self.attestation.uri)}</code></a>
(<code>verifiable-attestation-uri</code>): a W3C Verifiable Credential 2.0 (<code>vc+jwt</code>,
five years) attesting the <em>model</em>: its constants and the months with entered power, by
name. A new month on the assumed power needs no new credential; the credential is re-issued
whenever an entered month or a constant changes. <strong>Operator and issuer are the same
person</strong>: it shows the mechanism, it is not independent assurance (<a href="${REPO_DOCS}/SIGNING-AND-ATTESTATION.md" rel="noopener noreferrer">how</a>).</li>`
    : `<li><strong>Attestation.</strong> None: no third-party statement about this report exists.</li>`
}
<li><strong>Not done, on purpose.</strong> No <code>upstream</code> (the host publishes no
declaration to name). Third-party declarations are never signed or attested here: the gateway
can vouch for its own bytes, not for another organization's figures.</li>
</ul>

<h2>Consumer cross-validation</h2>
<p>${escapeHtml(doc["consumer-cross-validation"].note)}
Here: <code>${escapeHtml(doc["consumer-cross-validation"].validator)}</code>,
<strong>${doc["consumer-cross-validation"]["documents-validated"]}</strong> documents (every
subject, this report and its Extended variants, and the trend arrays of the Extended examples).</p>

<h2>HTTP behaviour</h2>
<ul>
<li><strong>Service level.</strong> Third-party declarations are Basic: query parameters are
ignored, never an error. Extended: this gateway's report, and the examples that declare
<code>capabilities: "extended"</code> (an array only for a granularity finer than the period).</li>
<li><strong>Media type.</strong> <code>application/sustainability-data+json</code>; errors (<code>400</code>,
<code>404</code>, <code>405</code>, <code>503</code>) <code>application/json</code>; all with
<code>nosniff</code>. A switch to the generic JSON type (<code>SUSTAINABILITY_MEDIA_TYPE</code>,
service-wide or per subject) shows that a consumer MAY still process it; none is set here
(<a href="${REPO_DOCS}/gateway/GUIDE.md" rel="noopener noreferrer">guide</a>).</li>
<li><strong>Caching.</strong> <code>Cache-Control: public, max-age=86400</code> for subjects, <code>3600</code> for this report
and page; strong <code>ETag</code> and <code>Last-Modified</code>, <code>304</code> on revalidation;
<code>Access-Control-Allow-Origin: *</code>.</li>
<li><strong>Methods.</strong> <code>GET</code> and <code>HEAD</code>; anything else
<code>405</code> with <code>Allow: GET, HEAD</code>. Unknown subject <code>404</code>.</li>
<li><strong>Extensions.</strong> Data the format does not define goes in <code>extensions</code>,
keyed by an absolute URI (<a href="https://www.rfc-editor.org/rfc/rfc3986" rel="noopener noreferrer">RFC 3986</a>),
ASCII, lowercase scheme, no fragment: an <code>https</code> URI the definer controls, or
<code>urn:uuid:</code> + a lowercase hyphenated UUID
(<a href="https://www.rfc-editor.org/rfc/rfc9562" rel="noopener noreferrer">RFC 9562</a>).
Compared as text, never fetched, no registry; unknown ones are ignored; the set of top-level
members stays closed. Names used here:
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology</a>.
${carriersSentence(doc["extension-carriers"])}</li>
</ul>

<p>Every link below is a working <code>GET</code> (a few go off-site, to the documents a report
links to); the right column is the expected answer.
Headers, <code>304</code> and <code>405</code> need a client that shows them (next section).</p>
<div class="scroll" role="region" tabindex="0" aria-label="Live requests you can run against this deployment, scrollable">
<table>
<caption class="visually-hidden">Live requests you can run against this deployment</caption>
<thead><tr><th scope="col">Request</th><th scope="col">Demonstrates</th><th scope="col">Expected</th></tr></thead>
<tbody>
${liveRequests(doc).map(liveRow).join("\n")}
</tbody>
</table>
</div>

<h2>Check a file</h2>
<p>Type an origin that serves <code>/.well-known/sustainability-data</code>. The gateway fetches it once
with the published consumer library (at most once an hour per host, <code>https</code> only, public names
only, 64&nbsp;KiB, 5&nbsp;s) and says whether the bytes it got are a schema-valid declaration. That is all it
says: nothing about accuracy, no endorsement; no result is stored (the hosting provider's request log keeps the
request line for its retention period, as the legal notice says).</p>
<form id="check" class="check" action="/validate" method="get">
<label for="origin">Origin</label>
<input id="origin" name="origin" type="url" inputmode="url" placeholder="https://example.com" required pattern="https://.*" spellcheck="false">
<button type="submit">Check</button>
</form>
<pre id="check-out" class="cmd" hidden aria-live="polite"></pre>
<p>Badge for a README, computed from the same hourly check:
<code>![sustainability-data](<span class="host">${BASE_TOKEN}</span>/badge/example.com.svg)</code></p>

<h2>Deployments</h2>
<p>Origins known to serve the format are listed, with their operator, in
<a href="${REPO_DOCS}/IMPLEMENTATIONS.md" rel="noopener noreferrer">IMPLEMENTATIONS.md</a>; a scheduled
workflow fetches each one daily and checks the media type and the schema
(<a href="${REPO}/actions/workflows/live-deployments.yml" rel="noopener noreferrer">results</a>). Origins run by
the operator of this gateway are marked as such; nobody is listed without consent. Copy-paste recipes for
the most used servers, hosts and frameworks are in
<a href="${REPO}/tree/main/deploy" rel="noopener noreferrer">deploy/</a>.</p>

<h2>Verify it yourself</h2>
<p>With the reference consumer
(<a href="https://www.npmjs.com/package/sustainability-wellknown-consumer" rel="noopener noreferrer"><code>sustainability-wellknown-consumer</code></a>
0.7.0+). <code>--strict</code> runs the conformance battery: a failed <code>MUST</code> fails it,
an unmet <code>SHOULD</code> is reported. Signatures come back <em>verified</em>,
<em>unsigned</em> or <em>unverified</em> — never the data as "true"
(<a href="${REPO_DOCS}/consumer/README.md" rel="noopener noreferrer">docs</a>).</p>
<pre class="cmd"><code><span class="dim"># this gateway's own report, full battery, plus its attestation</span>
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --strict --verify-attestation
<span class="dim"># any subject, by its path prefix</span>
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/wikimedia.org --strict
<span class="dim"># a trend array</span>
npx -y -p sustainability-wellknown-consumer sustainability-fetch "<span class="host">${BASE_TOKEN}</span>/yearly.example${WELL_KNOWN_PATH}?period=2025&amp;granularity=monthly"
<span class="dim"># the signature, and an upstream chain</span>
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span> --verify
npx -y -p sustainability-wellknown-consumer sustainability-fetch <span class="host">${BASE_TOKEN}</span>/tenant-demo.example --upstream
<span class="dim"># just read one</span>
curl -s <span class="host">${BASE_TOKEN}</span>/wikimedia.org${WELL_KNOWN_PATH} | python3 -m json.tool</code></pre>
<p>Without this project's tools: the JSON validates against the
<a href="${REPO}/tree/main/schemas-validators" rel="noopener noreferrer">JTD and CDDL schemas</a>.
Machine-readable list: <a href="/index.json"><code>/index.json</code></a>. More:
<a href="${REPO_DOCS}/gateway/README.md" rel="noopener noreferrer">README</a>,
<a href="${REPO_DOCS}/gateway/GUIDE.md" rel="noopener noreferrer">guide</a>,
<a href="${REPO_DOCS}/gateway/METHODOLOGY.md" rel="noopener noreferrer">methodology</a>,
<a href="${REPO_DOCS}/gateway/data/README.md" rel="noopener noreferrer">sources</a>,
<a href="${REPO_DOCS}/SIGNING-AND-ATTESTATION.md" rel="noopener noreferrer">signing</a>.</p>

<h2>References</h2>
<ul class="refs">
<li><a href="${escapeHtml(doc.specification)}" rel="noopener noreferrer">draft-besleaga-sustainability-wellknown</a>, the Internet-Draft.</li>
<li><a href="${REPO}" rel="noopener noreferrer">Repository</a>; the
<a href="https://www.npmjs.com/package/sustainability-wellknown-publisher" rel="noopener noreferrer">publisher</a> and
<a href="https://www.npmjs.com/package/sustainability-wellknown-consumer" rel="noopener noreferrer">consumer</a> libraries on npm.</li>
<li><a href="https://andreibesleaga.substack.com/p/the-digital-sustainability-data-protocol" rel="noopener noreferrer">Introductory article</a>.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8615" rel="noopener noreferrer">RFC 8615</a>, well-known URIs, and the
<a href="https://www.iana.org/assignments/well-known-uris/" rel="noopener noreferrer">IANA registry</a>.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc9110" rel="noopener noreferrer">RFC 9110</a>, HTTP semantics.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8927" rel="noopener noreferrer">RFC 8927</a> (JTD) and
<a href="https://www.rfc-editor.org/rfc/rfc8610" rel="noopener noreferrer">RFC 8610</a> (CDDL), the schemas.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc7515" rel="noopener noreferrer">RFC 7515</a>, JWS (§7.1 compact form, §4.1.10 <code>cty</code>).</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc8414" rel="noopener noreferrer">RFC 8414</a>, the <code>signed_metadata</code> precedent.</li>
<li><a href="https://www.rfc-editor.org/rfc/rfc3986" rel="noopener noreferrer">RFC 3986</a>, URIs, and
<a href="https://www.rfc-editor.org/rfc/rfc9562" rel="noopener noreferrer">RFC 9562</a>, UUIDs (extension keys).</li>
<li><a href="https://www.w3.org/TR/vc-data-model-2.0/" rel="noopener noreferrer">VC Data Model 2.0</a> and
<a href="https://www.w3.org/TR/vc-jose-cose/" rel="noopener noreferrer">VC-JOSE-COSE</a>, the attestation.</li>
<li><a href="https://ghgprotocol.org/" rel="noopener noreferrer">GHG Protocol</a>, scopes and accounting bases.</li>
<li><a href="https://sci.greensoftware.foundation/" rel="noopener noreferrer">Software Carbon Intensity</a>, <code>sci-score</code>.</li>
</ul>
</main>

<footer>
<p>A specification-demonstration service. Health check:
<a href="/healthz"><code>/healthz</code></a>.</p>
<p><strong>Operator &amp; contact:</strong> ${OPERATOR_NAME}
(<a href="${OPERATOR_CONTACT_URL}" rel="noopener noreferrer">contact routes</a>,
<a href="${ISSUES_URL}" rel="noopener noreferrer">issues</a>) — a private
individual running a non-commercial demonstration. Not affiliated with, and not endorsed by, any
reporting subject listed above. Company, product and service names and trademarks belong to their
owners and are used only to identify whose published report a document is mapped from.</p>
<p><strong>Corrections and removal:</strong> anyone may report an error, and a reporting subject
may ask for its document to be changed or removed, at the address above or by opening an
<a href="${ISSUES_URL}" rel="noopener noreferrer">issue</a>. A removal requested by the
organization a document describes is carried out without it having to give a reason, normally
within seven days.</p>
<p><strong>Sources:</strong> a document about a third party contains only figures that
organization has itself published, its name, the period and links to its own publication. No
text, table, image or logo of a source is reproduced here; each source remains the property of
its owner, under its owner's terms, and is the only authoritative record.</p>
<p><strong>Disclaimer:</strong> This site is for informational and specification-demonstration
purposes only and is provided &quot;as is&quot;, without warranty of any kind. Figures are
traceable to the cited public source documents but may lag the subjects&#39; own publications.
Nothing here is investment, rating, audit, regulatory or compliance advice, and the documents
are not intended for, and should not be relied on for, any such purpose. To the fullest extent the applicable law allows, the
operator accepts no liability for use of, or reliance on, this service.</p>
<p><strong>Privacy:</strong> No cookies, accounts, analytics or tracking. Requests are counted
per client address in memory to limit abuse; the counts are not stored. The theme choice above is
kept only in your browser's local storage. The hosting provider (Railway) may process IP addresses
in standard server logs for operation and security.</p>
<p><strong>Full text:</strong> <a href="${LEGAL_PATH}">legal notice and terms</a>.</p>
<p>The repository's code and its own documents are published under the BSD 3-Clause License at
<a href="https://github.com/andreibesleaga/rfc-sustainability-wellknown" rel="noopener noreferrer">github.com/andreibesleaga/rfc-sustainability-wellknown</a>.</p>
</footer>
<script>
var themeSelect = document.getElementById("theme");
function applyTheme(v) { v === "light" || v === "dark" ? document.documentElement.setAttribute("data-theme", v) : document.documentElement.removeAttribute("data-theme"); themeSelect.value = v === "light" || v === "dark" ? v : "system"; }
try { applyTheme(localStorage.getItem("theme")); } catch (e) { applyTheme(); }
themeSelect.onchange = function () { try { localStorage.setItem("theme", themeSelect.value); } catch (e) {} applyTheme(themeSelect.value); };
var checkForm = document.getElementById("check"), checkOut = document.getElementById("check-out");
checkForm.addEventListener("submit", function (ev) {
  ev.preventDefault();
  checkOut.hidden = false; checkOut.textContent = "checking\u2026";
  fetch("/validate?origin=" + encodeURIComponent(document.getElementById("origin").value), { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json(); })
    .then(function (j) { checkOut.textContent = JSON.stringify(j, null, 2); })
    .catch(function (e) { checkOut.textContent = "request failed: " + e; });
});
</script>${hostScript}
</body>
</html>
`;
}
