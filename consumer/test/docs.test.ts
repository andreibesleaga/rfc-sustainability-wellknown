/** USAGE.md names every conformance check and every signature failure reason, and nothing it has dropped. */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, file), "utf8");
const usage = read("../USAGE.md");

describe("USAGE.md", () => {
  it("lists every conformance check by its name", () => {
    const source = read("../src/conformance.ts");
    const names = [...source.matchAll(/await check\(\s*[`"]([^`"]+)[`"]/g)].map((m) => m[1].replace("${MEDIA_TYPE}", "application/sustainability-data+json"));
    expect(names.length).toBe(12);
    for (const name of names) expect(usage, name).toContain(name.split(" (")[0]);
  });

  it("lists exactly the reasons a signature can be unverified", () => {
    const jws = read("../src/jws.ts");
    const union = jws.slice(jws.indexOf("export type VerifyReason"), jws.indexOf("export interface VerifyResult"));
    const reasons = [...union.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    reasons.push("payload-not-declaration", "payload-subject-mismatch");
    const row = usage.split("\n").find((line) => line.startsWith("| `{ status: \"unverified\", reason }` |")) ?? "";
    const listed = [...row.split("`reason`:")[1].matchAll(/`([a-z]+(?:-[a-z]+)*)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...reasons].sort());
  });
});
