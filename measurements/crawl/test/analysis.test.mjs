import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCsv, renderTables, summarize } from "../src/analysis.mjs";
import { withTempDir } from "./helpers.mjs";

const rec = (origin, probe, classification, extra = {}) => ({ origin, probe, classification, status: ["blocked-by-robots", "robots-unreachable"].includes(classification) ? null : 200, redirects: 0, ...extra });
const full = (origin, c) => ["robots", "declaration", "carbon-txt", "carbon-txt-well-known", "dist-json", "random"].map((p) => rec(origin, p, c[p] ?? "not-found", c[p] ? {} : { status: 404 }));

const RECORDS = [
  ...full("a.test", { declaration: "valid", "carbon-txt": "parseable", robots: "not-found" }),
  ...full("b.test", { declaration: "html-soft-404", "carbon-txt": "html-soft-404", "dist-json": "html-soft-404", "carbon-txt-well-known": "html-soft-404", random: "html-soft-404" }),
  ...full("c.test", { declaration: "invalid" }),
  ...full("d.test", { declaration: "blocked-by-robots", random: "blocked-by-robots" }),
  ...full("e.test", { robots: "error", declaration: "robots-unreachable", random: "robots-unreachable" }),
];

test("golden: counts per path and class, adoption with denominators, soft-404 rate from the random probe", () => {
  const s = summarize(RECORDS);
  assert.equal(s.origins, 5);
  assert.equal(s.per_path.declaration.classes.valid, 1);
  assert.equal(s.per_path.declaration.classes["html-soft-404"], 1);
  assert.equal(s.per_path.declaration.requested, 3);
  assert.deepEqual(s.adoption.declaration_valid, { n: 1, of: 5, percent: 20 });
  assert.deepEqual(s.adoption.declaration_present, { n: 2, of: 5, percent: 40 });
  assert.deepEqual(s.adoption.carbon_txt_present, { n: 1, of: 5, percent: 20 });
  assert.deepEqual(s.soft_404.any_path_returns_web_page, { n: 1, of: 3, percent: 33.33 });
  assert.deepEqual(s.web_page_among_status_200.declaration.web_page, { n: 1, of: 3, percent: 33.33 });
  assert.deepEqual(s.robots_and_errors.origins_with_a_path_blocked, { n: 1, of: 5, percent: 20 });
  assert.deepEqual(s.robots_and_errors.origins_with_robots_unreachable, { n: 1, of: 5, percent: 20 });
});

test("an empty crawl has null percentages, not NaN", () => {
  const s = summarize([]);
  assert.equal(s.adoption.any_signal.percent, null);
  assert.ok(renderTables(s).includes("0 of 0"));
});

test("the tables carry every number of the summary they print, and the interoperability rows when given", () => {
  const text = renderTables(summarize(RECORDS), [{ origin: "https://x.example", status: "200", media_type: "application/json", valid: "True", period: "2025", signed: "True", note: "a|b" }]);
  assert.ok(text.includes("1 of 5 (20 %)"));
  assert.ok(text.includes("| https://x.example | 200 |"));
  assert.ok(text.includes("a\\|b"));
  assert.ok(renderTables(summarize(RECORDS)).includes("No interoperability file was supplied"));
});

test("the CSV reader handles quotes, commas in a cell and CRLF", () => {
  const rows = parseCsv('checked,origin,note\r\n2026-12-01,https://a,"two, parts"\r\n2026-12-01,https://b,"say ""hi"""\r\n');
  assert.deepEqual(rows.map((r) => r.note), ["two, parts", 'say "hi"']);
});

test("the command writes summary.json and tables.md, the same on every run", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "results.jsonl"), RECORDS.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "done.txt"), "a.test\nb.test\nc.test\nd.test\ne.test\n");
    const script = fileURLToPath(new URL("../analyze.mjs", import.meta.url));
    const run = () => spawnSync(process.execPath, [script, "--in", dir], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const first = [readFileSync(join(dir, "summary.json"), "utf8"), readFileSync(join(dir, "tables.md"), "utf8")];
    run();
    assert.deepEqual([readFileSync(join(dir, "summary.json"), "utf8"), readFileSync(join(dir, "tables.md"), "utf8")], first);
    assert.equal(JSON.parse(first[0]).origins, 5);
  });
});

test("records of an origin that is not in the done list are not counted", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "results.jsonl"), RECORDS.map((r) => JSON.stringify(r)).join("\n") + "\n");
    writeFileSync(join(dir, "done.txt"), "a.test\n");
    const script = fileURLToPath(new URL("../analyze.mjs", import.meta.url));
    spawnSync(process.execPath, [script, "--in", dir]);
    assert.equal(JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")).origins, 1);
  });
});

test("table cells escape the backslash first, then the pipe, so a cell cannot break out of its column", () => {
  const rows = [{ origin: "a.example", note: "x\\|y | z\\" }];
  const text = renderTables(summarize(RECORDS), rows);
  assert.ok(text.includes("x\\\\\\|y \\| z\\\\"), text.split("\n").find((l) => l.startsWith("| a.example")));
});
