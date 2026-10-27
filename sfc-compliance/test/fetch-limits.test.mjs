/**
 * Fetch limits of section 10: a server that sends headers and stalls the body, or declares a body over the cap,
 * is a NOT-EVALUABLE row that names the limit, never a crash. Fake fetch, short timeouts, no network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchDeclaration, fetchDocument, bytesLimitCause, timeLimitCause } from "../lib/input.mjs";
import { main } from "../lib/cli.mjs";
import { root } from "./helpers.mjs";

const TIMEOUT_MS = 50;
const NOW = "2026-05-02T00:10:00Z";
const lookup = async () => ["93.184.216.34"];

// AbortSignal.timeout timers do not keep node alive: without a live timer a stalled stream ends the process silently (exit 13).
let keepAlive;
let scratch;
beforeAll(() => { keepAlive = setInterval(() => {}, 1000); scratch = mkdtempSync(join(tmpdir(), "sfc-fetch-")); });
afterAll(() => { clearInterval(keepAlive); rmSync(scratch, { recursive: true, force: true }); });

/** A response with headers and a body that never ends, until the fetch's own signal aborts it. */
const stalledFetch = async (_url, { signal }) => {
  const body = new ReadableStream({ start(controller) { signal.addEventListener("abort", () => controller.error(signal.reason)); } });
  return new Response(body, { status: 200, headers: { "content-type": "application/sustainability-data+json" } });
};
const options = { timeoutMs: TIMEOUT_MS, fetchImpl: stalledFetch, lookup };
const s1Rows = (report) => report.rows.filter((r) => r.id === "S1");

describe("a body that stalls after the headers", () => {
  it("fetchDocument returns the time limit as the cause", async () => {
    const got = await fetchDocument("https://ledger.example/x", { maxBytes: 1000, ...options });
    expect(got).toEqual({ ok: false, cause: timeLimitCause(TIMEOUT_MS) });
    expect(got.cause).toBe("limit: seconds per fetch (0.05)");
  });

  it("fetchDeclaration gives an S1 NOT-EVALUABLE row that names the limit", async () => {
    const got = await fetchDeclaration("ledger.example", options);
    expect(got.rows).toEqual([expect.objectContaining({ id: "S1", result: "NOT-EVALUABLE", detail: timeLimitCause(TIMEOUT_MS) })]);
  });

  it("the command line prints a report and exits 0 (no FAIL), never 2", async () => {
    let out = "", err = "";
    const code = await main(["ledger.example", "--json"], { out: (t) => { out += t; }, err: (t) => { err += t; } }, { clock: () => new Date(NOW), fetchOptions: options });
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(s1Rows(JSON.parse(out))).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: timeLimitCause(TIMEOUT_MS) })]);
  });

  it("--fetch-ledger with a stalled read is a NOT-EVALUABLE D1 with the cause, not a crash", async () => {
    const path = join(scratch, "declaration.json");
    copyFileSync(join(root, "examples", "sfc-network.example.json"), path);
    let out = "", err = "";
    const code = await main([path, "--fetch-ledger", "--json"], { out: (t) => { out += t; }, err: (t) => { err += t; } }, { clock: () => new Date(NOW), fetchOptions: options });
    expect(code).not.toBe(2);
    expect(err).toBe("");
    expect(JSON.parse(out).rows.some((r) => r.result === "NOT-EVALUABLE" && String(r.detail).includes(timeLimitCause(TIMEOUT_MS)))).toBe(true);
  });
});

describe("a body that fails in another way while it is read", () => {
  const broken = async () => new Response(new ReadableStream({ start(c) { c.error(new Error("connection reset")); } }), { status: 200 });

  it("is a network-error cause that carries the reason", async () => {
    const got = await fetchDocument("https://ledger.example/x", { maxBytes: 1000, timeoutMs: 1000, fetchImpl: broken, lookup });
    expect(got).toEqual({ ok: false, cause: "network-error: connection reset" });
  });
});

describe("a declared length above the cap", () => {
  it("returns the bytes limit and cancels the body without reading it", async () => {
    let cancelled = false, pulled = false;
    const body = new ReadableStream({ pull() { pulled = true; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const big = async () => new Response(body, { status: 200, headers: { "content-length": "5000" } });
    const got = await fetchDocument("https://ledger.example/x", { maxBytes: 1000, timeoutMs: 1000, fetchImpl: big, lookup });
    expect(got).toEqual({ ok: false, cause: bytesLimitCause(1000) });
    expect(cancelled).toBe(true);
    expect(pulled).toBe(false);
  });

  it("still enforces the cap on a body with no declared length", async () => {
    const chunked = async () => new Response("x".repeat(5000), { status: 200 });
    const got = await fetchDocument("https://ledger.example/x", { maxBytes: 1000, timeoutMs: 1000, fetchImpl: chunked, lookup });
    expect(got.cause).toBe("limit: bytes (1000)");
  });
});
