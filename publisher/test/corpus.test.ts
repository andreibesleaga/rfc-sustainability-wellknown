import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv/dist/jtd";
import { describe, expect, it } from "vitest";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";
import { assertValid, validateDocument } from "../src/validate";

const CORPUS = resolve(process.cwd(), "..", "schemas-validators", "examples");

interface Entry {
  id: string;
  path: string;
  ajv: boolean;
  strict: "ok" | "reject";
  warn: string[];
}

const manifest: Entry[] = JSON.parse(readFileSync(resolve(CORPUS, "manifest.json"), "utf8"));
const load = (entry: Entry): any => JSON.parse(readFileSync(resolve(CORPUS, entry.path), "utf8"));

const schemaOnly = new Ajv({ allErrors: true }).compile(RESPONSE_JTD_SCHEMA as unknown as object);
const schemaAccepts = (doc: unknown): boolean => (Array.isArray(doc) ? doc : [doc]).every((item) => schemaOnly(item));

// The schema's rule that an extension value is an object is stricter than the manifest records for this file.
const SCHEMA_STRICTER_THAN_MANIFEST = new Set(["I35"]);
// Codes the signature check reports for a signed file; validation itself never emits them.
const SIGNATURE_WARNINGS = new Set(["deprecated-alg", "modified-after-signing"]);

const codes = (warnings: { code: string }[]): string[] => [...new Set(warnings.map((w) => w.code))].sort();

describe("the example corpus, read as -10", () => {
  it("lists the files of the corpus", () => {
    expect(manifest.length).toBeGreaterThan(100);
  });

  for (const entry of manifest) {
    it(`${entry.id} ${entry.path}: ${entry.strict}${entry.warn.length ? ` with ${entry.warn.join(", ")}` : ""}`, () => {
      const doc = load(entry);
      const result = validateDocument(doc, { legacyCompat: false });
      expect(result.valid, result.errors.join("; ")).toBe(entry.strict === "ok");
      expect(codes(result.warnings)).toEqual(entry.warn.filter((c) => !SIGNATURE_WARNINGS.has(c)).sort());
      if (!SCHEMA_STRICTER_THAN_MANIFEST.has(entry.id)) expect(schemaAccepts(doc), "the JTD schema alone").toBe(entry.ajv);
    });
  }

  it("the publisher gate refuses what the strict verdict rejects and what a publisher must not write, and passes the rest that defines its members", () => {
    for (const entry of manifest) {
      const doc = load(entry);
      const gate = () => assertValid(doc);
      // The consumer reads an unknown member and a URI member that is no reference with a warning; the publisher refuses both.
      if (entry.strict === "reject" || entry.warn.includes("unknown-member") || entry.warn.includes("uri-not-a-reference")) expect(gate, entry.id).toThrow();
      else expect(gate, entry.id).not.toThrow();
    }
  });
});
