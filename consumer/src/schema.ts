/**
 * The JSON Type Definition (RFC 8927) schema for a single declaration object
 * (draft -07, §Formal Definition (JTD)).
 *
 * This is an exact, embedded copy of `schemas-validators/response-schema.json`
 * from the repository root. `test/schema.test.ts` asserts this object stays
 * byte-for-byte equal to the repo schema, so drift between the two is caught
 * in CI.
 *
 * The base object is CLOSED in -07 (no `additionalProperties`): a publisher
 * MUST NOT add top-level members, and everything this document does not define
 * belongs under `extensions`. A consumer nevertheless MUST ignore a top-level
 * member it does not recognize, since a revision of the draft may define one —
 * so `validate.ts` reports an unrecognized member as the `unknown-member`
 * WARNING and validates the rest of the object rather than rejecting it.
 */
export const RESPONSE_JTD_SCHEMA = {
  properties: {
    updated: { type: "string" },
    capabilities: { enum: ["basic", "extended"] },
    provider: { type: "string" },
    "measurement-method": { type: "string" },
    "methodology-uri": { type: "string" },
    "reporting-period": { type: "string" },
    target: { type: "string" },
  },
  optionalProperties: {
    "energy-consumption": { type: "float64" },
    "energy-unit": { enum: ["Wh", "kWh", "MWh", "GWh"] },
    "carbon-footprint": { type: "float64" },
    "carbon-unit": { enum: ["gCO2e", "kgCO2e", "mtCO2e"] },
    "carbon-accounting": { enum: ["location-based", "market-based"] },
    "scope-1": { type: "float64" },
    "scope-2": { type: "float64" },
    "scope-3": { type: "float64" },
    "sci-score": { type: "float64" },
    "functional-unit": { type: "string" },
    "carbon-intensity-gCO2e-per-kWh": { type: "float64" },
    "estimated-annual-emissions-kgCO2e": { type: "float64" },
    "renewable-energy": { type: "float64" },
    "verifiable-attestation-uri": { type: "string" },
    "disclosure-uri": { type: "string" },
    "target-type": {
      enum: ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"],
    },
    upstream: {
      elements: {
        properties: { declaration: { type: "string" } },
        optionalProperties: { role: { type: "string" } },
      },
    },
    extensions: {
      values: { properties: {}, additionalProperties: true },
    },
    signed: { type: "string" },
  },
} as const;
