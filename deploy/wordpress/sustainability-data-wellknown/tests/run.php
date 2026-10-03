<?php
// Offline test: WordPress function stubs, the plugin, then the declaration, its signature, the settings
// rules, the HTTP handler and the settings page. Set SDWK_DUMP=<file> to write the served body to a file.
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
define('SDWK_NO_EXIT', true);
$GLOBALS['options'] = [];
$GLOBALS['status'] = 200;
$GLOBALS['query'] = [];
$GLOBALS['settings_errors'] = [];
function add_action(...$a) {}
function add_filter(...$a) {}
function register_activation_hook(...$a) {}
function register_deactivation_hook(...$a) {}
function add_rewrite_rule(...$a) {}
function flush_rewrite_rules() {}
function is_multisite() { return false; }
function get_option(string $k, $d = false) { return $GLOBALS['options'][$k] ?? $d; }
function update_option(string $k, $v, $autoload = null) { $GLOBALS['options'][$k] = $v; return true; }
function add_option(string $k, $v, $deprecated = '', $autoload = null) { if (isset($GLOBALS['options'][$k])) { return false; } $GLOBALS['options'][$k] = $v; return true; }
function home_url(string $p = '') { return 'https://wp.example' . $p; }
function wp_parse_url(string $u, int $c = -1) { return parse_url($u, $c); }
function wp_json_encode($v, int $f = 0) { return json_encode($v, $f); }
function get_query_var(string $k) { return $GLOBALS['query'][$k] ?? ''; }
function status_header(int $s) { $GLOBALS['status'] = $s; }
function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function wp_unslash($v) { return $v; }
function esc_url_raw($u, $p = null) { return (string) $u; }
function __($t, $d = '') { return $t; }
function esc_html__($t, $d = '') { return htmlspecialchars($t, ENT_QUOTES); }
function esc_html_e($t, $d = '') { echo htmlspecialchars($t, ENT_QUOTES); }
function esc_html($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function esc_attr($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function esc_url($t) { return htmlspecialchars((string) $t, ENT_QUOTES); }
function selected($a, $b, $echo = true) { $r = ((string) $a === (string) $b) ? ' selected="selected"' : ''; if ($echo) { echo $r; } return $r; }
function current_user_can($c) { return true; }
function settings_fields($g) { echo '<input type="hidden" name="option_page" value="' . $g . '">'; }
function submit_button() { echo '<input type="submit">'; }
function add_settings_error($setting, $code, $message, $type = 'error') { $GLOBALS['settings_errors'][] = compact('setting', 'code', 'message', 'type'); }

function plugin_basename($f) { return basename(dirname($f)) . '/' . basename($f); }
require __DIR__ . '/../sustainability-data-wellknown.php';

$fail = 0;
function check(bool $ok, string $what): void { global $fail; echo ($ok ? "ok   " : "FAIL ") . $what . "\n"; if (!$ok) { $fail = 1; } }
function serve_as(string $method, string $uri = '/.well-known/sustainability-data', string $inm = ''): string {
    Sustainability_Data_Wellknown::$sent = [];
    $GLOBALS['query'] = [Sustainability_Data_Wellknown::QUERY_VAR => '1'];
    $_SERVER['REQUEST_METHOD'] = $method;
    $_SERVER['REQUEST_URI'] = $uri;
    $_SERVER['HTTP_IF_NONE_MATCH'] = $inm;
    $GLOBALS['status'] = 0;
    ob_start();
    Sustainability_Data_Wellknown::serve();
    return (string) ob_get_clean();
}
$valid = [
    'provider' => 'WP Example (https://wp.example/contact)',
    'methodology_uri' => 'https://wp.example/methodology',
    'period' => '2026-09',
    'energy_kwh' => '12.5',
    'carbon_kgco2e' => '3.06',
    'scope_2' => '3.06',
    'carbon_accounting' => 'market-based',
    'disclosure_uri' => 'https://wp.example/sustainability',
    'measurement_method' => 'third-party-modeled',
    'target_type' => 'origin',
];

// key
Sustainability_Data_Wellknown::activate();
$k1 = get_option(Sustainability_Data_Wellknown::KEY_OPTION);
check(is_array($k1), 'activation generates a signing key');
Sustainability_Data_Wellknown::activate();
check(get_option(Sustainability_Data_Wellknown::KEY_OPTION) === $k1, 'a second activation keeps the existing key');

// settings rules and feedback
check(Sustainability_Data_Wellknown::declaration() === null, 'no settings means no declaration');
$GLOBALS['settings_errors'] = [];
update_option(Sustainability_Data_Wellknown::OPTION, Sustainability_Data_Wellknown::sanitize(array_merge($valid, ['methodology_uri' => 'http://wp.example/m'])));
check(count($GLOBALS['settings_errors']) >= 1 && $GLOBALS['settings_errors'][0]['code'] === 'sdwk_methodology_uri', 'an http methodology page is reported as a settings error');
check(Sustainability_Data_Wellknown::declaration() === null, 'and nothing is published');
foreach (['' => 'empty', 'guessed' => 'unknown'] as $m => $what) {
    update_option(Sustainability_Data_Wellknown::OPTION, Sustainability_Data_Wellknown::sanitize(array_merge($valid, ['measurement_method' => $m])));
    check(Sustainability_Data_Wellknown::declaration() === null, "an $what measurement method publishes nothing (never a silent default)");
}
foreach (['period' => '2026-02-30', 'renewable_percent' => '140', 'energy_kwh' => '-1'] as $field => $bad) {
    $GLOBALS['settings_errors'] = [];
    Sustainability_Data_Wellknown::sanitize(array_merge($valid, [$field => $bad]));
    check(count($GLOBALS['settings_errors']) === 1 && $GLOBALS['settings_errors'][0]['code'] === "sdwk_$field", "$field=$bad is reported");
}
$GLOBALS['settings_errors'] = [];
Sustainability_Data_Wellknown::sanitize(array_merge($valid, ['energy_kwh' => '', 'carbon_kgco2e' => '', 'disclosure_uri' => '']));
check(count($GLOBALS['settings_errors']) === 1 && $GLOBALS['settings_errors'][0]['code'] === 'sdwk_figures', 'no figure and no link is reported');
$GLOBALS['settings_errors'] = [];
update_option(Sustainability_Data_Wellknown::OPTION, Sustainability_Data_Wellknown::sanitize(array_merge($valid, ['scope_1' => '-4'])));
check($GLOBALS['settings_errors'] === [], 'a valid form, including a negative scope (removals), raises no error');

// the declaration
$doc = Sustainability_Data_Wellknown::declaration();
check(is_array($doc), 'settings make a declaration');
check(($doc['target'] ?? '') === 'wp.example', 'target defaults to the site host');
check(count(array_intersect_key($doc, array_flip(['updated', 'capabilities', 'provider', 'measurement-method', 'methodology-uri', 'reporting-period', 'target']))) === 7, 'the seven mandatory members are present');
check(($doc['energy-unit'] ?? '') === 'kWh' && ($doc['carbon-unit'] ?? '') === 'kgCO2e', 'units are declared');
check(($doc['scope-1'] ?? null) === -4.0, 'a negative scope is kept');

// signing
$signed = Sustainability_Data_Wellknown::sign($doc);
check(isset($signed['signed']) && substr_count($signed['signed'], '.') === 2, 'a compact JWS is attached');
[$h, $p, $s] = explode('.', $signed['signed']);
$b64d = static fn(string $x) => base64_decode(strtr($x, '-_', '+/') . str_repeat('=', (4 - strlen($x) % 4) % 4), true);
$header = json_decode($b64d($h), true);
check(($header['alg'] ?? '') === 'EdDSA' && ($header['cty'] ?? '') === 'sustainability-data+json' && isset($header['jwk']['x']), 'JOSE header carries alg, cty and the public key');
check(sodium_crypto_sign_verify_detached($b64d($s), $h . '.' . $p, $b64d($header['jwk']['x'])), 'the signature verifies with the key in the header');
$payload = json_decode($b64d($p), true);
check(!isset($payload['signed']) && $payload['reporting-period'] === '2026-09', 'the payload is the object without signed');

// the endpoint
$body = serve_as('GET');
$hs = implode("\n", Sustainability_Data_Wellknown::$sent);
check($GLOBALS['status'] === 200, 'GET answers 200');
check(str_contains($hs, 'Content-Type: application/sustainability-data+json'), "the draft's media type");
check(str_contains($hs, 'X-Content-Type-Options: nosniff') && str_contains($hs, 'Access-Control-Allow-Origin: *') && str_contains($hs, 'Cache-Control: public, max-age=86400'), 'nosniff, CORS and caching headers');
check(!str_contains($hs, 'Expires'), 'no contradictory Expires header on the cacheable answer');
preg_match('/ETag: (".*")/', $hs, $m);
check(isset($m[1]), 'an ETag is sent');
check(json_decode($body, true)['target'] === 'wp.example', 'the body is the declaration');
if (($dump = getenv('SDWK_DUMP')) !== false && $dump !== '') {
    file_put_contents($dump, $body);
}
$head = serve_as('HEAD');
check($GLOBALS['status'] === 200 && $head === '', 'HEAD answers 200 without a body');
serve_as('GET', '/.well-known/sustainability-data', 'W/' . ($m[1] ?? '""'));
check($GLOBALS['status'] === 304, 'a matching If-None-Match (weak form too) answers 304');
serve_as('POST');
$hs = implode("\n", Sustainability_Data_Wellknown::$sent);
check($GLOBALS['status'] === 405 && str_contains($hs, 'Allow: GET, HEAD') && str_contains($hs, 'Cache-Control: no-store'), 'POST answers 405 with Allow and no-store');
$out = serve_as('GET', '/some/page?sdwk_declaration=1');
check($GLOBALS['status'] === 0 && $out === '', 'the query variable alone does not serve the document at another path');

// the settings page
ob_start();
Sustainability_Data_Wellknown::page();
$page = (string) ob_get_clean();
check(str_contains($page, 'name="sdwk_declaration[provider]"') && str_contains($page, 'name="sdwk_declaration[measurement_method]"'), 'the settings page renders the form fields');
check(str_contains($page, 'Published at'), 'the settings page says the declaration is published');
check(str_contains($page, '<option value="">choose</option>'), 'the measurement method must be chosen, nothing is preselected for it');

exit($fail);
