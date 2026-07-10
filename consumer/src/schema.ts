/**
 * The JSON Type Definition (RFC 8927) schema for a single metrics object.
 *
 * This is an exact, embedded copy of `schemas-validators/response-schema.json`
 * from the repository root. `test/schema.test.ts` asserts this object stays
 * byte-for-byte equal to the repo schema and to `publisher/src/schema.ts`'s
 * own copy, so drift across all three is caught in CI.
 */
export const RESPONSE_JTD_SCHEMA = {
  properties: {
    version: { type: "string" },
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
  },
  additionalProperties: true,
} as const;
