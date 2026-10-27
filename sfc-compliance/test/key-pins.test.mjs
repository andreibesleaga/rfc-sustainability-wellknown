/**
 * Which key may verify `signed` (7.2 rule 2): a key pinned for one level never verifies the other, and the
 * operator's Registry keys count only after D2 authenticated its entry. Fixed clock, no network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../lib/check.mjs";
import { main } from "../lib/cli.mjs";
import { KEY1, jwkOf } from "../vectors/build/keys.mjs";
import { root, vectorFiles, inputOf } from "./helpers.mjs";

const file = vectorFiles().find((f) => f.name === "v05-sums-year");
const scenarioNamed = (name) => file.inputs.scenarios.find((s) => s.name === name);
const withPins = (name, pins) => ({ ...inputOf(scenarioNamed(name), file), pins });
const REGISTRAR = { registrar: { "ledger.example": [jwkOf(KEY1).x] } };
const s3Of = (report) => report.rows.filter((r) => r.id === "S3").map((r) => `${r.result}: ${r.detail}`);
const NOT_PINNED = "INFO: signed, not verified against a pinned key";
const PINNED = "PASS: verified under a pinned key";
const key = jwkOf(KEY1);

describe("the signing keys pinned for each level", () => {
  it("a key pinned for publishers only does not verify an operator declaration", async () => {
    const report = await runChecks(withPins("operator-month", { publisherKeys: [key] }));
    expect(s3Of(report)).toEqual([NOT_PINNED]);
  });

  it("a key pinned for operators only does not verify a network declaration", async () => {
    const report = await runChecks(withPins("year-2025", { operatorKeys: [key] }));
    expect(s3Of(report).every((t) => t === NOT_PINNED)).toBe(true);
  });

  it("a key pinned for its own level verifies", async () => {
    expect(s3Of(await runChecks(withPins("operator-month", { operatorKeys: [key] })))).toEqual([PINNED]);
    expect(s3Of(await runChecks(withPins("year-2025", { publisherKeys: [key] }))).some((t) => t === PINNED)).toBe(true);
  });
});

describe("the Registry keys for an operator declaration", () => {
  const d2Signed = (report) => report.rows.filter((r) => r.id === "D2.signed").map((r) => r.result);

  it("count after D2 authenticated the entry under a pinned registrar key", async () => {
    const report = await runChecks(withPins("operator-month", REGISTRAR));
    expect(s3Of(report)).toEqual([NOT_PINNED]);
    expect(d2Signed(report)).toEqual(["PASS"]);
  });

  it("do not count while the registrar key is not pinned", async () => {
    expect(d2Signed(await runChecks(withPins("operator-month", {})))).toEqual([]);
  });

  it("do not count for a key outside its validity window at T", async () => {
    const input = withPins("operator-month", REGISTRAR);
    input.T = "2023-01-01T00:00:00Z";
    expect(d2Signed(await runChecks(input))).toEqual([]);
  });

  it("are not used for a network declaration", async () => {
    expect(d2Signed(await runChecks(withPins("year-2025", REGISTRAR)))).toEqual([]);
  });
});

describe("--publisher-key and --operator-key on the command line", () => {
  let scratch;
  beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), "sfc-keys-")); });
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const keyFile = (name) => { const path = join(scratch, name); writeFileSync(path, JSON.stringify(key)); return path; };
  const example = (name) => join(root, "examples", name);

  async function s3Rows(args) {
    let out = "";
    await main([...args, "--json", "--now", "2026-05-02T00:10:00Z"], { out: (t) => { out += t; }, err: () => {} });
    return JSON.parse(out).rows.filter((r) => r.id === "S3").map((r) => r.result);
  }

  it("--trusted-key pins the key for both levels, as before", async () => {
    const k = keyFile("both.jwk");
    expect((await s3Rows([example("sfc-network.example.json"), "--trusted-key", k]))).not.toEqual([]);
    expect(await s3Rows([example("sfc-operator.example.json"), "--trusted-key", k])).not.toEqual([]);
  });

  it("--operator-key overrides --trusted-key for operator declarations: the same key given as --publisher-key does not verify one", async () => {
    const k = keyFile("pub.jwk");
    const viaPublisher = await s3Rows([example("sfc-operator.example.json"), "--publisher-key", k]);
    expect(viaPublisher).toEqual(["INFO"]);
  });
});
