/**
 * @typedef {Object} SustainabilityReport
 * @property {string} "reporting-period"
 * @property {number} "energy-consumption"
 * @property {number} "carbon-footprint"
 */

/**
 * Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).
 * The draft requires noise to be applied once, at document-generation time,
 * deterministically per reporting period, and consistently across
 * arithmetically related fields — a single factor per report achieves this.
 * @param {string} period
 * @returns {number}
 */
function fuzzFactorFor(period) {
  let h = 5381;
  for (let i = 0; i < period.length; i++) h = ((h << 5) + h + period.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

/**
 * @param {SustainabilityReport[]} reports
 * @returns {SustainabilityReport[]}
 */
function secureSustainabilityReport(reports) {
  return reports
    // 1. Temporal Privacy: block granularity finer than 24 hours
    //    (filter BEFORE capping so dropped entries do not consume cap slots)
    .filter((report) => (report["reporting-period"] ?? "").length <= 10)
    // 2. Trend arrays MUST be sorted ascending by reporting-period
    .sort((a, b) => String(a["reporting-period"]).localeCompare(String(b["reporting-period"])))
    // 3. DoS Protection: 366-object limit, keeping the MOST RECENT periods
    .slice(-366)
    .map((report) => {
      // 4. Anti-Fingerprinting: ~1% noise, deterministic per reporting period
      const fuzz = fuzzFactorFor(String(report["reporting-period"] ?? ""));

      // An unreported metric is simply omitted (-03 removed the negative
      // "not reported" sentinel), so every numeric value present is noised.
      // scope-1/2/3 MAY legitimately be negative (removals / net accounting);
      // multiplicative noise preserves the sign and the arithmetic
      // relationships between related fields.
      const secured = { ...report };
      const numericKeys = [
        "energy-consumption",
        "carbon-footprint",
        "scope-1",
        "scope-2",
        "scope-3",
        "carbon-intensity-gCO2e-per-kWh",
        "estimated-annual-emissions-kgCO2e",
      ];

      numericKeys.forEach((key) => {
        if (typeof secured[key] === "number") {
          secured[key] = parseFloat((secured[key] * fuzz).toFixed(2));
        }
      });

      return secured;
    });
}

module.exports = { secureSustainabilityReport, fuzzFactorFor };
