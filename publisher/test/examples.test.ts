import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const DIR = resolve(process.cwd(), "examples", "transformed");

describe("examples/transformed", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

  it("holds one document per adapter", () => {
    expect(files).toHaveLength(9);
  });

  it.each(files)("%s passes the publisher's gate as it stands", (file) => {
    const result = validateDocument(readJson(resolve(DIR, file)), { legacyCompat: false });
    expect(result.valid, result.errors.join("; ")).toBe(true);
  });

  it("the Watershed quarter is the quarter, half-open", () => {
    expect(readJson(resolve(DIR, "watershed.json")).period).toEqual({ start: "2026-01-01T00:00:00Z", end: "2026-04-01T00:00:00Z" });
  });
});
