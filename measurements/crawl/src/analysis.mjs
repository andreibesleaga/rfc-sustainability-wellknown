/**
 * From the records to the numbers of the report. Pure functions: records in,
 * a summary object and a Markdown text out. Nothing is estimated; every
 * figure is a count of records, with its denominator next to it.
 */
const PROBES = ["declaration", "carbon-txt", "carbon-txt-well-known", "dist-json", "random"];
const CLASSES = ["valid", "invalid", "parseable", "unparseable", "wrong-media-type", "html-soft-404", "other-200", "not-found", "denied", "blocked-by-robots", "robots-unreachable", "error"];
const NOT_REQUESTED = new Set(["blocked-by-robots", "robots-unreachable"]);
const PATH_LABEL = {
  declaration: "/.well-known/sustainability-data",
  "carbon-txt": "/carbon.txt",
  "carbon-txt-well-known": "/.well-known/carbon.txt",
  "dist-json": "/.well-known/dist.json",
  random: "random path (control)",
};

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const count = (items, key) => items.reduce((acc, item) => ((acc[key(item)] = (acc[key(item)] ?? 0) + 1), acc), {});
const rate = (n, d) => ({ n, of: d, percent: d === 0 ? null : Math.round((n / d) * 10000) / 100 });

function perProbe(records) {
  const out = {};
  for (const id of PROBES) {
    const own = records.filter((r) => r.probe === id);
    const counts = count(own, (r) => r.classification);
    out[id] = { path: PATH_LABEL[id], requested: own.filter((r) => !NOT_REQUESTED.has(r.classification)).length, classes: Object.fromEntries(CLASSES.map((c) => [c, counts[c] ?? 0])) };
  }
  return out;
}

/** Of the answers that were 200 at a target path, how many were a web page instead of the file. */
function falsePositives(records) {
  const out = {};
  for (const id of PROBES.filter((p) => p !== "random")) {
    const ok = records.filter((r) => r.probe === id && r.status === 200);
    out[id] = { status200: ok.length, web_page: rate(ok.filter((r) => r.classification === "html-soft-404").length, ok.length) };
  }
  return out;
}

function softFourOhFour(records) {
  const random = records.filter((r) => r.probe === "random" && !NOT_REQUESTED.has(r.classification) && r.classification !== "error");
  return {
    origins_probed: random.length,
    any_path_returns_web_page: rate(random.filter((r) => r.classification === "html-soft-404").length, random.length),
    any_path_returns_200_other: rate(random.filter((r) => r.classification === "other-200").length, random.length),
  };
}

function adoption(records, origins) {
  const hit = (r) => ["valid", "invalid", "parseable"].includes(r.classification);
  const byOrigin = (ids) => new Set(records.filter((r) => ids.includes(r.probe) && hit(r)).map((r) => r.origin)).size;
  return {
    declaration_valid: rate(records.filter((r) => r.probe === "declaration" && r.classification === "valid").length, origins),
    declaration_present: rate(byOrigin(["declaration"]), origins),
    carbon_txt_present: rate(byOrigin(["carbon-txt", "carbon-txt-well-known"]), origins),
    dist_json_present: rate(byOrigin(["dist-json"]), origins),
    any_signal: rate(byOrigin(PROBES.filter((p) => p !== "random")), origins),
  };
}

function robotsAndErrors(records, origins) {
  const robots = records.filter((r) => r.probe === "robots");
  const blocked = new Set(records.filter((r) => r.classification === "blocked-by-robots").map((r) => r.origin));
  const unreadable = new Set(records.filter((r) => r.classification === "robots-unreachable").map((r) => r.origin));
  const errors = records.filter((r) => r.classification === "error");
  return {
    robots_status: sorted(count(robots, (r) => String(r.status))),
    origins_with_a_path_blocked: rate(blocked.size, origins),
    origins_with_robots_unreachable: rate(unreadable.size, origins),
    error_causes: sorted(count(errors, (r) => r.error ?? "unknown")),
    origins_with_a_redirect: rate(new Set(records.filter((r) => r.redirects > 0).map((r) => r.origin)).size, origins),
  };
}

function mediaTypes(records) {
  const docs = records.filter((r) => r.probe === "declaration" && r.classification === "valid");
  return sorted(count(docs, (r) => r.media_type ?? "(none)"));
}

export function summarize(records, manifest = null) {
  const origins = new Set(records.map((r) => r.origin)).size;
  return {
    list: manifest?.list ?? null,
    tool: manifest ? { name: manifest.tool, version: manifest.version, user_agent: manifest.user_agent } : null,
    origins,
    requests_recorded: records.filter((r) => !NOT_REQUESTED.has(r.classification)).length,
    per_path: perProbe(records),
    adoption: adoption(records, origins),
    soft_404: softFourOhFour(records),
    web_page_among_status_200: falsePositives(records),
    robots_and_errors: robotsAndErrors(records, origins),
    valid_declaration_media_types: mediaTypes(records),
  };
}

const pct = (r) => `${r.n} of ${r.of}${r.percent === null ? "" : ` (${r.percent} %)`}`;
const row = (cells) => `| ${cells.join(" | ")} |\n`;

function classTable(summary) {
  let text = row(["Path", ...CLASSES]) + row(["---", ...CLASSES.map(() => "---:")]);
  for (const id of PROBES) text += row([`\`${PATH_LABEL[id]}\``, ...CLASSES.map((c) => summary.per_path[id].classes[c])]);
  return text;
}

function adoptionTable(a) {
  const rows = [
    ["Valid declaration at `/.well-known/sustainability-data`", a.declaration_valid],
    ["Declaration present (valid or parseable)", a.declaration_present],
    ["carbon.txt present (either path)", a.carbon_txt_present],
    ["dist.json present", a.dist_json_present],
    ["Any of the four", a.any_signal],
  ];
  return row(["Measure", "Origins"]) + row(["---", "---"]) + rows.map(([l, r]) => row([l, pct(r)])).join("");
}

function interopTable(rows) {
  if (!rows) return "_No interoperability file was supplied (see the README, step 3)._\n";
  const cols = ["origin", "status", "media_type", "valid", "period", "signed", "note"];
  return row(cols) + row(cols.map(() => "---")) + rows.map((r) => row(cols.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|")))).join("");
}

export function renderTables(summary, interopRows = null) {
  const s = summary;
  return [
    `# Survey tables\n`,
    `List: ${s.list ? `${s.list.file}, dated ${s.list.date}, ${s.list.hosts} hosts, sha-256 ${s.list.sha256}` : "(no manifest)"}. Origins with finished records: ${s.origins}. Requests made: ${s.requests_recorded}.\n`,
    `## Table 1. Classification of the answer, per path\n\n${classTable(s)}`,
    `## Table 2. Adoption (denominator: all origins with finished records)\n\n${adoptionTable(s.adoption)}`,
    `## Table 3. Any path answers with a web page (random-path control)\n\n` +
      `- Origins probed (random path requested and answered): ${s.soft_404.origins_probed}\n` +
      `- Web page for a path that cannot exist: ${pct(s.soft_404.any_path_returns_web_page)}\n` +
      `- Any other 200 for a path that cannot exist: ${pct(s.soft_404.any_path_returns_200_other)}\n`,
    `## Table 4. Of the 200 answers at each target path, how many were a web page\n\n` +
      row(["Path", "200 answers", "Web page"]) + row(["---", "---:", "---"]) +
      Object.entries(s.web_page_among_status_200).map(([id, v]) => row([`\`${PATH_LABEL[id]}\``, v.status200, pct(v.web_page)])).join(""),
    `## Table 5. Politeness and failures\n\n` +
      `- Origins where robots.txt stopped at least one request: ${pct(s.robots_and_errors.origins_with_a_path_blocked)}\n` +
      `- Origins whose robots.txt could not be read, so nothing else was requested: ${pct(s.robots_and_errors.origins_with_robots_unreachable)}\n` +
      `- Origins with at least one redirect: ${pct(s.robots_and_errors.origins_with_a_redirect)}\n` +
      `- robots.txt statuses: ${JSON.stringify(s.robots_and_errors.robots_status)}\n` +
      `- Error causes: ${JSON.stringify(s.robots_and_errors.error_causes)}\n` +
      `- Media types of valid declarations: ${JSON.stringify(s.valid_declaration_media_types)}\n`,
    `## Table 6. Interoperability of the known deployments (the repository's own checker)\n\n${interopTable(interopRows)}`,
  ].join("\n");
}

const unquote = (cell) => (cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell);
const CELLS = /(?:^|,)("(?:[^"]|"")*"|[^,]*)/g;

/** RFC 4180 CSV with a header row, as `schemas-validators/check-live.py --csv` writes it. */
export function parseCsv(text) {
  const records = text.match(/(?:"(?:[^"]|"")*"|[^\r\n])+/g) ?? [];
  const [header, ...body] = records.map((r) => [...r.matchAll(CELLS)].map((m) => unquote(m[1])));
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""])));
}
