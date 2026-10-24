/**
 * The tool has no dependencies, so its token lists are written out in
 * tokens.mjs. These tests hold them to the publisher's token module, which the
 * draft's CDDL and both schemas are checked against in the publisher.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as tokens from "../tokens.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "..", "..", "publisher", "src", "tokens.ts"), "utf8");

/** The string members of `export const NAME = [...] as const` in tokens.ts. */
function listIn(name) {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`).exec(source);
  assert.ok(match, `${name} is not in publisher/src/tokens.ts`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("each list equals the publisher's, in the same order", () => {
  for (const name of ["MEASUREMENT_METHODS", "ENERGY_UNITS", "CARBON_UNITS", "CARBON_ACCOUNTING", "TARGET_TYPES"]) {
    assert.deepEqual(tokens[name], listIn(name), name);
  }
});

test("the sets have the sizes the draft gives", () => {
  assert.equal(tokens.MEASUREMENT_METHODS.length, 4);
  assert.equal(tokens.TARGET_TYPES.length, 9);
  assert.equal(tokens.CARBON_UNITS.length, 3);
  assert.equal(tokens.ENERGY_UNITS.length, 4);
  assert.equal(tokens.CARBON_ACCOUNTING.length, 2);
});

test("the methods the tool writes are three of the four, never hardware-metered", () => {
  assert.deepEqual(tokens.ALLOWED_METHODS, ["hardware-estimated", "cloud-billing", "third-party-modeled"]);
});

test("the earlier spelling of the metric tonne is the one the publisher reads as tCO2e", () => {
  assert.match(source, new RegExp(`unit === "${tokens.LEGACY_CARBON_UNIT}"`));
  assert.ok(!tokens.CARBON_UNITS.includes(tokens.LEGACY_CARBON_UNIT));
});
