"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCsvRows = toCsvRows;
exports.toNdjson = toNdjson;
exports.flatten = flatten;
exports.aggregate = aggregate;
const sentinel_1 = require("./sentinel");
const units_1 = require("./units");
function asArray(doc) {
    return Array.isArray(doc) ? doc : [doc];
}
const CSV_COLUMNS = [
    "provider",
    "reporting-period",
    "target",
    "energy-consumption",
    "energy-unit",
    "carbon-footprint",
    "carbon-unit",
];
/** One CSV row per object (header row first), quoting values with commas. */
function toCsvRows(doc) {
    const q = (v) => {
        const s = v === undefined ? "" : String(v);
        // RFC 4180: quote any value containing a comma, a double quote, or a
        // line break (a raw newline would split the row; a raw quote mis-parses).
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [CSV_COLUMNS.join(",")];
    for (const m of asArray(doc)) {
        rows.push(CSV_COLUMNS.map((c) => q(m[c])).join(","));
    }
    return rows;
}
/** Newline-delimited JSON, one object per line. */
function toNdjson(doc) {
    return asArray(doc)
        .map((m) => JSON.stringify(m))
        .join("\n");
}
/** The non-negative members, as a plain string list for membership checks. */
const NON_NEGATIVE = sentinel_1.NUMERIC_KEYS;
/**
 * One row per numeric metric (incl. scopes), for time-series ingestion.
 *
 * Negative values are skipped only for the NON-NEGATIVE members (sentinel.ts's
 * legacy-compatibility rule: they read as "not reported"); a negative scope
 * value is real data (net accounting) and flows through. Absent unit members
 * fall back to the draft's defaults (kWh / gCO2e).
 */
function flatten(doc) {
    const rows = [];
    // [metric, unit-member ?? "", default/literal unit label]
    const numeric = [
        ["energy-consumption", "energy-unit", "kWh"],
        ["carbon-footprint", "carbon-unit", "gCO2e"],
        ["scope-1", "carbon-unit", "gCO2e"],
        ["scope-2", "carbon-unit", "gCO2e"],
        ["scope-3", "carbon-unit", "gCO2e"],
        ["sci-score", "", ""],
        ["carbon-intensity-gCO2e-per-kWh", "", "gCO2e/kWh"],
        ["estimated-annual-emissions-kgCO2e", "", "kgCO2e"],
        ["renewable-energy", "", "%"],
    ];
    for (const m of asArray(doc)) {
        for (const [metric, unitField, defaultUnit] of numeric) {
            const value = m[metric];
            if (typeof value !== "number")
                continue; // absent
            // Out-of-range in a bounded member = "not reported" (legacy compat /
            // draft §Value Constraints): negatives in the non-negative members, and
            // a renewable-energy percentage above 100.
            if (NON_NEGATIVE.includes(metric) && (0, sentinel_1.isNotReported)(value, metric))
                continue;
            // sci-score is expressed in gCO2e per the declared functional-unit
            // (draft §Optional Response Fields) — label it truthfully rather than
            // emitting an empty unit into time-series backends.
            const unit = metric === "sci-score"
                ? `gCO2e/${m["functional-unit"] ?? "functional-unit"}`
                : unitField && m[unitField] !== undefined
                    ? String(m[unitField])
                    : defaultUnit;
            rows.push({
                provider: m.provider,
                "reporting-period": m["reporting-period"],
                target: m.target,
                metric,
                value,
                unit,
            });
        }
    }
    return rows;
}
/**
 * Combine a trend array into one summary object. Refuses to silently mix
 * units — everything is normalized to the requested (or the first reporting
 * entry's) unit before combining. Entries not reporting a metric (member
 * absent, or negative under the legacy-compatibility rule) simply don't
 * contribute; an absent unit member means the draft's default (kWh / gCO2e).
 * When no entry reports a metric at all, the summary omits it.
 */
function aggregate(entries, opts) {
    if (entries.length === 0)
        throw new Error("aggregate: empty input");
    const reported = (key) => entries.filter((e) => typeof e[key] === "number" && e[key] >= 0);
    const energyEntries = reported("energy-consumption");
    const carbonEntries = reported("carbon-footprint");
    // Output units: requested, else the first reporting entry's declared unit,
    // else the draft default (which also applies per-entry when the unit member
    // is absent alongside a present value).
    const energyUnit = opts.energyUnit ?? energyEntries[0]?.["energy-unit"] ?? "kWh";
    const carbonUnit = opts.carbonUnit ?? carbonEntries[0]?.["carbon-unit"] ?? "gCO2e";
    const energies = energyEntries.map((e) => (0, units_1.convertEnergy)(e["energy-consumption"], e["energy-unit"] ?? "kWh", energyUnit));
    const carbons = carbonEntries.map((e) => (0, units_1.convertCarbon)(e["carbon-footprint"], e["carbon-unit"] ?? "gCO2e", carbonUnit));
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const combine = (xs) => (opts.by === "sum" ? sum(xs) : sum(xs) / xs.length);
    const first = entries[0];
    const last = entries[entries.length - 1];
    // Whitelist-copy ONLY the invariant metadata (uniform across a valid trend
    // array). Per-entry metrics cannot be meaningfully aggregated and must not
    // leak from the first entry into the summary: scopes are expressed in that
    // entry's carbon-unit (relabeling them under the summary's output unit would
    // silently misstate them by the conversion factor); sci-score / renewable /
    // intensity / annual-estimate are per-period figures; and unknown VENDOR
    // members have unknown aggregability, so they are excluded too (a spread
    // would carry them over verbatim).
    const out = {
        version: first.version,
        updated: last.updated, // the summary is as fresh as its newest entry
        capabilities: first.capabilities,
        provider: first.provider,
        "measurement-method": first["measurement-method"],
        "methodology-uri": first["methodology-uri"],
        "reporting-period": `${first["reporting-period"]}..${last["reporting-period"]}`,
        target: first.target,
    };
    if (first["carbon-accounting"] !== undefined) {
        out["carbon-accounting"] = first["carbon-accounting"];
    }
    if (energies.length > 0) {
        out["energy-consumption"] = Math.round(combine(energies) * 100) / 100;
        out["energy-unit"] = energyUnit;
    }
    if (carbons.length > 0) {
        out["carbon-footprint"] = Math.round(combine(carbons) * 100) / 100;
        out["carbon-unit"] = carbonUnit;
    }
    return out;
}
