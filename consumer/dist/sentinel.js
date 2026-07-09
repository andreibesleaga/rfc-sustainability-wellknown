"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNotReported = isNotReported;
exports.withoutSentinels = withoutSentinels;
const NUMERIC_KEYS = [
    "energy-consumption",
    "carbon-footprint",
    "scope-1",
    "scope-2",
    "scope-3",
    "sci-score",
    "carbon-intensity-gCO2-per-kWh",
    "estimated-annual-emissions-kgCO2",
    "renewable-energy",
];
function isNotReported(value) {
    return typeof value === "number" && value < 0;
}
/** Returns a copy with every "not reported" sentinel field removed (present only). */
function withoutSentinels(doc) {
    const out = { ...doc };
    for (const key of NUMERIC_KEYS) {
        if (isNotReported(out[key]))
            delete out[key];
    }
    return out;
}
