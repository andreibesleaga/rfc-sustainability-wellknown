import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { main } from "../src/cli.mjs";
import { readDone, readResults } from "../src/store.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import { FIXED_NOW, withTempDir } from "./helpers.mjs";

let server;
before(async () => (server = await startFixtureServer()));
after(() => server.close());

const LIST = ["slow.test", "good.test", "spa.test", "robots.test", "hops.test", "badjson.test"];

async function crawl(dir, extra = [], hosts = LIST) {
  const list = join(dir, "list.csv");
  writeFileSync(list, hosts.map((h, i) => `${i + 1},${h}`).join("\n") + "\n");
  const lines = [];
  const code = await main(
    ["--list", list, "--list-date", "2026-12-01", "--out", join(dir, "out"), "--scheme", "http", "--gap-ms", "0", ...extra],
    { stdout: (s) => lines.push(s), get: server.portFor({ timeoutMs: 800 }), sleep: async () => {}, now: () => FIXED_NOW },
  );
  return { code, lines, out: join(dir, "out") };
}

const resultLines = (out) => readFileSync(join(out, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const originsInOrder = (records) => [...new Set(records.map((r) => r.origin))];

test("golden: a run writes results, done list, documents and manifest; origins in list order whatever finishes first", async () => {
  await withTempDir(async (dir) => {
    const { code, out } = await crawl(dir, ["--concurrency", "4"]);
    assert.equal(code, 0);
    const records = resultLines(out);
    assert.deepEqual(originsInOrder(records), LIST, "slow.test is first in the list and last to finish");
    assert.equal(records.length, LIST.length * 6);
    assert.deepEqual(readFileSync(join(out, "done.txt"), "utf8").split("\n").filter(Boolean), LIST);
    assert.ok(existsSync(join(out, "documents", "good.test__declaration.body")));
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    assert.equal(manifest.list.date, "2026-12-01");
    assert.match(manifest.list.sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.user_agent, /^SustainabilityDataSurvey\//);
  });
});

test("the output is byte-identical whatever the concurrency", async () => {
  await withTempDir(async (a) => withTempDir(async (b) => {
    const one = await crawl(a, ["--concurrency", "1"]);
    const many = await crawl(b, ["--concurrency", "6"]);
    assert.equal(readFileSync(join(one.out, "results.jsonl"), "utf8"), readFileSync(join(many.out, "results.jsonl"), "utf8"));
  }));
});

test("resume after an interruption gives the same files as an uninterrupted run", async () => {
  await withTempDir(async (whole) => withTempDir(async (split) => {
    const full = await crawl(whole);
    const first = await crawl(split, ["--max-requests", "15"]);
    assert.equal(first.code, 3, "stopped by the cap, work remains");
    assert.equal(readFileSync(join(first.out, "done.txt"), "utf8").split("\n").filter(Boolean).length, 2);
    const second = await crawl(split);
    assert.equal(second.code, 0);
    assert.equal(readFileSync(join(second.out, "results.jsonl"), "utf8"), readFileSync(join(full.out, "results.jsonl"), "utf8"));
    assert.equal(readFileSync(join(second.out, "done.txt"), "utf8"), readFileSync(join(full.out, "done.txt"), "utf8"));
    assert.equal(JSON.parse(readFileSync(join(second.out, "manifest.json"), "utf8")).runs.length, 2);
  }));
});

test("a crash in the middle of an origin: its torn records are ignored on reading and the origin is redone", async () => {
  await withTempDir(async (dir) => {
    const hosts = ["good.test", "half.test"];
    const { out } = await crawl(dir, ["--limit", "1"], hosts);
    appendFileSync(join(out, "results.jsonl"), JSON.stringify({ origin: "half.test", probe: "robots", classification: "error" }) + "\n{\"origin\":\"half.te");
    const rows = await readResults(out);
    assert.deepEqual(originsInOrder(rows), ["good.test"]);
    const again = await crawl(dir, [], hosts);
    assert.equal(again.code, 0);
    assert.deepEqual(originsInOrder(await readResults(out)), ["good.test", "half.test"]);
  });
});

test("--limit takes the first N origins of the list", async () => {
  await withTempDir(async (dir) => {
    const { out, code } = await crawl(dir, ["--limit", "2"]);
    assert.equal(code, 0);
    assert.deepEqual(originsInOrder(resultLines(out)), LIST.slice(0, 2));
  });
});

test("--dry-run prints the plan and makes no request and no result file", async () => {
  await withTempDir(async (dir) => {
    server.hits.clear();
    const { lines, out, code } = await crawl(dir, ["--dry-run"]);
    assert.equal(code, 0);
    const plan = JSON.parse(lines[0]);
    assert.deepEqual([plan.hosts, plan.pending, plan.estimatedRequests], [6, 6, 42]);
    assert.equal(server.hits.size, 0);
    assert.ok(!existsSync(out), "not even the output folder is created");
  });
});

test("--max-requests stops starting origins when the next one could pass the cap", async () => {
  await withTempDir(async (dir) => {
    const { out, code } = await crawl(dir, ["--max-requests", "7"]);
    assert.equal(code, 3);
    assert.deepEqual(originsInOrder(resultLines(out)), [LIST[0]]);
  });
});

test("a different list in a used output folder is refused", async () => {
  await withTempDir(async (dir) => {
    await crawl(dir, [], ["good.test"]);
    await assert.rejects(crawl(dir, [], ["spa.test"]), /different list/);
  });
});

test("a real (https) crawl refuses a pause under one second; bad options are named", async () => {
  await withTempDir(async (dir) => {
    const list = join(dir, "l.txt");
    writeFileSync(list, "a.example\n");
    const base = ["--list", list, "--list-date", "2026-12-01", "--out", join(dir, "o")];
    await assert.rejects(main([...base, "--gap-ms", "500"]), /refused for real/);
    await assert.rejects(main(["--list", list]), /--list-date is required/);
    await assert.rejects(main([...base.slice(0, 4), "--out", "x", "--limit=-1"]), /non-negative integer/);
    await assert.rejects(main(["--list", list, "--list-date", "yesterday", "--out", "x"]), /YYYY-MM-DD/);
  });
});

test("the folder holds only documents, no bodies of pages or 404s", async () => {
  await withTempDir(async (dir) => {
    const { out } = await crawl(dir);
    const files = readdirSync(join(out, "documents")).sort();
    assert.ok(files.every((f) => !f.startsWith("spa.test") && !f.startsWith("slow.test")));
    assert.ok(files.includes("badjson.test__declaration.body") === false, "unparseable text is not kept");
  });
});

test("--max-requests is a hard cap: redirect hops count, and an origin cut by the cap is not committed", async () => {
  await withTempDir(async (dir) => {
    const { code, out, lines } = await crawl(dir, ["--max-requests", "7"], ["hops.test"]);
    assert.equal(code, 3);
    assert.equal(JSON.parse(lines.at(-1)).requests, 7);
    assert.deepEqual([...await readDone(out)], []);
    const again = await crawl(dir, [], ["hops.test"]);
    assert.equal(again.code, 0, "the cut origin is crawled afresh on the next run");
  });
});

test("numeric options: concurrency and timeout must be positive integers; zero stays valid for gap, limit, max-requests", async () => {
  await withTempDir(async (dir) => {
    const list = join(dir, "l.txt");
    writeFileSync(list, "a.example\n");
    const base = ["--list", list, "--list-date", "2026-12-01", "--out", join(dir, "o"), "--scheme", "http", "--gap-ms", "0", "--dry-run"];
    await assert.rejects(main([...base, "--concurrency", "0"], { stdout() {} }), /--concurrency must be a positive integer/);
    await assert.rejects(main([...base, "--timeout-ms", "0"], { stdout() {} }), /--timeout-ms must be a positive integer/);
    await assert.rejects(main([...base, "--limit", ""], { stdout() {} }), /--limit must be a non-negative integer/);
    await assert.rejects(main([...base, "--scheme", "ftp"], { stdout() {} }), /--scheme must be http or https/);
    await assert.rejects(main([...base.slice(0, 2), "--list-date", "2026-02-31", ...base.slice(4)], { stdout() {} }), /YYYY-MM-DD/);
    for (const zero of ["--limit", "--max-requests"]) assert.equal(await main([...base, zero, "0"], { stdout() {} }), 0);
  });
});
