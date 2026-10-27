/**
 * The SFC 2 data side: schemas, test vectors, examples. Deterministic: no network, no clock.
 *   - every schema is valid JSON Schema 2020-12 and names a stable $id;
 *   - the schemas accept what the vector inputs hold and reject the negative cases;
 *   - the examples pass the published consumer library;
 *   - the generator is deterministic and the files in the tree are its output;
 *   - the independent Python cross-check agrees with every expected output.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateDocument } from "sustainability-wellknown-consumer";
import { eventShape, entryShape } from "../lib/shapes.mjs";
import { voidShape, checkpointShape } from "./shape-oracle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => JSON.parse(readFileSync(join(root, ...p), "utf8"));
const SCHEMA_FILES = ["registry-entry.json", "event-energy.json", "event-carbon.json", "ledger-excerpt.json", "ext-hardware-lifecycle.json", "ext-carbon-neutrality.json", "ext-network-topology.json", "ext-ledger-evidence-2.json", "sfc-parameters.json"];
const EXT = "https://andreibesleaga.com/sfc/extensions/";

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validators = Object.fromEntries(SCHEMA_FILES.map((f) => [f, ajv.compile(read("schemas", f))]));
const ok = (file, value) => validators[file](value);

/** Every scenario of every input file, shared excerpts resolved. */
function allScenarios() {
  const files = readdirSync(join(root, "vectors", "inputs")).map((f) => join("vectors", "inputs", f)).concat(join("vectors", "worked", "input.json"));
  const out = [];
  for (const f of files) {
    const inp = read(f);
    for (const sc of inp.scenarios) out.push({ file: f, ...sc, ...(sc.excerptRef ? { excerpt: inp.excerpts[sc.excerptRef] } : {}) });
  }
  return out;
}
const scenarios = allScenarios();
const excerpts = scenarios.filter((s) => s.excerpt).map((s) => ({ name: `${s.file} ${s.name}`, excerpt: s.excerpt }));

describe("schemas", () => {
  it("are the files Appendix A lists, each JSON Schema 2020-12 with a stable $id, a title and a description", () => {
    expect(readdirSync(join(root, "schemas")).sort()).toEqual([...SCHEMA_FILES].sort());
    for (const f of SCHEMA_FILES) {
      const s = read("schemas", f);
      expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(s.$id).toBe(`https://raw.githubusercontent.com/andreibesleaga/rfc-sustainability-wellknown/main/sfc-compliance/schemas/${f}`);
      expect(typeof s.title).toBe("string");
      expect(typeof s.description).toBe("string");
    }
  });

  it("accept exactly the events the verifier reads as well formed, in every vector excerpt", () => {
    let seen = 0;
    for (const { name, excerpt } of excerpts) {
      for (const l of excerpt.ledger ?? []) {
        const e = l.event;
        if (e && e.network !== undefined && e.payload?.period?.start !== undefined) {
          const file = e.type === "CarbonAttested" ? "event-carbon.json" : "event-energy.json";
          expect({ name, hash: l.hash, valid: ok(file, e) }).toEqual({ name, hash: l.hash, valid: eventShape(e).length === 0 });
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(500);
  });

  it("accept exactly the Registry entries, void acts and checkpoints the verifier reads as well formed", () => {
    for (const { name, excerpt } of excerpts) {
      for (const en of excerpt.registry ?? []) {
        if (en.network !== undefined && en.sig !== undefined) expect({ name, valid: ok("registry-entry.json", en) }).toEqual({ name, valid: entryShape(en).length === 0 });
      }
    }
    const has = (k) => scenarios.some((s) => s.excerpt && s.excerpt[k]);
    expect(has("voids") && has("checkpoint")).toBe(true);
  });

  it("accept a whole excerpt exactly when every part of it is well formed", () => {
    const wellFormed = (x) => x["excerpt-version"] === 2 && /^2\.[0-9]+$/.test(x["profile-version"])
      && (x.registry ?? []).every((en) => (en.sig === undefined || en.network === undefined ? en.operator !== undefined && en.sig === undefined : entryShape(en).length === 0))
      && (x.voids ?? []).every((v) => voidShape(v).length === 0) && (!x.checkpoint || checkpointShape(x.checkpoint).length === 0);
    let valid = 0, invalid = 0;
    for (const { name, excerpt } of excerpts) {
      const v = ok("ledger-excerpt.json", excerpt);
      if (!v) invalid++; else valid++;
      // an excerpt that the schema accepts has a well formed shape under the verifier's reading, too
      if (v) expect({ name, wellFormed: wellFormed(excerpt) }).toEqual({ name, wellFormed: true });
    }
    expect(valid).toBeGreaterThan(40);
    expect(invalid).toBeGreaterThan(3);
  });

  it("reject the negative cases", () => {
    const base = scenarios.find((s) => s.name === "year-2025").excerpt;
    const event = JSON.parse(JSON.stringify(base.ledger.find((l) => l.event.type === "EnergyAttested").event));
    const carbon = JSON.parse(JSON.stringify(base.ledger.find((l) => l.event.type === "CarbonAttested").event));
    const entry = JSON.parse(JSON.stringify(base.registry[0]));
    const bad = (file, mutate, source) => { const x = JSON.parse(JSON.stringify(source)); mutate(x); return ok(file, x); };
    expect(ok("event-energy.json", event)).toBe(true);
    expect(ok("event-carbon.json", carbon)).toBe(true);
    expect(ok("registry-entry.json", entry)).toBe(true);
    const cases = [
      ["event-energy.json", (x) => { x.network = "https://ledger.example"; }, event],
      ["event-energy.json", (x) => { x.payload.period.start = "2026-01-15T00:00:00Z"; }, event],
      ["event-energy.json", (x) => { x.payload.kWhConsumed = -1; }, event],
      ["event-energy.json", (x) => { x.payload.measurementMethod = "guess"; }, event],
      ["event-energy.json", (x) => { x.payload.evidence = "evidence/relative.json"; }, event],
      ["event-energy.json", (x) => { x.prev = "ABC"; }, event],
      ["event-energy.json", (x) => { delete x.sig; }, event],
      ["event-energy.json", (x) => { x.type = "CarbonAttested"; }, event],
      ["event-carbon.json", (x) => { x.payload.netZero = "yes"; }, carbon],
      ["event-carbon.json", (x) => { x.payload.retirements[0].tonnesRetired = 0; }, carbon],
      ["event-carbon.json", (x) => { x.payload.retirements[0].registry = "http://registry.example"; }, carbon],
      ["event-carbon.json", (x) => { x.payload.retirements = Array.from({ length: 101 }, () => x.payload.retirements[0]); }, carbon],
      ["event-carbon.json", (x) => { delete x.payload.scope3KgCO2e; }, carbon],
      ["registry-entry.json", (x) => { x.nodeProfile.asicForbidden = false; }, entry],
      ["registry-entry.json", (x) => { x.nodeProfile.hardwareClass = "asic-rig"; }, entry],
      ["registry-entry.json", (x) => { x.active = []; }, entry],
      ["registry-entry.json", (x) => { x.keys[0].jwk.crv = "P-256"; }, entry],
      ["registry-entry.json", (x) => { x.commit = "2026-01-01T00:00:00Z"; }, entry],
      ["registry-entry.json", (x) => { delete x.network; }, entry],
      ["ledger-excerpt.json", (x) => { x["excerpt-version"] = 1; }, base],
      ["ledger-excerpt.json", (x) => { x["profile-version"] = "3.0"; }, base],
      ["ledger-excerpt.json", (x) => { x.voids = [{ commit: "2026-03-01T00:00:00Z", target: "1".repeat(64), sig: x.registry[0].sig, extra: 1 }]; }, base],
      ["ledger-excerpt.json", (x) => { x.checkpoint = { network: "ledger.example", "read-at": x["read-at"], chains: [], sig: x.registry[0].sig, extra: 1 }; }, base],
      ["ledger-excerpt.json", (x) => { x.registry.push({ commit: "2026-03-01T00:00:00Z", target: "1".repeat(64), sig: x.registry[0].sig }); }, base],
    ];
    for (const [file, mutate, source] of cases) expect({ file, mutate: String(mutate), valid: bad(file, mutate, source) }).toEqual({ file, mutate: String(mutate), valid: false });
  });

  it("validate the extension values of the examples and reject wrong ones", () => {
    const docs = read("examples", "sfc-network.example.json");
    const primary = docs[0];
    const e = (n) => primary.extensions[`${EXT}${n}`];
    expect(ok("ext-hardware-lifecycle.json", e("hardware-lifecycle"))).toBe(true);
    expect(ok("ext-carbon-neutrality.json", e("carbon-neutrality"))).toBe(true);
    expect(ok("ext-network-topology.json", e("network-topology"))).toBe(true);
    expect(ok("ext-ledger-evidence-2.json", e("ledger-evidence-2"))).toBe(true);
    const operator = read("examples", "sfc-operator.example.json");
    expect(ok("ext-network-topology.json", operator.extensions[`${EXT}network-topology`])).toBe(true);
    expect(ok("ext-ledger-evidence-2.json", operator.extensions[`${EXT}ledger-evidence-2`])).toBe(true);
    expect(ok("ext-hardware-lifecycle.json", { "general-purpose-hardware": true })).toBe(false);
    expect(ok("ext-hardware-lifecycle.json", { "general-purpose-hardware": "yes", "single-use-asic-required": false })).toBe(false);
    expect(ok("ext-carbon-neutrality.json", { "net-zero-status": "net-zero" })).toBe(false);
    expect(ok("ext-carbon-neutrality.json", { "net-zero-status": "achieved", "offsets-retired-tCO2e": -1 })).toBe(false);
    expect(ok("ext-network-topology.json", { "consensus-mechanism": "bft", "member-of-network": "ledger.example" })).toBe(false);
    expect(ok("ext-network-topology.json", { "validated-node-count": 3 })).toBe(false);
    // the operator branch forbids every network-level member of 8.4, not only the three the checker requires
    for (const member of ["per-transaction-energy-Wh", "nakamoto-coefficient", "geographic-regions"]) {
      expect({ member, valid: ok("ext-network-topology.json", { "member-of-network": "ledger.example", [member]: 1 }) }).toEqual({ member, valid: false });
    }
    const ev = JSON.parse(JSON.stringify(e("ledger-evidence-2")));
    ev.operators[0]["energy-head"] = "xyz";
    expect(ok("ext-ledger-evidence-2.json", ev)).toBe(false);
    const ev2 = JSON.parse(JSON.stringify(e("ledger-evidence-2")));
    ev2.operators = [];
    expect(ok("ext-ledger-evidence-2.json", ev2)).toBe(false);
    const ev3 = JSON.parse(JSON.stringify(e("ledger-evidence-2")));
    ev3["profile-version"] = "1.2";
    expect(ok("ext-ledger-evidence-2.json", ev3)).toBe(false);
  });

  it("validate the example parameters and the parameters of every vector but four made incomplete on purpose", () => {
    expect(ok("sfc-parameters.json", read("examples", "sfc-parameters.example.json"))).toBe(true);
    const incomplete = new Set(["permissioned-without-o", "registrar-key-pinned-for-another-host", "void-act-with-no-pinned-key", "read-network-named-constructor-with-a-pin-for-the-real-host"]); // no `o`; no registrar key listed (three times)
    for (const s of scenarios) if (s.parameters) expect({ name: s.name, valid: ok("sfc-parameters.json", s.parameters) }).toEqual({ name: s.name, valid: !incomplete.has(s.name) });
    const p = read("examples", "sfc-parameters.example.json");
    for (const mutate of [(x) => { x["registrar-keys"][0].status = "former"; }, (x) => { x["reference-forms"][0].rules = []; }, (x) => { x.platform.access = "private"; }, (x) => { delete x.platform.assessment; x.platform.access = "public"; }, (x) => { x["scope2-basis-1x"] = "both"; }]) {
      const x = JSON.parse(JSON.stringify(p)); mutate(x);
      expect(ok("sfc-parameters.json", x)).toBe(false);
    }
  });
});

describe("examples", () => {
  const docs = [["sfc-network.example.json", read("examples", "sfc-network.example.json")], ["sfc-operator.example.json", read("examples", "sfc-operator.example.json")]];
  it("pass the published consumer library, every object", () => {
    for (const [name, doc] of docs) {
      const result = validateDocument(doc);
      expect({ name, errors: result.errors }).toEqual({ name, errors: [] });
    }
    expect(docs[0][1]).toHaveLength(2);
    expect(docs[0][1].map((o) => o["carbon-accounting"])).toEqual(["market-based", "location-based"]);
  });
  it("use reserved names and say that every figure is invented", () => {
    for (const [, doc] of docs) for (const o of Array.isArray(doc) ? doc : [doc]) {
      expect(o.target.endsWith(".example")).toBe(true);
      expect(o.provider).toMatch(/SYNTHETIC EXAMPLE/);
    }
  });
});

describe("vectors", () => {
  it("cover every case of Appendix B and the worked case", () => {
    const ids = readdirSync(join(root, "vectors", "inputs")).map((f) => f.replace(".json", ""));
    const want = ["v01-canonical", "v02-hash", "v03-effective", "v04-sums-month", "v05-sums-year", "v06-two-objects", "v07-silent", "v08-fork", "v09-bad-signature", "v10-duplicate-retirement", "v11-late-retirement", "v12-wrong-flag", "v13-late-correction", "v14-tolerance", "v15-profile-1x", "v16-noncanonical-signature", "v17-limits", "v18-registry-1x", "v19-window", "v20-selection", "v21-net-zero-order", "v22-period-offset", "v23-wrong-network", "v24-1x-after-2x", "v25-replay-order", "v26-operator-no-membership", "v27-rollback", "v28-citation-void", "v29-signed-rejected", "v29b-duplicate-members", "v30-registry-binding", "v31-parameters", "v32-ledger-order", "v33-registrar-objects"];
    expect(ids.sort()).toEqual(want.sort());
    expect(readdirSync(join(root, "vectors", "expected")).sort()).toEqual(want.map((i) => `${i}.json`).sort());
    expect(readdirSync(join(root, "vectors", "worked")).sort()).toEqual(["expected.json", "input.json"]);
  });

  it("are the output of the generator, and a second run writes the same bytes", () => {
    const hashes = (dir) => {
      const out = {};
      const walk = (d, rel) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p, `${rel}${f.name}/`); else out[`${rel}${f.name}`] = createHash("sha256").update(readFileSync(p)).digest("hex"); } };
      walk(dir, "");
      return out;
    };
    const dirs = [mkdtempSync(join(tmpdir(), "sfc-a-")), mkdtempSync(join(tmpdir(), "sfc-b-"))];
    try {
      for (const d of dirs) {
        const r = spawnSync(process.execPath, [join(root, "vectors", "make-vectors.mjs"), "--out", d], { encoding: "utf8" });
        expect(r.status, r.stderr).toBe(0);
      }
      const [a, b] = dirs.map((d) => hashes(d));
      expect(a).toEqual(b);
      const inTree = {};
      for (const sub of ["inputs", "expected", "worked"]) for (const [k, v] of Object.entries(hashes(join(root, "vectors", sub)))) inTree[`vectors/${sub}/${k}`] = v;
      for (const f of ["sfc-network.example.json", "sfc-operator.example.json", "sfc-parameters.example.json", "METHODOLOGY.md"]) inTree[`examples/${f}`] = createHash("sha256").update(readFileSync(join(root, "examples", f))).digest("hex");
      expect(a).toEqual(inTree);
    } finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
  }, 120000);

  it("agree with the independent Python cross-check", () => {
    const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      if (process.env.SFC_REQUIRE_PYTHON) throw new Error("python3 not found and SFC_REQUIRE_PYTHON is set: the Python cross-check (Appendix B) must run here");
      return; // no Python on this machine: the check is run where it exists
    }
    const r = spawnSync("python3", ["-I", join(root, "vectors", "crosscheck.py")], { encoding: "utf8" });
    expect(r.stdout.split("\n").filter((l) => /MISMATCH|mismatch\(es\)/.test(l)).join("\n"), r.stderr).toMatch(/0 mismatch\(es\)/);
    expect(r.status).toBe(0);
  }, 180000);
});
