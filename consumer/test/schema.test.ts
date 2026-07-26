import { describe, expect, it } from "vitest";
import { RESPONSE_JTD_SCHEMA } from "../src/schema";
// resolveJsonModule is enabled in tsconfig.json, so this imports the JSON directly.
import repoSchema from "../../schemas-validators/response-schema.json";

describe("RESPONSE_JTD_SCHEMA byte-identity with schemas-validators/response-schema.json", () => {
  it("stringifies to exactly the same JSON as the repo-root schema file", () => {
    expect(JSON.stringify(RESPONSE_JTD_SCHEMA)).toBe(JSON.stringify(repoSchema));
  });

  it("deep-equals the repo-root schema file as an object", () => {
    expect(RESPONSE_JTD_SCHEMA).toEqual(repoSchema);
  });
});

describe("TARGET_TYPES stays in sync with the schema's target-type enum (-04)", () => {
  it("sentinel.ts's TARGET_TYPES equals the JTD enum exactly", async () => {
    const { TARGET_TYPES } = await import("../src/sentinel");
    expect([...TARGET_TYPES]).toEqual([...RESPONSE_JTD_SCHEMA.optionalProperties["target-type"].enum]);
  });
});
