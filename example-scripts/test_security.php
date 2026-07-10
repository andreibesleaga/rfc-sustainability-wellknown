<?php
/**
 * Tests for security.php (plain PHP asserts, zero dependencies).
 * Run: php test_security.php
 */

// security.php sends a header() at include time; harmless under CLI SAPI.
require __DIR__ . '/security.php';

function entry(string $period, float $energy = 10.0, float $carbon = 100.0, array $extra = []): array {
    return array_merge([
        'reporting-period' => $period,
        'energy-consumption' => $energy,
        'carbon-footprint' => $carbon,
    ], $extra);
}

$passed = 0;
$failed = 0;

function check(string $name, bool $ok): void {
    global $passed, $failed;
    if ($ok) {
        echo "ok - $name\n";
        $passed++;
    } else {
        echo "FAIL - $name\n";
        $failed++;
    }
}

$out = secureSustainabilityReport([entry('2026-03'), entry('2026-01'), entry('2026-02')]);
check('sorts ascending by reporting-period', array_column($out, 'reporting-period') === ['2026-01', '2026-02', '2026-03']);

$subdaily = entry('2026-01-01T12:00:00Z');
$daily = [entry('2026-01-01'), entry('2026-02-01')];
$out = secureSustainabilityReport(array_merge([$subdaily], $daily));
check('drops sub-daily entries before capping', count($out) === 2);

$data = [];
for ($i = 0; $i < 400; $i++) {
    $year = 2020 + intdiv($i, 365);
    $month = intdiv($i % 365, 30) + 1;
    $day = ($i % 28) + 1;
    $data[] = entry(sprintf('%04d-%02d-%02d', $year, $month, $day));
}
$out = secureSustainabilityReport($data);
check('caps at 366 keeping most recent', count($out) <= 366);

$data = [entry('2026-01'), entry('2026-02')];
check('deterministic across calls', secureSustainabilityReport($data) === secureSustainabilityReport($data));

$out = secureSustainabilityReport([entry('2026-01', 100.0, 1000.0)]);
check('noise bounded within ~1%', $out[0]['energy-consumption'] >= 99.0 && $out[0]['energy-consumption'] <= 101.0
    && $out[0]['carbon-footprint'] >= 990.0 && $out[0]['carbon-footprint'] <= 1010.0);

// -03: no "not reported" sentinel; scope values MAY legitimately be negative
// (removals / net accounting) and are noised like any other value —
// multiplication preserves the sign and the sums.
$out = secureSustainabilityReport([entry('2026-01', 100.0, 300.0, ['scope-1' => -50.0, 'scope-2' => 250.0, 'scope-3' => 100.0])]);
$fuzz = fuzzFactorFor('2026-01');
check('negative scope is noised and sign preserved',
    $fuzz !== 1.0 // guard: noise is observable for this period
    && $out[0]['scope-1'] === round(-50.0 * $fuzz, 2)
    && $out[0]['scope-1'] !== -50.0 // noise was applied
    && $out[0]['scope-1'] < 0 // sign preserved
    && abs(($out[0]['scope-1'] + $out[0]['scope-2'] + $out[0]['scope-3']) - $out[0]['carbon-footprint']) < 0.05);

$out = secureSustainabilityReport([entry('2026-01', 10.0, 300.0, ['scope-1' => 100.0, 'scope-2' => 100.0, 'scope-3' => 100.0])]);
$total = $out[0]['scope-1'] + $out[0]['scope-2'] + $out[0]['scope-3'];
check('single fuzz factor keeps scopes consistent', abs($total - $out[0]['carbon-footprint']) < 0.05);

check('fuzzFactorFor is a pure function of period', fuzzFactorFor('2026-01') === fuzzFactorFor('2026-01') && fuzzFactorFor('2026-01') !== fuzzFactorFor('2026-02'));

check('empty input', secureSustainabilityReport([]) === []);

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
