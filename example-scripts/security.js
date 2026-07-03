interface SustainabilityReport {
  "reporting-period": string;
  "energy-consumption": number;
  "carbon-footprint": number;
  [key: string]: any; // Allows for unknown fields
}

// Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).
// The draft requires noise to be applied once, at document-generation time,
// deterministically per reporting period, and consistently across
// arithmetically related fields — a single factor per report achieves this.
function fuzzFactorFor(period: string): number {
  let h = 5381;
  for (let i = 0; i < period.length; i++) h = ((h << 5) + h + period.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

function secureSustainabilityReport(reports: SustainabilityReport[]): SustainabilityReport[] {
  return reports
    // 1. Temporal Privacy: block granularity finer than 24 hours
    //    (filter BEFORE capping so dropped entries do not consume cap slots)
    .filter(report => (report["reporting-period"] ?? "").length <= 10)
    // 2. Trend arrays MUST be sorted ascending by reporting-period
    .sort((a, b) => String(a["reporting-period"]).localeCompare(String(b["reporting-period"])))
    // 3. DoS Protection: 366-object limit, keeping the MOST RECENT periods
    .slice(-366)
    .map(report => {
      // 4. Anti-Fingerprinting: ~1% noise, deterministic per reporting period
      const fuzz = fuzzFactorFor(String(report["reporting-period"] ?? ""));

      const secured = { ...report };
      const numericKeys = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3"];

      numericKeys.forEach(key => {
        // Negative = "not reported" sentinel; do not apply noise to it.
        if (typeof secured[key] === "number" && secured[key] >= 0) {
          secured[key] = parseFloat((secured[key] * fuzz).toFixed(2));
        }
      });

      return secured;
    });
}
