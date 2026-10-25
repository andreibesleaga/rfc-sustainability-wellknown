<?php

/**
 * The three safeguards of the draft's Security and Privacy Considerations, as a
 * zero-dependency kit (the same behavior as the publisher's `secureReports`):
 *
 *  1. DoS protection      - refuse a held set above 366 objects; an answer is never truncated.
 *  2. Traffic analysis    - keep to periods of a calendar day or longer: by default an
 *                           object whose bounds are not the first instant of a calendar
 *                           day in their own offset is dropped with a warning.
 *  3. Anti-fingerprinting - OFF BY DEFAULT. With 'applyNoise' and 'noiseDisclosed', one
 *                           factor within 0.99 to 1.01 multiplies the perturbed members.
 *
 * A publisher that applies noise MUST state so, and bound its size, in its
 * methodology document; 'noiseDisclosed' => true is the operator's confirmation
 * that it did. Nothing here can check it.
 *
 * A date-time is an RFC 3339 date-time with upper-case T and Z. A period is the
 * half-open range from period.start to period.end; arrays are ordered by the
 * instant of start, then of end, then by target.
 */

// The members the one factor applies to: the additive quantities and those derived
// from them, so that no unperturbed member discloses a perturbed one. Ratios and
// percentages stay as they are.
const NOISE_MEMBERS = [
    'energy-consumption',
    'carbon-footprint',
    'scope-1',
    'scope-2',
    'scope-3',
    'estimated-annual-emissions-kgCO2e',
    'sci-score',
];

/**
 * Read an RFC 3339 date-time: the instant as whole seconds and nine digits of
 * fraction, and whether it is midnight in the offset it is written in. Second 60
 * is read as 59. Throws InvalidArgumentException for anything else.
 */
function parseDateTime($value): array {
    $pattern = '/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/';
    if (!is_string($value) || !preg_match($pattern, $value, $m)) {
        throw new InvalidArgumentException('not an RFC 3339 date-time with upper-case T and Z: ' . json_encode($value));
    }
    [$year, $month, $day, $hour, $minute, $second] = array_map('intval', array_slice($m, 1, 6));
    $offsetHour = (int)($m[9] ?? 0);
    $offsetMinute = (int)($m[10] ?? 0);
    if (!checkdate($month, $day, $year) || $hour > 23 || $minute > 59 || $second > 60 || $offsetHour > 23 || $offsetMinute > 59) {
        throw new InvalidArgumentException('not a real date and time: ' . $value);
    }
    $sign = ($m[8] ?? '+') === '-' ? -1 : 1;
    $fraction = substr(str_pad($m[7] ?? '', 9, '0'), 0, 9);
    return [
        'seconds' => gmmktime($hour, $minute, min($second, 59), $month, $day, $year) - $sign * ($offsetHour * 60 + $offsetMinute) * 60,
        'fraction' => $fraction,
        'date' => [$year, $month, $day], // the calendar date in the offset the value is written in
        'midnight' => $hour === 0 && $minute === 0 && $second === 0 && trim($fraction, '0') === '',
    ];
}

/** The instant in UTC with Z, a fraction only when it is not zero. */
function utcForm(array $instant): string {
    $digits = rtrim($instant['fraction'], '0');
    return gmdate('Y-m-d\TH:i:s', $instant['seconds']) . ($digits === '' ? '' : '.' . $digits) . 'Z';
}

/** A key for the period that is the same however its bounds are spelled: Z, +00:00 and .000Z agree. */
function canonicalKey(array $period): string {
    return utcForm(parseDateTime($period['start'])) . '/' . utcForm(parseDateTime($period['end']));
}

/**
 * Whether both bounds are the first instant of a calendar day in their own
 * offset. The 23-hour and 25-hour days of a daylight-saving change qualify.
 */
function isOnDayBoundaries(array $period): bool {
    return parseDateTime($period['start'])['midnight'] && parseDateTime($period['end'])['midnight'];
}

/**
 * The order of an array: the instant of period.start, then of period.end, then
 * target in code point order (strcmp on UTF-8 bytes orders by code point).
 */
function compareObjects(array $a, array $b): int {
    foreach (['start', 'end'] as $bound) {
        $left = parseDateTime($a['period'][$bound]);
        $right = parseDateTime($b['period'][$bound]);
        $order = [$left['seconds'], $left['fraction']] <=> [$right['seconds'], $right['fraction']];
        if ($order !== 0) {
            return $order;
        }
    }
    return strcmp($a['target'], $b['target']);
}

/**
 * Deterministic factor from 0.99 to 1.01 (djb2 hash) of a period's canonical key.
 * Noise is applied once, when the object is generated, so the same period always
 * gives the same published values.
 */
function fuzzFactorFor(string $key): float {
    $h = 5381;
    for ($i = 0; $i < strlen($key); $i++) {
        $h = (($h << 5) + $h + ord($key[$i])) & 0xFFFFFFFF;
    }
    return 0.99 + (($h % 1000) / 1000) * 0.02;
}

/**
 * Whether the period is a whole calendar day, month or year ('daily', 'monthly',
 * 'yearly'): each bound is midnight in its own offset, the end is the next day,
 * month or year of the start. Several whole months are not a whole month.
 */
function isWholeCalendarPeriod(array $period, string $unit): bool {
    $start = parseDateTime($period['start']);
    $end = parseDateTime($period['end']);
    if (!$start['midnight'] || !$end['midnight']) {
        return false;
    }
    [$y1, $m1, $d1] = $start['date'];
    [$y2, $m2, $d2] = $end['date'];
    if ($unit === 'yearly') {
        return [$m1, $d1, $m2, $d2] === [1, 1, 1, 1] && $y2 === $y1 + 1;
    }
    if ($unit === 'monthly') {
        return $d1 === 1 && $d2 === 1 && ($y2 - $y1) * 12 + $m2 - $m1 === 1;
    }
    return (gmmktime(0, 0, 0, $m2, $d2, $y2) - gmmktime(0, 0, 0, $m1, $d1, $y1)) === 86400;
}

// Whether a value is a utc-date-time that names a real moment; second 60 would be read as 59, so it does not count.
function isUtcDateTime(string $value): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/', $value) || substr($value, 17, 2) === '60') {
        return false;
    }
    try {
        parseDateTime($value);
        return true;
    } catch (InvalidArgumentException $e) {
        return false;
    }
}

function isValidQueryValue(string $name, string $value): bool {
    switch ($name) {
        case 'target':
            return $value !== '';
        case 'start':
        case 'end':
            return isUtcDateTime($value);
        default:
            return in_array($value, ['yearly', 'monthly', 'daily'], true);
    }
}

/**
 * The parameters of a query string that a server honors. Names and values are
 * percent-decoded ('+' as a space) and compared case-sensitively. A value that
 * does not match the draft's rule, and a name that appears more than once, are
 * ignored: never an error, never read as another value.
 */
function honoredQuery(string $rawQuery): array {
    $seen = [];
    foreach (explode('&', $rawQuery) as $part) {
        [$name, $value] = array_pad(explode('=', $part, 2), 2, '');
        $name = urldecode($name);
        if (in_array($name, ['target', 'start', 'end', 'granularity'], true)) {
            $seen[$name][] = urldecode($value);
        }
    }
    $honored = [];
    foreach ($seen as $name => $values) {
        if (count($values) === 1 && isValidQueryValue($name, $values[0])) {
            $honored[$name] = $values[0];
        }
    }
    return $honored;
}

// A host name compares without regard to ASCII case (RFC 3986, Section 3.2.2); no other folding.
function targetEquals(array $object, string $value): bool {
    if ($object['target'] === $value) {
        return true;
    }
    $host = ($object['target-type'] ?? '') === 'origin' ? '/^[^\s\/]+$/' : '/^[^\s\/]+\.[^\s\/]+$/';
    return preg_match($host, $object['target']) === 1 && preg_match($host, $value) === 1
        && strtolower($object['target']) === strtolower($value); // strtolower folds ASCII only from PHP 8.2
}

/**
 * The objects that satisfy every honored parameter, in ascending order; an empty
 * array when none does. Nothing is summed or merged: objects come back as held.
 *  - start and end: the period overlaps the range, which includes start and excludes end.
 *  - target: equals the value.
 *  - granularity: the period is a whole calendar year, month or day.
 */
function selectObjects(array $held, array $query): array {
    $instant = fn (array $parsed) => [$parsed['seconds'], $parsed['fraction']];
    $start = isset($query['start']) ? $instant(parseDateTime($query['start'])) : null;
    $end = isset($query['end']) ? $instant(parseDateTime($query['end'])) : null;
    $selected = array_values(array_filter($held, function (array $object) use ($query, $instant, $start, $end): bool {
        return ($end === null || $instant(parseDateTime($object['period']['start'])) < $end)
            && ($start === null || $instant(parseDateTime($object['period']['end'])) > $start)
            && (!isset($query['target']) || targetEquals($object, $query['target']))
            && (!isset($query['granularity']) || isWholeCalendarPeriod($object['period'], $query['granularity']));
    }));
    usort($selected, 'compareObjects');
    return $selected;
}

/**
 * The objects to serve for a request. A server whose objects are all 'basic'
 * supports no parameter: it ignores them all and answers with what it holds, as
 * it holds it (a static file). Otherwise it honors the parameters that match the
 * draft; with none, the answer is every object held.
 */
function answerQuery(array $held, string $rawQuery): array {
    foreach ($held as $object) {
        if (($object['capabilities'] ?? '') === 'extended') {
            return selectObjects($held, honoredQuery($rawQuery));
        }
    }
    return array_values($held);
}

function withNoise(array $object): array {
    $fuzz = fuzzFactorFor(canonicalKey($object['period']));
    foreach (NOISE_MEMBERS as $member) {
        // Multiplication keeps the sign (scopes MAY be negative under net accounting).
        if (isset($object[$member]) && (is_int($object[$member]) || is_float($object[$member]))) {
            $object[$member] = (float)sprintf('%.5e', $object[$member] * $fuzz); // six significant digits
        }
    }
    return $object;
}

/**
 * Apply the safeguards to a list of objects; returns a new array in ascending
 * order of period, of at most 'maxObjects' objects (a larger held set is refused). Options: maxObjects (366),
 * dayFloor ('drop', 'warn' or 'off'; default 'drop'), applyNoise (false),
 * noiseDisclosed (false), onWarning (a callable taking a message).
 */
function secureSustainabilityReport(array $reports, array $options = []): array {
    $maxObjects = $options['maxObjects'] ?? 366;
    $dayFloor = $options['dayFloor'] ?? 'drop';
    $applyNoise = $options['applyNoise'] ?? false;
    $warn = $options['onWarning'] ?? function (string $message): void {};
    if ($applyNoise && !($options['noiseDisclosed'] ?? false)) {
        throw new InvalidArgumentException('applyNoise needs noiseDisclosed => true, your confirmation that the methodology document states the noise and bounds it');
    }

    // Filter before capping, so dropped objects do not use up slots of the cap.
    $secured = [];
    foreach ($reports as $object) {
        if ($dayFloor === 'off' || isOnDayBoundaries($object['period'])) {
            $secured[] = $object;
            continue;
        }
        $warn("period {$object['period']['start']} to {$object['period']['end']} of " . json_encode($object['target']) . ' is not on day boundaries');
        if ($dayFloor === 'warn') {
            $secured[] = $object;
        }
    }

    usort($secured, 'compareObjects');
    if (count($secured) > $maxObjects) {
        throw new InvalidArgumentException(count($secured) . " objects held, more than maxObjects ($maxObjects); raise maxObjects or hold fewer objects (an answer is never truncated)");
    }
    return $applyNoise ? array_map('withNoise', $secured) : $secured;
}

// The registered media type (draft -10, Location and Transport).
header('Content-Type: application/sustainability-data+json');
// Not required by the specification; ordinary web hardening.
header('X-Content-Type-Options: nosniff');
// echo json_encode(secureSustainabilityReport($yourRawData));
