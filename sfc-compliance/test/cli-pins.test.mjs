/**
 * The command line's pins: the methodology hash binds the bytes that are parsed, a registrar key is an Ed25519
 * public key pinned for a named network, and an unexpected error is a message, not a stack trace.
 * Fixed fixtures and clocks, no network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { main } from "../lib/cli.mjs";
import { runChecks } from "../lib/check.mjs";
import { readRegistrarKeyFile } from "../lib/input.mjs";
import { root, vectorFiles, inputOf } from "./helpers.mjs";

const NOW = "2026-05-02T00:10:00Z";
const REGISTRAR_X = "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo";
const example = (name) => join(root, "examples", name);

let scratch;
beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), "sfc-pins-")); });
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function cli(args, options) {
  let out = "", err = "";
  const code = await main(args, { out: (t) => { out += t; }, err: (t) => { err += t; } }, { clock: () => new Date(NOW), ...options });
  return { code, out, err, json: args.includes("--json") && out ? JSON.parse(out) : null };
}
const write = (name, value) => { const path = join(scratch, name); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); return path; };
const ed25519 = (x = REGISTRAR_X) => ({ kty: "OKP", crv: "Ed25519", x });

describe("--parameters-sha256", () => {
  it("is checked against the bytes before they are parsed: a pin mismatch on a file that does not parse is the pin error", async () => {
    const junk = write("junk-parameters.json", "{ this is not json");
    const { code, err } = await cli([example("sfc-network.example.json"), "--parameters", junk, "--parameters-sha256", "0".repeat(64)]);
    expect(code).toBe(2);
    expect(err).toContain("not the pinned one");
    expect(err).not.toContain(junk); // a parse error names the file
  });

  it("a matching hash on a file that does not parse is a parse error naming the file", async () => {
    const text = "{ this is not json";
    const junk = write("junk-parameters-2.json", text);
    const { code, err } = await cli([example("sfc-network.example.json"), "--parameters", junk, "--parameters-sha256", createHash("sha256").update(text).digest("hex")]);
    expect(code).toBe(2);
    expect(err).toContain(junk);
  });

  it("a matching hash pins the methodology document", async () => {
    const path = example("sfc-parameters.example.json");
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    const { json } = await cli([example("sfc-network.example.json"), "--parameters", path, "--parameters-sha256", digest, "--json"]);
    expect(json.record.methodologyPinned).toBe(true);
  });
});

describe("--registrar-key", () => {
  const file = vectorFiles().find((f) => f.name === "v05-sums-year");
  const scenario = file.inputs.scenarios.find((s) => s.name === "year-2025");
  const excerpt = () => write("read.json", file.inputs.excerpts[scenario.excerptRef]);
  const run = (key, ...more) => cli([example("sfc-network.example.json"), "--excerpt", excerpt(), "--registrar-key", key, "--at", NOW, "--json", ...more]);

  it("refuses a key that is not an Ed25519 public key, or has no x", async () => {
    for (const [name, jwk] of [["wrong-kty", { kty: "EC", crv: "P-256", x: REGISTRAR_X, y: REGISTRAR_X }], ["no-x", { kty: "OKP", crv: "Ed25519" }],
      ["wrong-crv", { kty: "OKP", crv: "Ed448", x: REGISTRAR_X }], ["short-x", ed25519("AAAA")]]) {
      const { code, err } = await run(write(`${name}.jwk`, jwk), "--network", "ledger.example");
      expect({ name, code }).toEqual({ name, code: 2 });
      expect(err).toContain(`${name}.jwk`);
    }
  });

  it("accepts an Ed25519 key and reads its x", () => {
    expect(readRegistrarKeyFile(write("good.jwk", ed25519()))).toBe(REGISTRAR_X);
  });

  it("a file source without --network is a usage error: the key needs the network it is pinned for", async () => {
    const { code, err } = await run(write("pinned.jwk", ed25519()));
    expect(code).toBe(2);
    expect(err).toContain("--network");
  });

  it("is pinned for the named network: the read of that network is authenticated", async () => {
    const { json } = await run(write("pinned-ok.jwk", ed25519()), "--network", "ledger.example");
    expect(json.rows.filter((r) => r.id === "D2.entry").map((r) => r.result)).not.toContain("NOT-EVALUABLE");
    expect(json.record.registrarKeyPinned).toBe(true);
  });

  it("a pin for another network than the read's does not authenticate the read, and the record says no key was pinned", async () => {
    const { json } = await run(write("pinned-other.jwk", ed25519()), "--network", "other.example");
    const entries = json.rows.filter((r) => r.id === "D2.entry");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((r) => r.result === "NOT-EVALUABLE")).toBe(true);
    expect(json.record.registrarKeyPinned).toBe(false);
  });

  it("a pinned methodology document that lists no registrar key pins none: every D2.entry is NOT-EVALUABLE and the record agrees", async () => {
    const input = inputOf(scenario, file);
    const { "registrar-keys": listed, ...parameters } = input.parameters;
    const report = await runChecks({ ...input, parameters, pins: { methodology: true } });
    const entries = report.rows.filter((r) => r.id === "D2.entry");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((r) => r.result === "NOT-EVALUABLE" && r.detail === "registrar key not pinned")).toBe(true);
    expect(report.record.registrarKeyPinned).toBe(false);
  });
});

describe("--registrar-key with a URL source", () => {
  const file = vectorFiles().find((f) => f.name === "v05-sums-year");
  const excerptOf = (name) => { const s = file.inputs.scenarios.find((x) => x.name === name); return write(`${name}.json`, file.inputs.excerpts[s.excerptRef]); };
  const parameters = example("sfc-parameters.example.json");
  const digest = createHash("sha256").update(readFileSync(parameters)).digest("hex");
  /** Serve `body` for any https request with the registered media type. */
  const serving = (body) => async () => new Response(body, { status: 200, headers: { "content-type": "application/sustainability-data+json" } });
  const run = (origin, body, excerpt, ...more) => cli([origin, "--excerpt", excerpt, "--parameters", parameters, "--parameters-sha256", digest, "--trusted-key", write("tk.jwk", ed25519()), "--registrar-key", write("rk.jwk", ed25519()), "--at", NOW, "--json", ...more], { fetchOptions: { fetchImpl: serving(body) } });
  const operator = readFileSync(example("sfc-operator.example.json"), "utf8");
  const network = readFileSync(example("sfc-network.example.json"), "utf8");
  const results = (json, id) => json.rows.filter((r) => r.id === id).map((r) => r.result);

  it("an operator declaration fetched by URL does not pin the key for its own host: --network is required", async () => {
    const { code, err } = await run("node.op-a.example", operator, excerptOf("operator-month"));
    expect(code).toBe(2);
    expect(err).toContain("--network");
    expect(err).toContain("operator declaration");
  });

  it("with --network the operator declaration's read is authenticated and agrees with the ledger", async () => {
    const { code, json } = await run("node.op-a.example", operator, excerptOf("operator-month"), "--network", "ledger.example");
    expect(code).toBe(0);
    expect(results(json, "D2.entry").every((r) => r === "PASS")).toBe(true);
    expect(results(json, "D2.network")).toEqual(["PASS"]);
    expect(results(json, "C-SFC-7")).toEqual(["PASS"]);
  });

  it("a network declaration fetched by URL still pins the key for its host without --network", async () => {
    const { code, json } = await run("ledger.example", network, excerptOf("year-2025"));
    expect(code).toBe(0);
    expect(results(json, "D2.entry").every((r) => r === "PASS")).toBe(true);
    expect(json.record.registrarKeyPinned).toBe(true);
  });
});

describe("an unexpected error", () => {
  it("is a message and exit status 2, not a stack trace and not the 1 of a FAIL", async () => {
    const clock = () => { throw new Error("boom"); };
    const { code, err } = await cli([example("sfc-network.example.json")], { clock });
    expect(code).toBe(2);
    expect(err).toContain("unexpected error (set SFC_DEBUG=1 for the cause)");
    expect(err).not.toContain("boom");
    expect(err).not.toMatch(/\n\s+at /);
    expect(err).not.toContain(root);
  });

  it("prints the cause only when SFC_DEBUG is set", async () => {
    const clock = () => { throw new Error("boom"); };
    process.env.SFC_DEBUG = "1";
    try {
      const { code, err } = await cli([example("sfc-network.example.json")], { clock });
      expect(code).toBe(2);
      expect(err).toContain("unexpected error: boom");
    } finally { delete process.env.SFC_DEBUG; }
  });
});
