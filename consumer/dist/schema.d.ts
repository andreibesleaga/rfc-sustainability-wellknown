/**
 * The JSON Type Definition (RFC 8927) schema for a single metrics object.
 *
 * This is an exact, embedded copy of `schemas-validators/response-schema.json`
 * from the repository root. `test/schema.test.ts` asserts this object stays
 * byte-for-byte equal to the repo schema and to `publisher/src/schema.ts`'s
 * own copy, so drift across all three is caught in CI.
 */
export declare const RESPONSE_JTD_SCHEMA: {
    readonly properties: {
        readonly version: {
            readonly type: "string";
        };
        readonly updated: {
            readonly type: "string";
        };
        readonly capabilities: {
            readonly enum: readonly ["basic", "extended"];
        };
        readonly provider: {
            readonly type: "string";
        };
        readonly "measurement-method": {
            readonly type: "string";
        };
        readonly "methodology-uri": {
            readonly type: "string";
        };
        readonly "reporting-period": {
            readonly type: "string";
        };
        readonly target: {
            readonly type: "string";
        };
    };
    readonly optionalProperties: {
        readonly "energy-consumption": {
            readonly type: "float64";
        };
        readonly "energy-unit": {
            readonly enum: readonly ["Wh", "kWh", "MWh", "GWh"];
        };
        readonly "carbon-footprint": {
            readonly type: "float64";
        };
        readonly "carbon-unit": {
            readonly enum: readonly ["gCO2e", "kgCO2e", "mtCO2e"];
        };
        readonly "carbon-accounting": {
            readonly enum: readonly ["location-based", "market-based"];
        };
        readonly "scope-1": {
            readonly type: "float64";
        };
        readonly "scope-2": {
            readonly type: "float64";
        };
        readonly "scope-3": {
            readonly type: "float64";
        };
        readonly "sci-score": {
            readonly type: "float64";
        };
        readonly "functional-unit": {
            readonly type: "string";
        };
        readonly "carbon-intensity-gCO2e-per-kWh": {
            readonly type: "float64";
        };
        readonly "estimated-annual-emissions-kgCO2e": {
            readonly type: "float64";
        };
        readonly "renewable-energy": {
            readonly type: "float64";
        };
        readonly "verifiable-attestation-uri": {
            readonly type: "string";
        };
        readonly "disclosure-uri": {
            readonly type: "string";
        };
    };
    readonly additionalProperties: true;
};
