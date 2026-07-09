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
