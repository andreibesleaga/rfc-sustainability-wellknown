import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const REPO_ROOT = resolve(process.cwd(), "..");

describe("conformance with the repository schema and examples", () => {
  it("embedded JTD schema is byte-identical to schemas-validators/response-schema.json", () => {
    const repoSchema = readJson(resolve(REPO_ROOT, "schemas-validators/response-schema.json"));
    // Deep-equal guards against drift between the spec repo and the publisher.
    expect(JSON.parse(JSON.stringify(RESPONSE_JTD_SCHEMA))).toEqual(repoSchema);
  });

  it("validates every published example-responses/*.json", () => {
    const dir = resolve(REPO_ROOT, "example-responses");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const doc = readJson(resolve(dir, f));
      const result = validateDocument(doc);
      expect(result.valid, `${f}: ${result.errors.join("; ")}`).toBe(true);
    }
  });
});
