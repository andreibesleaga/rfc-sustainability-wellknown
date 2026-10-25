import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FUNCTIONAL_UNITS, MEASUREMENT_METHODS, TARGET_TYPES, UPSTREAM_ROLES, decodeSignedPayload, exportPrivateJwk, generateSigningKey,
} from "sustainability-wellknown-publisher";
import { build, declarationFrom, filesFor, parseArgs } from "../bin/create.mjs";
import { FUNCTIONAL_UNIT_MEANINGS, METHOD_MEANINGS, ROLE_MEANINGS, TARGET_TYPE_MEANINGS } from "../src/descriptions.mjs";
import { interview } from "../src/interview.mjs";

const NOW = new Date("2026-10-01T09:30:00Z");
const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "create.mjs");
const scratch = () => mkdtempSync(join(tmpdir(), "csd-"));

const origin = { target: "example.com", provider: "Example Ltd (sustainability@example.com)", "methodology-uri": "https://example.com/m", period: "2026-09", "energy-consumption": "12.5", "carbon-footprint": "3.06", "carbon-unit": "kgCO2e", "measurement-method": "third-party-modeled", "target-type": "origin", host: "file", upstream: [], extension: [] };
const organization = {
  ...origin, provider: "Acme Retail plc (sustainability@acme.example)", target: "Acme Retail plc", "target-type": "organization", period: "2025",
  "energy-consumption": "", "carbon-footprint": "610", "carbon-unit": "tCO2e", "carbon-accounting": "market-based",
  "scope-1": "90", "scope-2": "220", "scope-3": "300", "disclosure-uri": "https://acme.example/esg/disclosures", "methodology-uri": "/esg/methodology",
};
const doc = (answers) => declarationFrom(answers, NOW).doc;
const refuses = (answers, pattern) => assert.throws(() => declarationFrom(answers, NOW), pattern);

test("the descriptions cover exactly the tokens of the publisher library, in its order", () => {
  assert.deepEqual(Object.keys(METHOD_MEANINGS), [...MEASUREMENT_METHODS]);
  assert.deepEqual(Object.keys(FUNCTIONAL_UNIT_MEANINGS), [...FUNCTIONAL_UNITS]);
  assert.deepEqual(Object.keys(ROLE_MEANINGS), [...UPSTREAM_ROLES]);
  assert.deepEqual([...Object.keys(TARGET_TYPE_MEANINGS)].sort(), [...TARGET_TYPES].sort());
  assert.equal(Object.keys(TARGET_TYPE_MEANINGS).length, 9);
  assert.equal(Object.keys(FUNCTIONAL_UNIT_MEANINGS).length, 12);
  assert.equal(Object.keys(ROLE_MEANINGS).length, 6);
  assert.equal(Object.keys(METHOD_MEANINGS).length, 4);
});

test("golden: an organization's yearly file has the calendar-year bounds and tCO2e", () => {
  const d = doc(organization);
  assert.deepEqual(d.period, { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  assert.equal(d["carbon-unit"], "tCO2e");
  assert.equal(d["carbon-accounting"], "market-based");
  assert.equal(d["scope-3"], 300);
  assert.equal(d["methodology-uri"], "/esg/methodology");
  assert.equal(d["target-type"], "organization");
  assert.equal("energy-consumption" in d, false);
  assert.equal("reporting-period" in d, false);
});

test("golden: the seven mandatory members and the units for an origin", () => {
  const d = doc(origin);
  for (const k of ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"]) assert.ok(k in d, k);
  assert.equal(d["energy-unit"], "kWh");
  assert.deepEqual(d.period, { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
});

test("the default period is the last whole year, from the clock given", () => {
  assert.deepEqual(doc({ ...origin, period: "" }).period, { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  assert.equal(doc({ ...origin, period: "" }).updated, "2026-10-01T09:30:00Z");
});

test("labels expand to whole calendar units in the stated offset", () => {
  assert.deepEqual(doc({ ...origin, period: "2025", offset: "+02:00" }).period, { start: "2025-01-01T00:00:00+02:00", end: "2026-01-01T00:00:00+02:00" });
  assert.deepEqual(doc({ ...origin, period: "2025-03-14" }).period, { start: "2025-03-14T00:00:00Z", end: "2025-03-15T00:00:00Z" });
  assert.deepEqual(doc({ ...origin, period: "2024-02" }).period, { start: "2024-02-01T00:00:00Z", end: "2024-03-01T00:00:00Z" });
  assert.deepEqual(doc({ ...origin, period: "2024-02-29" }).period.end, "2024-03-01T00:00:00Z");
});

test("edge: a year ending on 31 March is the next day's first instant, from inclusive dates", () => {
  const d = doc({ ...origin, period: "", "first-day": "2025-04-01", "last-day": "2026-03-31" });
  assert.deepEqual(d.period, { start: "2025-04-01T00:00:00Z", end: "2026-04-01T00:00:00Z" });
});

test("edge: explicit bounds keep their offsets and are compared as instants", () => {
  const d = doc({ ...origin, period: "", "period-start": "2025-03-30T00:00:00+01:00", "period-end": "2025-04-30T00:00:00+02:00" });
  assert.deepEqual(d.period, { start: "2025-03-30T00:00:00+01:00", end: "2025-04-30T00:00:00+02:00" });
});

test("refusal: a period that is not a real date, not a date-time, or not in order", () => {
  refuses({ ...origin, period: "2026-13" }, /period:.*2026-13/);
  refuses({ ...origin, period: "2025-02-30" }, /period:.*2025-02-30/);
  refuses({ ...origin, period: "2025-02-29" }, /period:/);
  refuses({ ...origin, period: "last year" }, /YYYY, YYYY-MM or YYYY-MM-DD/);
  refuses({ ...origin, period: "", "period-start": "2025-01-01", "period-end": "2026-01-01T00:00:00Z" }, /period.start/);
  refuses({ ...origin, period: "", "period-start": "2025-02-30T00:00:00Z", "period-end": "2026-01-01T00:00:00Z" }, /not a real date/);
  refuses({ ...origin, period: "", "period-start": "2026-01-01T00:00:00Z", "period-end": "2026-01-01T00:00:00Z" }, /start must be before/);
  refuses({ ...origin, period: "", "period-start": "2026-02-01T00:00:00Z", "period-end": "2026-01-01T00:00:00Z" }, /start must be before/);
  refuses({ ...origin, period: "", "first-day": "2026-03-31", "last-day": "2025-04-01" }, /start must be before/);
  refuses({ ...origin, period: "", "period-start": "2025-01-01T00:00:00Z" }, /period-end is required/);
  refuses({ ...origin, "first-day": "2025-04-01", "last-day": "2026-03-31" }, /one form only/);
  refuses({ ...origin, period: "2025", offset: "tomorrow" }, /period:/);
});

test("refusal: a tenth target type is refused and the nine are named", () => {
  try {
    declarationFrom({ ...origin, "target-type": "region" }, NOW);
    assert.fail("expected a refusal");
  } catch (e) {
    for (const t of TARGET_TYPES) assert.match(e.message, new RegExp(t));
  }
  for (const t of TARGET_TYPES) {
    const target = t === "path" ? "/api/v1" : t === "origin" ? "example.com" : "Name";
    assert.equal(doc({ ...origin, "target-type": t, target })["target-type"], t);
  }
});

test("refusal: tokens and units outside their sets name the allowed values", () => {
  refuses({ ...origin, "measurement-method": "estimated" }, /one of hardware-metered, hardware-estimated, cloud-billing, third-party-modeled/);
  refuses({ ...origin, "measurement-method": "Hardware-Metered" }, /measurement-method must be one of/);
  refuses({ ...origin, "carbon-unit": "mtCO2e" }, /one of gCO2e, kgCO2e, tCO2e/);
  refuses({ ...origin, "energy-unit": "joule" }, /one of Wh, kWh, MWh, GWh/);
  refuses({ ...origin, "carbon-accounting": "net" }, /location-based, market-based/);
  refuses({ ...origin, "sci-score": "0.01", "functional-unit": "per-minute" }, /functional-unit must be one of per-request/);
  refuses({ ...origin, "sci-score": "0.01" }, /functional-unit is required with sci-score/);
  refuses({ ...origin, upstream: ["storage:https://x.example/d.json"] }, /upstream role must be one of hosting, colocation/);
});

test("refusal: figures, links and mandatory answers", () => {
  const none = { ...origin, "energy-consumption": "", "carbon-footprint": "" };
  refuses(none, /give a figure .* or a disclosure-uri/);
  assert.doesNotThrow(() => doc({ ...none, "disclosure-uri": "https://example.com/esg" }));
  assert.doesNotThrow(() => doc({ ...none, "verifiable-attestation-uri": "https://example.com/att" }));
  refuses({ ...origin, "energy-consumption": "-1" }, /energy-consumption must not be negative/);
  refuses({ ...origin, "carbon-footprint": "-0.5" }, /carbon-footprint must not be negative/);
  refuses({ ...origin, "energy-consumption": "lots" }, /must be a number/);
  refuses({ ...origin, "renewable-energy": "101" }, /between 0 and 100/);
  refuses({ ...origin, "methodology-uri": "" }, /methodology-uri is required/);
  refuses({ ...origin, "methodology-uri": "not a uri" }, /URI reference/);
  refuses({ ...origin, provider: " " }, /provider is required/);
  refuses({ ...origin, target: "" }, /target is required/);
  refuses({ ...origin, updated: "yesterday" }, /updated/);
  refuses({ ...origin, "energy-kwh": "1" }, /not both/);
});

test("edge: a scope may be negative (a removal), and a score needs its unit", () => {
  assert.equal(doc({ ...organization, "scope-1": "-5" })["scope-1"], -5);
  const d = doc({ ...origin, "sci-score": "0.012", "functional-unit": "per-request" });
  assert.equal(d["sci-score"], 0.012);
  assert.equal(d["functional-unit"], "per-request");
});

test("the older shorthands still work", () => {
  const d = doc({ ...origin, "energy-consumption": "", "carbon-footprint": "", "carbon-unit": "", "energy-kwh": "2", "carbon-kgco2e": "1" });
  assert.equal(d["energy-unit"], "kWh");
  assert.equal(d["carbon-unit"], "kgCO2e");
});

test("upstream roles and extensions are read from repeated options", () => {
  const a = parseArgs(["--upstream", "cloud:https://cloud.example/t.json", "--upstream", "tenants/b.json", "--extension", 'https://acme.example/ext/water={"water-m3": 5}']);
  const d = doc({ ...origin, ...a, period: "2026-09" });
  assert.deepEqual(d.upstream, [{ declaration: "https://cloud.example/t.json", role: "cloud" }, { declaration: "tenants/b.json" }]);
  assert.deepEqual(d.extensions, { "https://acme.example/ext/water": { "water-m3": 5 } });
  refuses({ ...origin, extension: ["acme={}"] }, /extension name/);
  refuses({ ...origin, extension: ["https://a.example/x=1"] }, /NAME=\{/);
});

test("a host in U-label form is written in A-label form and the tool says so", async () => {
  const r = await build({ ...origin, target: "bücher.example" }, { now: NOW });
  assert.equal(r.doc.target, "xn--bcher-kva.example");
  assert.match(r.notes.join("\n"), /A-label/);
  assert.equal(doc({ ...origin, "target-type": "organization", target: "Bücher AG" }).target, "Bücher AG");
});

test("the strict validator refuses a path target that does not begin with a slash", async () => {
  await assert.rejects(build({ ...origin, "target-type": "path", target: "api/v1" }, { now: NOW }), /begins with "\/"/);
});

test("a personal-looking provider address warns; a role address does not", async () => {
  const personal = await build({ ...origin, provider: "Jane Doe (jane.doe@example.com)" }, { now: NOW });
  assert.match(personal.warnings.join("\n"), /jane\.doe@/);
  const role = await build(origin, { now: NOW });
  assert.equal(role.warnings.filter((w) => /provider/.test(w)).length, 0);
});

test("the four disclosures are always warned about, and per-user adds the aggregation advice", async () => {
  const plain = await build(origin, { now: NOW });
  for (const topic of ["capacity and load patterns", "precise metrics hardware", "which services and paths exist", "contact strings"]) {
    assert.ok(plain.advice.some((w) => w.startsWith(topic)), topic);
  }
  assert.equal(plain.advice.length, 4);
  const perUser = await build({ ...origin, "sci-score": "0.1", "functional-unit": "per-user" }, { now: NOW });
  assert.match(perUser.advice.at(-1), /individual users or small groups/);
});

test("signing: an Ed25519 key signs the file and the signature matches the object", async () => {
  const dir = scratch();
  const key = await generateSigningKey("Ed25519");
  const file = join(dir, "private.jwk");
  writeFileSync(file, JSON.stringify(await exportPrivateJwk(key)));
  const r = await build({ ...origin, key: file }, { now: NOW });
  const header = JSON.parse(Buffer.from(r.doc.signed.split(".")[0], "base64url").toString());
  assert.equal(header.alg, "Ed25519");
  const { signed, ...rest } = r.doc;
  assert.deepEqual(JSON.parse(decodeSignedPayload(signed)), rest);
  assert.equal(Object.keys(r.doc).at(-1), "signed");
  assert.doesNotMatch(r.notes.join("\n"), /unsigned/);
});

test("signing: a symmetric HS256 key and an ES256 key are refused and named", async () => {
  const dir = scratch();
  const hs = join(dir, "hs.jwk");
  writeFileSync(hs, JSON.stringify({ kty: "oct", alg: "HS256", k: "c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LXNlY3JldA" }));
  await assert.rejects(build({ ...origin, key: hs }, { now: NOW }), /HS256/);
  const bare = join(dir, "oct.jwk");
  writeFileSync(bare, JSON.stringify({ kty: "oct", k: "c2VjcmV0" }));
  await assert.rejects(build({ ...origin, key: bare }, { now: NOW }), /HS256/);
  const es = join(dir, "es.jwk");
  writeFileSync(es, JSON.stringify(await exportPrivateJwk(await generateSigningKey("ES256"))));
  await assert.rejects(build({ ...origin, key: es }, { now: NOW }), /ES256.*Ed25519/);
  const junk = join(dir, "junk.jwk");
  writeFileSync(junk, "not json");
  await assert.rejects(build({ ...origin, key: junk }, { now: NOW }), /not valid JSON/);
  await assert.rejects(build({ ...origin, key: join(dir, "missing.jwk") }, { now: NOW }), /ENOENT/);
});

test("signing: a key file naming alg EdDSA on an Ed25519 key signs, and the header says Ed25519", async () => {
  const dir = scratch();
  const file = join(dir, "eddsa.jwk");
  const jwk = await exportPrivateJwk(await generateSigningKey("Ed25519"));
  writeFileSync(file, JSON.stringify({ ...jwk, alg: "EdDSA" }));
  const r = await build({ ...origin, key: file }, { now: NOW });
  const header = JSON.parse(Buffer.from(r.doc.signed.split(".")[0], "base64url").toString());
  assert.equal(header.alg, "Ed25519");
});

test("with no key the file is unsigned and the tool says so", async () => {
  const r = await build(origin, { now: NOW });
  assert.equal("signed" in r.doc, false);
  assert.match(r.notes.join("\n"), /unsigned/);
});

test("the methodology stub has the five headings, the extension names, the unit and the noise bound", async () => {
  const a = { ...origin, "methodology-stub": true, "sci-score": "0.012", "functional-unit": "per-request", extension: ['https://acme.example/esg/extensions/water-and-waste={"water-consumption-m3": 1250}'], noise: "1" };
  const stub = (await build(a, { now: NOW })).files["methodology.md"];
  for (const h of ["What is measured and what is estimated", "Allocation to a part of the target", "What counts as one unit", "Extension names used", "Perturbation"]) {
    assert.match(stub, new RegExp(`^## ${h}$`, "m"));
  }
  assert.match(stub, /https:\/\/acme\.example\/esg\/extensions\/water-and-waste/);
  assert.match(stub, /`per-request`: one request the target serves/);
  assert.match(stub, /within 1 percent/);
  assert.match(stub, /not a separate measurement/);
  const plain = (await build({ ...origin, "methodology-stub": true }, { now: NOW })).files["methodology.md"];
  assert.match(plain, /No perturbation was applied/);
  assert.equal("methodology.md" in (await build(origin, { now: NOW })).files, false);
  await assert.rejects(build({ ...origin, noise: "5" }, { now: NOW }), /noise/);
});

test("every host gets its configuration next to the file", () => {
  const d = doc(origin);
  assert.deepEqual(Object.keys(filesFor("netlify", d)), [".well-known/sustainability-data", "_headers"]);
  assert.deepEqual(Object.keys(filesFor("vercel", d)), [".well-known/sustainability-data", "vercel.json"]);
  assert.ok(filesFor("nginx", d)["sustainability-data.nginx.conf"].includes("application/sustainability-data+json"));
  assert.ok(filesFor("apache", d)[".htaccess"].includes("ForceType"));
  assert.ok(filesFor("caddy", d)["Caddyfile.snippet"].includes("file_server"));
  assert.deepEqual(Object.keys(filesFor("file", d)), [".well-known/sustainability-data"]);
  assert.throws(() => filesFor("ftp", d), /host must be/);
});

test("arguments parse as documented", () => {
  const a = parseArgs(["--target", "x.example", "--host", "netlify", "--yes", "--methodology-stub"]);
  assert.equal(a.target, "x.example");
  assert.equal(a.host, "netlify");
  assert.equal(a.yes, true);
  assert.equal(a["methodology-stub"], true);
  assert.throws(() => parseArgs(["--target"]), /needs a value/);
  assert.throws(() => parseArgs(["--taget", "x"]), /unknown option --taget/);
  assert.throws(() => parseArgs(["stray"]), /unexpected argument/);
});

test("the interview asks the questions in order and fills the answers", async () => {
  const asked = [];
  const replies = ["Acme Retail plc", "organization", "Acme (esg@acme.example)", "/esg/m", "2025", "+01:00", "", "610", "tCO2e", "", "cloud-billing", "netlify", "./site", ""];
  const ask = async (q, d) => { asked.push(q); const v = replies.shift(); return v === "" ? d : v; };
  const printed = [];
  const a = await interview(ask, {}, (t) => printed.push(t));
  assert.match(asked[0], /^1\/7/);
  assert.ok(asked.some((q) => /^7\/7/.test(q)));
  assert.equal(a["target-type"], "organization");
  assert.equal(a["carbon-unit"], "tCO2e");
  assert.equal(a["measurement-method"], "cloud-billing");
  assert.equal(a.offset, "+01:00");
  assert.match(printed.join("\n"), /hardware-metered: read from meters/);
  assert.match(printed.join("\n"), /tenant: a customer's share/);
});

test("the bin runs through a symlink, writes the file and the host file, and says what to check", () => {
  const dir = scratch();
  const link = join(dir, "create-sustainability-data");
  symlinkSync(BIN, link);
  assert.match(execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" }), /^usage:[\s\S]*hardware-metered: read from meters/);
  const out = join(dir, "site");
  const run = spawnSync(process.execPath, [link, "--target", "x.example", "--provider", "X (esg@x.example)", "--methodology-uri", "https://x.example/m",
    "--period", "2026-09", "--energy-kwh", "1", "--host", "netlify", "--out", out, "--yes"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /sustainability-fetch https:\/\/x\.example --strict/);
  assert.match(run.stderr, /unsigned/);
  assert.ok(existsSync(join(out, ".well-known", "sustainability-data")));
  assert.ok(readFileSync(join(out, "_headers"), "utf8").includes("application/sustainability-data+json"));
});

test("a refusal exits with 1, names the reason and writes nothing", () => {
  const out = join(scratch(), "site");
  const run = spawnSync(process.execPath, [BIN, "--target", "x.example", "--provider", "X", "--methodology-uri", "/m", "--energy-kwh", "1",
    "--target-type", "region", "--out", out, "--yes"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /error: target-type must be one of origin, path, organization, facility/);
  assert.equal(existsSync(out), false);
});

test("a lower-case z offset is refused with a message about the case; an unlisted unit points at extensions", () => {
  refuses({ ...origin, offset: "z" }, /upper case, "Z"/);
  refuses({ ...origin, "sci-score": "0.2", "functional-unit": "per-visit" }, /goes in extensions/);
});
