/**
 * The JSON Type Definition (RFC 8927) schema for one declaration object.
 *
 * This is an exact, embedded copy of `schemas-validators/response-schema.json`
 * from the repository root. It is the single source of truth used by the
 * runtime validation gate. `test/conformance.test.ts` asserts this object stays
 * equal to the repo schema as a JSON value, so drift is caught in CI.
 *
 * Draft -07: the member set is CLOSED (no `additionalProperties`, no `version`),
 * and `upstream`, `extensions` and `signed` are OPTIONAL members. The range
 * rules, the absolute-URI form of the `extensions` keys, the at-least-one rule and the
 * array ordering rules are prose rules the schema cannot express; `validate.ts`
 * enforces them alongside it.
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
    "target-type": { enum: ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"] },
    upstream: {
      elements: {
        properties: { declaration: { type: "string" } },
        optionalProperties: { role: { type: "string" } },
      },
    },
    extensions: { values: { properties: {}, additionalProperties: true } },
    signed: { type: "string" },
  },
} as const;
