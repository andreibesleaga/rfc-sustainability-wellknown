/**
 * sfc-check: the command line, the reference declarations, the 1.x readings and the rules.
 * No network (fetches use an injected stand-in) and every clock is fixed, so a run means the same thing
 * today and in ten years.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { main } from "../lib/cli.mjs";
import { runChecks } from "../lib/check.mjs";
import { escapeText, overallVerdict } from "../lib/report.mjs";
import { canonicalize } from "../lib/canonical.mjs";
import { readJson, root, vectorFiles, inputOf } from "./helpers.mjs";

const NOW = "2026-05-02T00:10:00Z";
const REGISTRAR_X = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"; // RFC 8032 section 7.1 test 1; the vectors' only key
const example = (name) => join(root, "examples", name);
const fixture = (name) => join(root, "test", "fixtures", "profile-1.1", name);

let scratch;
beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), "sfc-check-")); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Run the command line in process; returns { code, out, err, json }. */
async function cli(args, options) {
  let out = "", err = "";
  const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { clock: () => new Date(NOW), ...options });
  return { code, out, err, json: args.includes("--json") ? JSON.parse(out) : null };
}
const write = (name, value) => { const path = join(scratch, name); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); return path; };
const rowsOf = (report, id) => report.rows.filter((r) => r.id === id);
const resultsOf = (report, id) => rowsOf(report, id).map((r) => r.result);

/** The ledger read behind the two examples, as files, with the pins that make the deep check authenticated. */
function deepArguments(exampleName, scenarioName) {
  const file = vectorFiles().find((f) => f.name === "v05-sums-year");
  const scenario = file.inputs.scenarios.find((s) => s.name === scenarioName);
  const excerpt = write(`${scenarioName}-excerpt.json`, file.inputs.excerpts[scenario.excerptRef]);
  const parameters = example("sfc-parameters.example.json");
  const digest = createHash("sha256").update(readFileSync(parameters)).digest("hex");
  const key = write("key.jwk", { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X });
  return [example(exampleName), "--excerpt", excerpt, "--parameters", parameters, "--parameters-sha256", digest, "--trusted-key", key, "--registrar-key", key, "--network", "ledger.example", "--at", NOW, "--json"];
}



describe("the reference declarations", () => {
  it("the network example conforms to the draft and its figures hang together, and the deep check needs a read", async () => {
    const { code, json } = await cli([example("sfc-network.example.json"), "--json"]);
    expect(code).toBe(0);
    expect(resultsOf(json, "S2")).toEqual(["PASS", "PASS"]);
    expect(resultsOf(json, "C-SFC-5")).toEqual(["PASS"]);
    expect(resultsOf(json, "C-SFC-2")).toEqual(["PASS"]);
    expect(json.objects.map((o) => o.verdict)).toEqual(["COMPLETE", "NOT-APPLICABLE"]);
    expect(rowsOf(json, "C-SFC-7")).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: "no ledger read given" })]);
    expect(json.verdict).toBe("NOT-EVALUABLE");
  });

  it("the operator example is an operator declaration that C-SFC-2 does not judge", async () => {
    const { code, json } = await cli([example("sfc-operator.example.json"), "--json"]);
    expect(code).toBe(0);
    expect(resultsOf(json, "C-SFC-5")).toEqual(["PASS"]);
    expect(rowsOf(json, "C-SFC-2")).toEqual([]);
    expect(json.verdict).toBe("NOT-EVALUABLE");
  });

  it("the network example PASSES and is COMPLETE against its ledger read, with the keys pinned", async () => {
    const { code, json } = await cli(deepArguments("sfc-network.example.json", "year-2025"));
    expect(code).toBe(0);
    for (const id of ["S3", "C-SFC-5", "C-SFC-7", "D2.operator-set", "D2.network", "D4.declared"]) expect(resultsOf(json, id).every((r) => r === "PASS")).toBe(true);
    expect(resultsOf(json, "C-SFC-7")).toEqual(["PASS"]);
    expect(json.objects[0]).toMatchObject({ verdict: "COMPLETE" });
    expect(json.verdict).toBe("PASS");
    expect(json.record).toMatchObject({ T: NOW, tSource: "explicit", registrarKeyPinned: true, methodologyPinned: true });
  });

  it("the operator example PASSES and is COMPLETE against its ledger read, with the keys pinned", async () => {
    const { code, json } = await cli(deepArguments("sfc-operator.example.json", "operator-month"));
    expect(code).toBe(0);
    expect(resultsOf(json, "C-SFC-7")).toEqual(["PASS"]);
    expect(json.objects).toEqual([expect.objectContaining({ verdict: "COMPLETE" })]);
    expect(json.verdict).toBe("PASS");
  });

  it("the same declaration under another registrar key is not authenticated and cannot pass", async () => {
    const args = deepArguments("sfc-network.example.json", "year-2025");
    const other = write("other.jwk", { kty: "OKP", crv: "Ed25519", x: "PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw" });
    args[args.indexOf("--registrar-key") + 1] = other;
    args.splice(args.indexOf("--parameters"), 4); // the parameters also name the first registrar key
    const { json } = await cli(args);
    expect(resultsOf(json, "D2.entry")).toEqual(["FAIL", "FAIL", "FAIL"]);
    expect(json.verdict).toBe("FAIL");
  });
});

describe("a declaration signed with ES256 (7.2 rule 2)", () => {
  const b64u = (x) => Buffer.from(x).toString("base64url");
  const signedWithEs256 = (privateKey) => {
    const { signed, ...served } = readJson("examples", "sfc-network.example.json")[0];
    const head = b64u(canonicalize({ alg: "ES256", cty: "sustainability-data+json" }));
    const body = b64u(canonicalize(served));
    const signature = sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
    return { ...served, signed: `${head}.${body}.${b64u(signature)}` };
  };
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = keys.publicKey.export({ format: "jwk" });

  it("is verified under a pinned P-256 key", async () => {
    const report = await runChecks({ declarations: signedWithEs256(keys.privateKey), pins: { publisherKeys: [jwk] }, T: NOW });
    expect(rowsOf(report, "S3")).toEqual([expect.objectContaining({ result: "PASS", detail: "verified under a pinned key" })]);
  });

  it("is rejected under another P-256 key, and only noted when no key is pinned", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
    const object = signedWithEs256(keys.privateKey);
    const rejected = await runChecks({ declarations: object, pins: { publisherKeys: [other] }, T: NOW });
    expect(rowsOf(rejected, "S3")).toEqual([expect.objectContaining({ result: "FAIL", detail: "signature rejected" })]);
    const unpinned = await runChecks({ declarations: object, T: NOW });
    expect(rowsOf(unpinned, "S3")).toEqual([expect.objectContaining({ result: "INFO", detail: "signed, not verified against a pinned key" })]);
  });
});

describe("profile 1.x declarations (12.1 rule 3)", () => {
  it("1.1.1 examples on the -10 wire without the ledger-evidence name are judged as 2.0 objects without a ledger", async () => {
    for (const name of ["sfc-network.example.json", "sfc-operator.example.json"]) {
      const { code, json } = await cli([fixture(name), "--json"]);
      expect({ name, code }).toEqual({ name, code: 0 });
      expect(json.rows.filter((r) => r.result === "FAIL")).toEqual([]);
      expect(resultsOf(json, "C-SFC-5")).toEqual(["PASS"]);
      expect(rowsOf(json, "S6.b")).toEqual([expect.objectContaining({ result: "INFO", detail: "not derivable: no ledger-evidence-2" })]);
    }
  });

  it("an object with the old ledger-evidence name on the -10 wire is read as profile 1.1 evidence, and no 2.0 check passes on it", async () => {
    const { code, json } = await cli([fixture("ledger-evidence.json"), "--json"]);
    expect(code).toBe(0);
    expect(rowsOf(json, "LEGACY")).toEqual([expect.objectContaining({ result: "INFO", detail: "profile 1.1 evidence, not an SFC 2.0 declaration" })]);
    expect(json.objects).toEqual([expect.objectContaining({ verdict: "NOT-APPLICABLE" })]);
    expect(rowsOf(json, "C-SFC-5")).toEqual([]);
    expect(rowsOf(json, "C-SFC-7")).toEqual([]);
    expect(rowsOf(json, "S6.a")).toEqual([]);
  });

  it("the same object on the pre-10 wire fails S2 and is reported as such", async () => {
    const old = readJson("test", "fixtures", "profile-1.1", "ledger-evidence.json");
    const { period, ...rest } = old;
    const path = write("pre10.json", { ...rest, "reporting-period": "2025" });
    const { code, json } = await cli([path, "--json"]);
    expect(code).toBe(1);
    expect(resultsOf(json, "S2")).toEqual(["FAIL"]);
    expect(rowsOf(json, "LEGACY")).toEqual([expect.objectContaining({ detail: "profile 1.1 evidence, pre-10 wire" })]);
  });

  it("a 1.0 declaration on the -07 wire fails S2 and its energy check cannot be made", async () => {
    const { code, json } = await cli([fixture("legacy-08.json"), "--json"]);
    expect(code).toBe(1);
    expect(resultsOf(json, "S2")).toEqual(["FAIL"]);
    expect(resultsOf(json, "S4")).toEqual(["NOT-EVALUABLE"]);
    expect(rowsOf(json, "C-SFC-2")).toEqual([]);
    expect(json.verdict).toBe("FAIL");
  });
});

describe("profile 1.x events (12.1 rule 1)", () => {
  it("are read inside an excerpt, reported as profile 1.x and kept out of the sums they cannot enter", async () => {
    const file = vectorFiles().find((f) => f.name === "v15-profile-1x");
    const scenario = file.inputs.scenarios.find((s) => s.name === "without-scope2-basis-1x");
    const report = await runChecks(inputOf(scenario, file));
    const notes = rowsOf(report, "D5.1x").map((r) => r.detail);
    expect(notes).toContain("profile 1.x event, period not a month");
    expect(notes).toContain("scope 2 basis undeterminable");
    expect(notes).toContain("retirement rules L8b to L10 not applied");
    expect(rowsOf(report, "C-SFC-4.info").map((r) => r.detail).some((d) => d.startsWith("retirement rules L8b to L10 not applied"))).toBe(true);
  });

  it("an excerpt of format version 1 is not evaluable", async () => {
    const file = vectorFiles().find((f) => f.name === "v15-profile-1x");
    const scenario = file.inputs.scenarios.find((s) => s.name === "excerpt-version-1");
    const report = await runChecks(inputOf(scenario, file));
    expect(rowsOf(report, "D1")).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: "excerpt version 1" })]);
  });
});

/**
 * Failing cases for rules the vectors do not exercise as FAIL: the year-2025 read of the examples with one
 * thing broken. Each entry changes a copy of the excerpt (and the declarations) in memory.
 */
const MUTATIONS = {
  "a declaration whose target is not the read's network": (ex, docs) => { docs[0].target = "other.example"; },
  "a Registry entry changed after it was signed": (ex) => { ex.registry[0].nodeProfile.reusePolicy = "resell-refurbished"; },
  "a registrar key copy that is none of the pinned keys": (ex) => { ex.registrar.jwk.x = "PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw"; },
  "an event whose period is not one month": (ex) => { const p = ex.ledger[0].event.payload.period; p.end = "2025-03-01T00:00:00Z"; },
  "an event emitted before its month ended": (ex) => { ex.ledger[0].event.ts = "2025-01-15T00:00:00Z"; },
  "an event committed after the read": (ex) => { ex.ledger[ex.ledger.length - 1].commit = "2027-01-01T00:00:00Z"; },
};

async function mutatedFailures() {
  const file = vectorFiles().find((f) => f.name === "v05-sums-year");
  const base = file.inputs.scenarios.find((s) => s.name === "year-2025");
  const out = [];
  for (const mutate of Object.values(MUTATIONS)) {
    const input = JSON.parse(JSON.stringify(inputOf(base, file)));
    mutate(input.excerpt, input.declarations);
    const report = await runChecks(input);
    out.push(...report.rows.filter((r) => r.result === "FAIL"));
  }
  return out;
}

describe("every rule has a failing case", () => {
  let failing;
  beforeAll(async () => {
    const rows = [];
    for (const file of vectorFiles()) {
      for (const scenario of file.inputs.scenarios.filter((s) => !s.fn)) rows.push(...(await runChecks(inputOf(scenario, file))).rows);
    }
    failing = [...rows.filter((r) => r.result === "FAIL"), ...(await mutatedFailures())].map((r) => `${r.id} ${r.detail ?? ""}`);
  }, 120000);
  const seen = (id, token) => failing.some((f) => f.startsWith(`${id} `) && (token === undefined || f.includes(token)));

  const RULES = [
    ["S2"], ["S3"], ["S6.a"], ["S6.b"], ["S6.c"], ["S6.d"], ["S6.e"], ["S6.f"], ["S6.i"],
    ["C-SFC-1"], ["C-SFC-2"], ["C-SFC-4"], ["C-SFC-5"], ["C-SFC-6"], ["C-SFC-7"],
    ["D2.operator-set"], ["D2.network"], ["D2.unique"], ["D2.entry", "sig"], ["D2.entry", "weak key"], ["D2.entry", "network"], ["D2.interval"], ["D2.void"], ["D2.rollback"], ["D2.registrar-copy"],
    ["D3.event", "hash"], ["D3.event", "L1"], ["D3.event", "L2"], ["D3.event", "L3"], ["D3.event", "L5"], ["D3.event", "encoding"], ["D3.event", "weak key"], ["D3.order"],
    ["D4.chain", "fork: shared prev"], ["D4.chain", "fork: more than one chain start"], ["D4.chain", "cross-ledger fork"], ["D4.event", "commit after read-at"], ["D4.checkpoint"], ["D4.declared"],
    ["D5.event", "L4"], ["D5.event", "L6"], ["D5.event", "L7"], ["D5.event", "L8"], ["D5.event", "L8b"], ["D5.event", "L9"], ["D5.event", "L10"], ["D5.event", "L11"], ["D5.event", "L11b"], ["D5.event", "L12"],
  ];
  for (const [id, token] of RULES) {
    it(`${id}${token ? ` (${token})` : ""} fails on some input`, () => { expect(seen(id, token)).toBe(true); });
  }
});

describe("the command line", () => {
  it("prints the usage and exits 0 for --help", async () => {
    const { code, out } = await cli(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("usage: sfc-check");
  });

  it("exits 2 with the usage for a missing argument, an unknown option, a bad instant and a missing file", async () => {
    for (const args of [[], ["--bogus", "x"], [example("sfc-network.example.json"), "--now", "yesterday"], [example("sfc-network.example.json"), "--excerpt", join(scratch, "absent.json")],
      [example("sfc-network.example.json"), "--parameters-sha256", "00"], [example("sfc-network.example.json"), "--registrar-key", example("sfc-parameters.example.json")]]) {
      const { code, err } = await cli(args);
      expect({ args, code }).toEqual({ args, code: 2 });
      expect(err).toContain("usage: sfc-check");
    }
  });

  it("refuses a parameters file whose hash is not the pinned one", async () => {
    const { code, err } = await cli([example("sfc-network.example.json"), "--parameters", example("sfc-parameters.example.json"), "--parameters-sha256", "0".repeat(64)]);
    expect(code).toBe(2);
    expect(err).toContain("not the pinned one");
  });

  it("exits 1 when a check FAILs and 0 when none does, whatever is not evaluable", async () => {
    expect((await cli([fixture("legacy-08.json")])).code).toBe(1);
    expect((await cli([example("sfc-network.example.json")])).code).toBe(0);
  });

  it("states the clock it used: --now is a fixed clock, --at an explicit T", async () => {
    const clock = (await cli([example("sfc-network.example.json"), "--now", "2026-03-01T00:00:00Z", "--json"])).json.record;
    expect(clock).toMatchObject({ T: "2026-03-01T00:00:00Z", tSource: "checker clock" });
    const explicit = (await cli([example("sfc-network.example.json"), "--at", "2026-04-01T00:00:00Z", "--json"])).json.record;
    expect(explicit).toMatchObject({ T: "2026-04-01T00:00:00Z", tSource: "explicit" });
    const fallback = (await cli([example("sfc-network.example.json"), "--json"])).json.record;
    expect(fallback).toMatchObject({ T: NOW, tSource: "checker clock" });
  });

  it("prints one line per row, the count line and the record; it never reads as a pass while a gate row is not evaluable", async () => {
    const { out } = await cli([example("sfc-network.example.json")]);
    expect(out).toMatch(/^rows: .*NOT-EVALUABLE/m);
    expect(out).toMatch(/^result: NOT-EVALUABLE .*not a pass/m);
    expect(out).toContain("sustainability-wellknown-consumer 0.8.2");
    expect(out).toContain("not established");
    expect(out).toContain("connected address not reported");
  });

  it("escapes control characters taken from the declaration before printing them", async () => {
    const doc = readJson("examples", "sfc-operator.example.json");
    const path = write("hostile.json", { ...doc, target: "node\u001b[31m.example", provider: "x\u0007" });
    const { out } = await cli([path]);
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
    expect(out).toContain("\\u001b[31m");
  });

  it("reports a body that is not JSON as S2 FAIL and stops there", async () => {
    const { code, json } = await cli([write("broken.json", "{ not json"), "--json"]);
    expect(code).toBe(1);
    expect(rowsOf(json, "S2")).toEqual([expect.objectContaining({ result: "FAIL" })]);
  });

  it("reports a body that is valid JSON but not a declaration object or an array of them as S2 FAIL, exit status 1 (9.1)", async () => {
    for (const [name, text, detail] of [["string.json", '"hello"', "body is not a declaration object or an array of them"], ["null.json", "null", "body is not a declaration object or an array of them"], ["numbers.json", "[1, 2]", "item 0 is not an object"]]) {
      const { code, json } = await cli([write(name, text), "--json"]);
      expect({ name, code }).toEqual({ name, code: 1 });
      expect(rowsOf(json, "S2")[0]).toEqual({ id: "S2", result: "FAIL", detail });
    }
    const empty = await cli([write("empty.json", "[]"), "--json"]);
    expect({ code: empty.code, verdict: empty.json.verdict }).toEqual({ code: 0, verdict: "NOT-APPLICABLE" });
  });
});

describe("fetching an origin (S1)", () => {
  const body = JSON.stringify(readJson("examples", "sfc-network.example.json"));
  const reply = (type, status = 200) => async () => new Response(body, { status, headers: type ? { "content-type": type } : {} });
  const run = (origin, impl) => cli([origin, "--json"], { fetchOptions: { fetchImpl: impl } });

  it("PASSes the registered media type and checks the document it fetched", async () => {
    const { json } = await run("ledger.example", reply("application/sustainability-data+json"));
    expect(rowsOf(json, "S1")).toEqual([expect.objectContaining({ result: "PASS" })]);
    expect(resultsOf(json, "S2")).toEqual(["PASS", "PASS"]);
    expect(resultsOf(json, "C-SFC-5")).toEqual(["PASS"]);
  });

  it("reports the generic media type as INFO and any other type as FAIL", async () => {
    expect(resultsOf((await run("ledger.example", reply("application/json"))).json, "S1")).toEqual(["INFO"]);
    const other = await run("ledger.example", reply("text/html"));
    expect(resultsOf(other.json, "S1")).toEqual(["FAIL"]);
    expect(other.code).toBe(1);
  });

  it("makes a refused or missing document NOT-EVALUABLE with the cause", async () => {
    const refused = await run("ledger.example", reply("application/json", 403));
    expect(rowsOf(refused.json, "S1")).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: "HTTP 403" })]);
    expect(refused.code).toBe(0);
    const gone = await run("ledger.example", reply("application/json", 404));
    expect(resultsOf(gone.json, "S1")).toEqual(["NOT-EVALUABLE"]);
  });

  it("is NOT-EVALUABLE overall, exit status 0, when no document was read (refused, gone, plain http)", async () => {
    const down = async () => { throw new TypeError("fetch failed"); };
    const cases = [await run("ledger.example", reply("application/json", 403)), await run("ledger.example", reply("application/json", 404)),
      await run("ledger.example", down), await run("http://ledger.example", reply("application/json"))];
    for (const { json, code } of cases) {
      expect(json.verdict).toBe("NOT-EVALUABLE");
      expect(code).toBe(0);
    }
  });

  it("does not let a PASS S1 row alone make the overall verdict NOT-EVALUABLE", () => {
    expect(overallVerdict([{ id: "S1", result: "PASS" }, { id: "C-SFC-5", result: "PASS" }])).toBe("PASS");
  });

  it("treats a missing path that looks like a file as a usage error, with no fetch", async () => {
    let calls = 0;
    const impl = async () => { calls++; return new Response(body); };
    for (const source of ["missing.json", "./missing", "../missing.txt", "/tmp/no-such-dir/x"]) {
      const result = await cli([source], { fetchOptions: { fetchImpl: impl } });
      expect(result.code).toBe(2);
      expect(result.err).toContain(`file not found: ${source}`);
    }
    expect(calls).toBe(0);
  });

  it("refuses plain http and userinfo, and never calls the network for them", async () => {
    let calls = 0;
    const impl = async () => { calls++; return new Response(body); };
    expect(rowsOf((await run("http://ledger.example", impl)).json, "S1")[0]).toMatchObject({ result: "NOT-EVALUABLE", detail: "plain http refused" });
    expect(rowsOf((await run("https://user@ledger.example", impl)).json, "S1")[0].result).toBe("NOT-EVALUABLE");
    expect(calls).toBe(0);
  });

  it("fetches the ledger read from ledger-access-uri on request, and an unreadable read is NOT-EVALUABLE", async () => {
    const path = example("sfc-network.example.json");
    const read = async (url) => new Response("{ not json", { status: url.toString().includes("sfc/read") ? 200 : 404 });
    const { json } = await cli([path, "--fetch-ledger", "--json"], { fetchOptions: { fetchImpl: read } });
    expect(rowsOf(json, "D1")).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: expect.stringContaining("read is not valid JSON") })]);
    const refused = await cli([path, "--fetch-ledger", "--json"], { fetchOptions: { fetchImpl: async () => new Response("", { status: 403 }) } });
    expect(rowsOf(refused.json, "D1")).toEqual([expect.objectContaining({ detail: "refused: HTTP 403" })]);
  });
});

describe("the report", () => {
  const rows = (...results) => results.map(([id, result]) => ({ id, result }));
  it("is FAIL when any row FAILs, NOT-EVALUABLE when a gate row is, NOT-APPLICABLE with no SFC object, else PASS", () => {
    expect(overallVerdict(rows(["C-SFC-5", "PASS"], ["S6.a", "FAIL"]))).toBe("FAIL");
    expect(overallVerdict(rows(["C-SFC-5", "PASS"], ["C-SFC-7", "NOT-EVALUABLE"]))).toBe("NOT-EVALUABLE");
    expect(overallVerdict(rows(["S2", "PASS"], ["VERDICT", "NOT-APPLICABLE"]))).toBe("NOT-APPLICABLE");
    expect(overallVerdict(rows(["C-SFC-5", "PASS"], ["C-SFC-2", "PASS"]))).toBe("PASS");
    expect(overallVerdict(rows(["C-SFC-5", "PASS"], ["ERROR", "NOT-EVALUABLE"]))).toBe("NOT-EVALUABLE");
    expect(overallVerdict(rows(["S1", "NOT-EVALUABLE"]))).toBe("NOT-EVALUABLE");
  });

  it("does not let a NOT-EVALUABLE row outside the gate hide a pass, and counts NOT-DECLARED", async () => {
    expect(overallVerdict(rows(["C-SFC-5", "PASS"], ["S4", "NOT-EVALUABLE"]))).toBe("PASS");
    const file = vectorFiles().find((f) => f.name === "v19-window");
    const scenario = file.inputs.scenarios.find((s) => !s.fn && s.excerptRef);
    const report = await runChecks(inputOf(scenario, file));
    expect(report.summary).toHaveProperty("NOT-DECLARED");
  });

  it("escapes control characters, line separators and lone surrogates", () => {
    expect(escapeText("a\nb\u0000 \ud800c")).toBe("a\\u000ab\\u0000\\u2028\\ud800c");
  });

  it("stops a stage that throws and says so, instead of crashing", async () => {
    const hostile = { updated: "2026-02-10T09:00:00Z", extensions: { "https://andreibesleaga.com/sfc/extensions/ledger-evidence-2": null } };
    const report = await runChecks({ declarations: hostile, T: NOW });
    expect(report.rows.length).toBeGreaterThan(0);
    expect(["FAIL", "NOT-EVALUABLE", "PASS", "NOT-APPLICABLE"]).toContain(report.verdict);
  });
});

describe("the checker as a script", () => {
  it("runs from the command line and exits 0 on both examples with a fixed clock", () => {
    for (const name of ["sfc-network.example.json", "sfc-operator.example.json"]) {
      const r = spawnSync(process.execPath, [join(root, "sfc-check.mjs"), example(name), "--now", NOW], { encoding: "utf8" });
      expect({ name, status: r.status, err: r.stderr }).toEqual({ name, status: 0, err: "" });
    }
  }, 120000);
});
