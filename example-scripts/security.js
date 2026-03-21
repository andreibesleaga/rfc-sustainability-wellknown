interface SustainabilityReport {
  "reporting-period": string;
  "energy-consumption": number;
  "carbon-footprint": number;
  [key: string]: any; // Allows for unknown fields
}

function secureSustainabilityReport(reports: SustainabilityReport[]): SustainabilityReport[] {
  // 1. DoS Protection: 366 object limit
  const cappedReports = reports.slice(0, 366);

  return cappedReports
    // 2. Temporal Privacy: Block granularity finer than 24 hours
    .filter(report => (report["reporting-period"] ?? "").length <= 10)
    .map(report => {
    // 3. Anti-Fingerprinting: ~1% Noise
    const fuzz = 0.99 + (Math.random() * 0.02);
    
    const secured = { ...report };
    const numericKeys = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3"];

    numericKeys.forEach(key => {
      if (typeof secured[key] === "number") {
        secured[key] = parseFloat((secured[key] * fuzz).toFixed(2));
      }
    });

    return secured;
  });
}
