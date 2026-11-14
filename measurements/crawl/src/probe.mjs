/**
 * The core: everything the crawler does to ONE origin, with every effect
 * (HTTP, clock, sleep, storing a document) passed in. It returns the records
 * of that origin, in a fixed order: robots.txt, the four paths, the random path.
 */
import { createHash } from "node:crypto";
import { DEFAULTS, ROBOTS_TOKEN, probeList } from "./config.mjs";
import { classify } from "./classify.mjs";
import { isAllowed, parseRobots } from "./robots.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function randomPath(seed, host) {
  return `/sustainability-survey-probe-${sha256(`${seed}:${host}`).slice(0, 16)}`;
}

const siteOf = (url) => url.host.replace(/^www\./, "");

/** Follows up to `maxRedirects` hops inside the same site. Never throws. */
async function follow(url, deps) {
  const start = new URL(url);
  let current = start;
  const seen = new Set([current.href]);
  for (let hops = 0; ; hops++) {
    await deps.pace();
    const response = await deps.get(current.href);
    const isRedirect = response.status >= 300 && response.status < 400 && response.location;
    if (response.error || !isRedirect) return { response, finalUrl: current.href, redirects: hops };
    const next = new URL(response.location, current);
    if (!["http:", "https:"].includes(next.protocol)) return refused(current, hops, "redirect-to-other-scheme", next.protocol);
    if (siteOf(next) !== siteOf(start)) return refused(current, hops, "redirect-off-site", next.host);
    if (seen.has(next.href)) return refused(current, hops, "redirect-loop");
    if (hops + 1 > deps.maxRedirects) return refused(current, hops, "too-many-redirects");
    seen.add(next.href);
    current = next;
  }
}

const refused = (url, hops, error, detail) => ({ response: { error, detail }, finalUrl: url.href, redirects: hops });

function baseRecord(host, probe, url, deps) {
  return { origin: host, probe: probe.id, path: probe.path, requested_url: url, fetched_at: deps.now() };
}

function describe(result, kind, deps) {
  const { response, finalUrl, redirects } = result;
  if (response.error) {
    const detail = response.detail ? { error_detail: response.detail } : {};
    return { status: null, final_url: finalUrl, redirects, classification: "error", error: response.error, ...detail };
  }
  const verdict = classify(deps.consumer, kind, response);
  return {
    status: response.status,
    final_url: finalUrl,
    redirects,
    media_type: (response.contentType ?? "").split(";")[0].trim().toLowerCase() || null,
    content_length: response.contentLength === null ? null : Number(response.contentLength),
    bytes_read: response.body.length,
    truncated: response.truncated,
    sha256_first_bytes: sha256(response.body.subarray(0, deps.hashBytes)),
    classification: verdict.classification,
    ...(verdict.errors ? { validation_errors: verdict.errors } : {}),
    _store: verdict.store ? response.body : null,
  };
}

async function fetchRecord(host, probe, deps) {
  const url = `${deps.scheme}://${host}${probe.path}`;
  const result = await follow(url, deps);
  const { _store, ...rest } = describe(result, probe.kind, deps);
  const stored = _store ? await deps.saveDocument(host, probe.id, _store) : null;
  return { record: { ...baseRecord(host, probe, url, deps), ...rest, stored }, response: result.response };
}

/** RFC 9309: a missing file (4xx) allows everything; an unreachable one (5xx, network) allows nothing. */
function robotsVerdict(record, response) {
  if (unreachable(record)) return { allowAll: false, rules: parseRobots("") };
  if (record.status !== 200 || record.classification === "html-soft-404") return { allowAll: true, rules: parseRobots("") };
  return { allowAll: true, rules: parseRobots(new TextDecoder().decode(response.body)) };
}

/** A probe that was not requested, and why: robots.txt forbids it, or robots.txt could not be read. */
function skippedRecord(host, probe, deps, classification, reason) {
  const url = `${deps.scheme}://${host}${probe.path}`;
  return { ...baseRecord(host, probe, url, deps), status: null, classification, error: reason, stored: null };
}

/** robots.txt is asked for twice at most: one more try after the usual pause when the first fails. */
async function fetchRobots(host, deps) {
  const probe = { id: "robots", path: "/robots.txt", kind: "robots" };
  const first = await fetchRecord(host, probe, deps);
  if (!retryable(first.record)) return first;
  const second = await fetchRecord(host, probe, deps);
  return { ...second, record: { ...second.record, retried: true } };
}

/** A refused redirect will be refused again; only a failure that may be passing is tried twice. */
const retryable = (record) => unreachable(record) && !String(record.error ?? "").startsWith("redirect-");
const unreachable = (record) => record.status === null || record.status >= 500;

/** @returns {Promise<object[]>} the records of one origin */
export async function probeOrigin(host, rawDeps) {
  const deps = { ...DEFAULTS, ...rawDeps };
  let first = true;
  deps.pace = async () => {
    if (!first) await deps.sleep(deps.gapMs);
    first = false;
    deps.requests.count++;
  };
  const robots = await fetchRobots(host, deps);
  const verdict = robotsVerdict(robots.record, robots.response);
  const records = [robots.record];
  for (const probe of probeList(deps.wellKnownPath, randomPath(deps.seed, host))) {
    if (!verdict.allowAll) records.push(skippedRecord(host, probe, deps, "robots-unreachable", "robots.txt unreachable (5xx or network)"));
    else if (!isAllowed(verdict.rules, ROBOTS_TOKEN, probe.path)) records.push(skippedRecord(host, probe, deps, "blocked-by-robots", "disallowed by robots.txt"));
    else records.push((await fetchRecord(host, probe, deps)).record);
  }
  return records;
}
