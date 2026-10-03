<?php
// Plain PHP: works with the built-in server (php -S 127.0.0.1:3000 router.php) and as a front controller.
declare(strict_types=1);
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if ($path !== '/.well-known/sustainability-data') {
    return false; // let the built-in server (or your app) handle everything else
}
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET' && $method !== 'HEAD') {
    http_response_code(405);
    header('Allow: GET, HEAD');
    header('Content-Type: application/json');
    header('X-Content-Type-Options: nosniff');
    echo '{"error":"method not allowed"}';
    return true;
}
// The document: data/sustainability-data.json beside this file, or the file SD_FILE names.
$file = getenv('SD_FILE') ?: __DIR__ . '/data/sustainability-data.json';
if (!is_readable($file)) {
    http_response_code(500);
    header('Content-Type: application/json');
    error_log("cannot read the declaration at $file; put it there or set SD_FILE");
    echo '{"error":"declaration not configured"}';
    return true;
}
$etag = '"' . substr(hash_file('sha256', $file), 0, 32) . '"';
$inm = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
// Weak comparison (RFC 9110 §13.1.2): a W/ prefix added by a compressing proxy still matches.
$tags = array_map(static fn(string $t): string => preg_replace('#^W/#', '', trim($t)), explode(',', $inm));
$fresh = $inm !== '' && (in_array($etag, $tags, true) || in_array('*', $tags, true));
header('Content-Type: application/sustainability-data+json');
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=86400');
header('ETag: ' . $etag);
header('Last-Modified: ' . gmdate('D, d M Y H:i:s', (int) filemtime($file)) . ' GMT');
if ($fresh) {
    http_response_code(304);
    return true;
}
header('Content-Length: ' . (string) filesize($file));
if ($method === 'GET') {
    readfile($file);
}
return true;
