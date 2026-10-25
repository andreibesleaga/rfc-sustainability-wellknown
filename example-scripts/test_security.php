<?php
/**
 * Tests for security.php (plain PHP checks, zero dependencies).
 * Run: php test_security.php
 */

// security.php sends a header() at include time; harmless under CLI SAPI.
require __DIR__ . '/security.php';

function day(string $start, string $end, string $target = 'example.com', array $extra = []): array {
    return array_merge([
        'period' => ['start' => "{$start}T00:00:00Z", 'end' => "{$end}T00:00:00Z"],
        'target' => $target,
        'energy-consumption' => 100,
        'carbon-footprint' => 300,
    ], $extra);
}

function sixHours(): array {
    $object = day('2026-01-01', '2026-01-02');
    $object['period']['end'] = '2026-01-01T06:00:00Z';
    return $object;
}

function starts(array $objects): array {
    return array_map(fn ($o) => $o['period']['start'], $objects);
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

function throws(callable $fn): bool {
    try {
        $fn();
    } catch (InvalidArgumentException $e) {
        return true;
    }
    return false;
}

$plusFive = day('2026-03-01', '2026-03-02');
$plusFive['period'] = ['start' => '2026-03-01T00:00:00+05:00', 'end' => '2026-03-02T00:00:00+05:00'];
$out = secureSustainabilityReport([day('2026-03-01', '2026-03-02'), $plusFive, day('2026-02-01', '2026-02-02')]);
check('sorts by the instant of period.start, whatever the offsets',
    starts($out) === ['2026-02-01T00:00:00Z', '2026-03-01T00:00:00+05:00', '2026-03-01T00:00:00Z']);

$out = secureSustainabilityReport([
    day('2026-01-01', '2026-02-01', '/b'),
    day('2026-01-01', '2026-01-02', '/z'),
    day('2026-01-01', '2026-02-01', '/a'),
]);
check('ties on start go by end, then by target',
    array_map(fn ($o) => $o['target'] . '|' . $o['period']['end'], $out)
    === ['/z|2026-01-02T00:00:00Z', '/a|2026-02-01T00:00:00Z', '/b|2026-02-01T00:00:00Z']);

$warnings = [];
$out = secureSustainabilityReport([sixHours(), day('2026-01-02', '2026-01-03')], ['onWarning' => function ($m) use (&$warnings) { $warnings[] = $m; }]);
check('day floor drops by default, with a warning', starts($out) === ['2026-01-02T00:00:00Z'] && count($warnings) === 1);

$warnings = [];
$collect = function ($m) use (&$warnings) { $warnings[] = $m; };
$kept = count(secureSustainabilityReport([sixHours()], ['dayFloor' => 'warn', 'onWarning' => $collect]));
$afterWarn = count($warnings);
$silent = count(secureSustainabilityReport([sixHours()], ['dayFloor' => 'off', 'onWarning' => $collect]));
check('day floor warn keeps and off keeps silently', $kept === 1 && $afterWarn === 1 && $silent === 1 && count($warnings) === 1);

check('a 23-hour day of a daylight-saving change is a calendar day',
    isOnDayBoundaries(['start' => '2026-03-29T00:00:00+01:00', 'end' => '2026-03-30T00:00:00+02:00'])
    && !isOnDayBoundaries(['start' => '2026-03-29T01:00:00+01:00', 'end' => '2026-03-30T01:00:00+02:00']));

$data = [];
$first = new DateTimeImmutable('2025-01-01', new DateTimeZone('UTC'));
for ($i = 0; $i < 400; $i++) {
    $data[] = day($first->modify("+$i day")->format('Y-m-d'), $first->modify('+' . ($i + 1) . ' day')->format('Y-m-d'));
}
check('refuses more than 366 held objects, counted after the day floor',
    throws(fn () => secureSustainabilityReport(array_merge([sixHours()], $data))));
check('366 held objects are accepted',
    count(secureSustainabilityReport(array_merge([sixHours()], array_slice($data, 0, 366)))) === 366);

$out = secureSustainabilityReport([day('2026-01-01', '2026-01-02')]);
check('values are exact unless noise is turned on', $out[0]['energy-consumption'] === 100);

check('noise needs the operator\'s confirmation that it is disclosed',
    throws(fn () => secureSustainabilityReport([], ['applyNoise' => true])));

$object = day('2026-01-01', '2026-02-01', 'example.com', [
    'scope-1' => -50, 'scope-2' => 250, 'scope-3' => 100,
    'estimated-annual-emissions-kgCO2e' => 3650, 'sci-score' => 2,
    'carbon-intensity-gCO2e-per-kWh' => 270, 'renewable-energy' => 100,
]);
$out = secureSustainabilityReport([$object], ['applyNoise' => true, 'noiseDisclosed' => true])[0];
$fuzz = fuzzFactorFor(canonicalKey($object['period']));
$moved = true;
foreach (NOISE_MEMBERS as $member) {
    $moved = $moved && $out[$member] === (float)sprintf('%.5e', $object[$member] * $fuzz);
}
check('one factor within 1% moves every perturbed member, ratios and percentages stay',
    $fuzz >= 0.99 && $fuzz <= 1.01 && $moved && $out['scope-1'] < 0
    && $out['carbon-intensity-gCO2e-per-kWh'] === 270 && $out['renewable-energy'] === 100);

$key = '2026-01-01T00:00:00Z/2026-02-01T00:00:00Z';
check('the factor depends on the instants of the period, not on its spelling',
    canonicalKey(['start' => '2026-01-01T00:00:00Z', 'end' => '2026-02-01T00:00:00Z']) === $key
    && canonicalKey(['start' => '2026-01-01T00:00:00.000Z', 'end' => '2026-02-01T00:00:00Z']) === $key
    && canonicalKey(['start' => '2026-01-01T01:00:00+01:00', 'end' => '2026-02-01T01:00:00+01:00']) === $key
    && fuzzFactorFor($key) === 1.00418); // the same value in the JavaScript and Python kits

$allBad = true;
foreach (['2026-01-01', '2026-01-01t00:00:00z', '2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z'] as $bad) {
    $allBad = $allBad && throws(fn () => canonicalKey(['start' => $bad, 'end' => '2026-02-01T00:00:00Z']));
}
check('a bound that is not a date-time of the draft is an error', $allBad);

check('query values that do not match the draft are ignored, never an error',
    honoredQuery('start=2025-03-01&end=2025-04-01t00:00:00z&granularity=Monthly&target=') === []
    && honoredQuery('start=2025-03-01T00:00:00%2B01:00&end=2025-02-30T00:00:00Z') === []
    && honoredQuery('start=2016-12-31T23:59:60Z') === [] // second 60 would be read as 59
    && honoredQuery('granularity=monthly&granularity=daily&period=2025') === [] // repeated, and the name of the previous revision
    && honoredQuery('start=2025-03-01T00%3A00%3A00Z') === ['start' => '2025-03-01T00:00:00Z']);

// A dataset of queries.json is the served file of that name; basic is example-response.json.
function servedObjects(string $dataset): array {
    $name = str_replace('.example', '', $dataset);
    $dir = __DIR__ . '/../example-responses/';
    $file = $name === 'basic' ? 'example-response.json' : (file_exists($dir . "example-response-$name.json") ? "example-response-$name.json" : "example-response_$name.json");
    $body = json_decode(file_get_contents($dir . $file), true);
    return array_is_list($body) ? $body : [$body];
}

$rows = json_decode(file_get_contents(__DIR__ . '/../schemas-validators/examples/queries.json'), true);
$wrong = [];
foreach ($rows as $row) {
    $got = array_map(fn ($o) => $o['target'] . '|' . $o['period']['start'], answerQuery(servedObjects($row['dataset']), $row['query']));
    if ($got !== $row['expect']) {
        $wrong[] = $row['id'];
    }
}
check('every row of queries.json selects what the oracle says, in its order (' . implode(',', $wrong) . ')', count($rows) === 75 && $wrong === []);

check('empty input', secureSustainabilityReport([]) === []);

echo "\n$passed passed, $failed failed\n";
exit($failed > 0 ? 1 : 0);
