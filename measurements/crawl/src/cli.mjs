/**
 * Command line of the crawler. `main` takes its effects as arguments so the
 * tests run it in process; crawl.mjs is the thin entry point.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULTS, USER_AGENT, VERSION, loadConsumer } from "./config.mjs";
import { createFetchPort } from "./http.mjs";
import { parseOriginList } from "./input.mjs";
import { openStore, readDone } from "./store.mjs";
import { pendingHosts, runCrawl } from "./run.mjs";

const OPTIONS = {
  list: { type: "string" },
  "list-date": { type: "string" },
  out: { type: "string" },
  limit: { type: "string" },
  "max-requests": { type: "string" },
  concurrency: { type: "string", default: String(DEFAULTS.concurrency) },
  "timeout-ms": { type: "string", default: String(DEFAULTS.timeoutMs) },
  "gap-ms": { type: "string", default: String(DEFAULTS.gapMs) },
  seed: { type: "string", default: DEFAULTS.seed },
  scheme: { type: "string", default: DEFAULTS.scheme },
  "dry-run": { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

const USAGE = `Usage: node crawl.mjs --list FILE --list-date YYYY-MM-DD --out DIR [options]
  --limit N            only the first N origins of the list
  --max-requests N     stop starting origins when N requests would be exceeded
  --concurrency N      origins in parallel (default ${DEFAULTS.concurrency}); one request at a time per origin
  --gap-ms N           pause between requests to one origin (default ${DEFAULTS.gapMs}, minimum 1000 for a real run)
  --timeout-ms N       per request (default ${DEFAULTS.timeoutMs})
  --seed S             seeds the random probe path (default ${DEFAULTS.seed})
  --dry-run            print the plan, make no request
Re-running the same command resumes: finished origins (done.txt) are skipped.`;

const positive = (text, name) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
};

function readOptions(argv) {
  const { values } = parseArgs({ args: argv, options: OPTIONS });
  if (values.help) return { help: true };
  for (const name of ["list", "list-date", "out"]) if (!values[name]) throw new Error(`--${name} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values["list-date"])) throw new Error("--list-date must be YYYY-MM-DD");
  const gapMs = positive(values["gap-ms"], "gap-ms");
  if (values.scheme === "https" && gapMs < DEFAULTS.gapMs) throw new Error(`--gap-ms below ${DEFAULTS.gapMs} is refused for real (https) crawls`);
  return {
    ...values,
    limit: values.limit === undefined ? Infinity : positive(values.limit, "limit"),
    maxRequests: values["max-requests"] === undefined ? Infinity : positive(values["max-requests"], "max-requests"),
    concurrency: positive(values.concurrency, "concurrency"),
    timeoutMs: positive(values["timeout-ms"], "timeout-ms"),
    gapMs,
  };
}

/** A resumed run must read the same list: the fingerprint is checked against the manifest. */
function checkSameList(dir, fingerprint) {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) return;
  const previous = JSON.parse(readFileSync(file, "utf8")).list;
  if (previous.sha256 !== fingerprint) throw new Error(`${dir} holds a crawl of a different list; use a new --out folder`);
}

export function plan(hosts, done, pending, gapMs, concurrency) {
  const requests = pending.length * 7; // at most: robots.txt twice, four paths, one random path
  // one origin takes about five pauses plus six answers of about a second; origins run in waves
  const seconds = Math.ceil(pending.length / Math.max(1, concurrency)) * Math.ceil(5 * gapMs / 1000 + 6);
  return { hosts: hosts.length, done: done.size, pending: pending.length, estimatedRequests: requests, estimatedSeconds: seconds };
}

export async function main(argv, io = {}) {
  const out = io.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const opts = readOptions(argv);
  if (opts.help) return out(USAGE), 0;
  const text = await readFile(opts.list, "utf8");
  const { hosts, rejected } = parseOriginList(text);
  const fingerprint = createHash("sha256").update(text).digest("hex");
  checkSameList(opts.out, fingerprint);
  const done = await readDone(opts.out);
  const pending = pendingHosts(hosts, done, opts.limit);
  const summary = plan(hosts, done, pending, opts.gapMs, opts.concurrency);
  out(JSON.stringify({ ...summary, rejectedLines: rejected.length }));
  if (opts["dry-run"]) return 0;
  const store = await openStore(opts.out);
  const consumer = loadConsumer();
  const requests = { count: 0 };
  const startedAt = new Date().toISOString();
  const probeDeps = {
    get: io.get ?? createFetchPort({ timeoutMs: opts.timeoutMs }),
    consumer,
    wellKnownPath: consumer.WELL_KNOWN_PATH,
    sleep: io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: io.now ?? (() => new Date().toISOString()),
    gapMs: opts.gapMs,
    scheme: opts.scheme,
    seed: opts.seed,
    requests,
    saveDocument: store.saveDocument,
  };
  let stop = false;
  const onSignal = () => (stop = true);
  process.once("SIGINT", onSignal);
  const result = await runCrawl({ pending, store, probeDeps, concurrency: opts.concurrency, maxRequests: opts.maxRequests, shouldStop: () => stop });
  process.removeListener("SIGINT", onSignal);
  await writeManifest(store, opts, { hosts, fingerprint, startedAt, finishedAt: probeDeps.now(), result });
  out(JSON.stringify(result));
  return result.remaining === 0 ? 0 : 3;
}

async function writeManifest(store, opts, run) {
  const file = join(opts.out, "manifest.json");
  const runs = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).runs : [];
  runs.push({ started_at: run.startedAt, finished_at: run.finishedAt, committed: run.result.committed, requests: run.result.requests, remaining_in_window: run.result.remaining });
  await store.writeManifest({
    tool: "sustainability-data-survey",
    version: VERSION,
    user_agent: USER_AGENT,
    list: { file: opts.list.split("/").pop(), date: opts["list-date"], sha256: run.fingerprint, hosts: run.hosts.length },
    parameters: { limit: opts.limit === Infinity ? null : opts.limit, concurrency: opts.concurrency, gap_ms: opts.gapMs, timeout_ms: opts.timeoutMs, seed: opts.seed, max_requests: opts.maxRequests === Infinity ? null : opts.maxRequests, scheme: opts.scheme },
    runs,
  });
}
