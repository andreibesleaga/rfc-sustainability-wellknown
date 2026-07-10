<?php

/**
 * Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).
 * The draft requires noise to be applied once, at document-generation time,
 * deterministically per reporting period, and consistently across
 * arithmetically related fields — a single factor per report achieves this.
 */
function fuzzFactorFor(string $period): float {
    $h = 5381;
    for ($i = 0; $i < strlen($period); $i++) {
        $h = (($h << 5) + $h + ord($period[$i])) & 0xFFFFFFFF;
    }
    return 0.99 + (($h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

function secureSustainabilityReport(array $reports): array {
    // 1. Temporal Privacy: block granularity finer than 24 hours
    //    (filter BEFORE capping so dropped entries do not consume cap slots)
    $reports = array_values(array_filter($reports, function ($entry) {
        return !isset($entry['reporting-period']) || strlen($entry['reporting-period']) <= 10;
    }));

    // 2. Trend arrays MUST be sorted ascending by reporting-period
    usort($reports, function ($a, $b) {
        return strcmp($a['reporting-period'] ?? '', $b['reporting-period'] ?? '');
    });

    // 3. DoS Protection: 366-object cap, keeping the MOST RECENT periods
    if (count($reports) > 366) {
        $reports = array_slice($reports, -366);
    }

    $securedReports = [];
    foreach ($reports as $entry) {
        // 4. Anti-Fingerprinting: ~1% noise, deterministic per reporting period
        $fuzz = fuzzFactorFor($entry['reporting-period'] ?? '');

        // An unreported metric is simply omitted (-03 removed the negative
        // "not reported" sentinel), so every value in the list below is
        // noised. The list deliberately covers only the additive family
        // (energy, footprint, scopes) — derived/annualized members
        // (intensity, annual estimate) stay un-noised so cross-member
        // arithmetic survives (footprint = energy x intensity; scopes sum to
        // footprint), per the draft's "consistent across arithmetically
        // related fields" rule. scope-1/2/3 MAY legitimately be negative
        // (removals / net accounting); multiplication preserves sign.
        $numericKeys = [
            'energy-consumption',
            'carbon-footprint',
            'scope-1',
            'scope-2',
            'scope-3',
        ];
        foreach ($numericKeys as $key) {
            if (isset($entry[$key]) && is_numeric($entry[$key])) {
                $entry[$key] = round($entry[$key] * $fuzz, 2);
            }
        }
        $securedReports[] = $entry;
    }

    return $securedReports;
}

// Set mandatory header
header('Content-Type: application/json');
// echo json_encode(secureSustainabilityReport($yourRawData));
?>
