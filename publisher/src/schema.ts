/**
 * The JSON Type Definition (RFC 8927) schema for one declaration object.
 *
 * This is an exact, embedded copy of `schemas-validators/response-schema.json`
 * from the repository root. It is the schema of the runtime validation gate;
 * `test/conformance.test.ts` asserts that it stays identical to the repository
 * file, so drift is caught in CI.
 *
 * The schema checks form: the seven mandatory members, the closed token sets,
 * the types of the optional members, and the `timestamp` type for `updated`,
 * `period.start` and `period.end`. Members the draft does not define are
 * accepted at the top level, in `period` and in an `upstream` entry, as the
 * draft's CDDL accepts them. The rules no schema states (upper-case `T` and `Z`
 * in a timestamp, `start` before `end`, ranges, the at-least-one rule, the names
 * in `extensions`) belong to `validate.ts`, which applies them after the schema.
 */
export const RESPONSE_JTD_SCHEMA = {
  properties: {
    updated: { type: "timestamp" },
    capabilities: {
      enum: ["basic", "extended"],
    },
    provider: { type: "string" },
    "measurement-method": {
      enum: ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"],
    },
    "methodology-uri": { type: "string" },
    period: {
      properties: {
        start: { type: "timestamp" },
        end: { type: "timestamp" },
      },
      additionalProperties: true,
    },
    target: { type: "string" },
  },
  optionalProperties: {
    "energy-consumption": { type: "float64" },
    "energy-unit": {
      enum: ["Wh", "kWh", "MWh", "GWh"],
    },
    "carbon-footprint": { type: "float64" },
    "carbon-unit": {
      enum: ["gCO2e", "kgCO2e", "tCO2e"],
    },
    "carbon-accounting": {
      enum: ["location-based", "market-based"],
    },
    "scope-1": { type: "float64" },
    "scope-2": { type: "float64" },
    "scope-3": { type: "float64" },
    "sci-score": { type: "float64" },
    "functional-unit": {
      enum: [
        "per-request",
        "per-transaction",
        "per-page-view",
        "per-session",
        "per-user",
        "per-job",
        "per-token",
        "per-inference",
        "per-gigabyte",
        "per-gigabyte-hour",
        "per-vcpu-hour",
        "per-device",
      ],
    },
    "carbon-intensity-gCO2e-per-kWh": { type: "float64" },
    "estimated-annual-emissions-kgCO2e": { type: "float64" },
    "renewable-energy": { type: "float64" },
    "target-type": {
      enum: ["origin", "path", "organization", "facility", "service", "product", "device", "tenant", "data-source"],
    },
    "verifiable-attestation-uri": { type: "string" },
    "disclosure-uri": { type: "string" },
    upstream: {
      elements: {
        properties: {
          declaration: { type: "string" },
        },
        optionalProperties: {
          role: {
            enum: ["hosting", "colocation", "cloud", "cdn", "network", "electricity"],
          },
        },
        additionalProperties: true,
      },
    },
    extensions: {
      values: {
        values: {},
      },
    },
    signed: { type: "string" },
  },
  additionalProperties: true,
} as const;
