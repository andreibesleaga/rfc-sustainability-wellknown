def _fuzz_factor_for(period):
    """Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).

    The draft requires noise to be applied once, at document-generation time,
    deterministically per reporting period, and consistently across
    arithmetically related fields — a single factor per report achieves this.
    """
    h = 5381
    for ch in period:
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    return 0.99 + (h % 1000) / 1000 * 0.02  # 0.99 – 1.01


def secure_sustainability_report(reports):
    # 1. Privacy: drop sub-daily entries BEFORE capping, so dropped entries
    #    do not consume cap slots (assuming 'reporting-period' ISO forms;
    #    anything longer than YYYY-MM-DD carries a timestamp).
    reports = [e for e in reports if len(e.get("reporting-period", "")) <= 10]

    # 2. Trend arrays MUST be sorted ascending by reporting-period.
    reports = sorted(reports, key=lambda e: e.get("reporting-period", ""))

    # 3. DoS Protection: cap at 366 objects (one leap year of daily data),
    #    keeping the MOST RECENT periods.
    MAX_OBJECTS = 366
    if len(reports) > MAX_OBJECTS:
        reports = reports[-MAX_OBJECTS:]

    secured_reports = []
    for entry in reports:
        # 4. Anti-Fingerprinting: ~1% fuzzing, deterministic per reporting period.
        fuzz = _fuzz_factor_for(entry.get("reporting-period", ""))

        # Clone and fuzz numeric values. An unreported metric is simply omitted
        # (-03 removed the negative "not reported" sentinel), so every numeric
        # value present is noised. scope-1/2/3 MAY legitimately be negative
        # (removals / net accounting); multiplicative noise preserves the sign
        # and the arithmetic relationships between related fields.
        secured = entry.copy()
        for key in [
            "energy-consumption",
            "carbon-footprint",
            "scope-1",
            "scope-2",
            "scope-3",
            "carbon-intensity-gCO2e-per-kWh",
            "estimated-annual-emissions-kgCO2e",
        ]:
            if key in secured and isinstance(secured[key], (int, float)):
                secured[key] = round(secured[key] * fuzz, 2)

        secured_reports.append(secured)

    return secured_reports
