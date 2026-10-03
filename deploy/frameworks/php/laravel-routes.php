<?php
// Laravel: add to routes/web.php. The document lives at storage/app/sustainability-data (not public/).
use Illuminate\Support\Facades\Route;

Route::match(['GET', 'HEAD'], '/.well-known/sustainability-data', function () {
    return response(file_get_contents(storage_path('app/sustainability-data')), 200, [
        'Content-Type' => 'application/sustainability-data+json',
        'X-Content-Type-Options' => 'nosniff',
        'Access-Control-Allow-Origin' => '*',
        'Cache-Control' => 'public, max-age=86400',
    ]);
})->withoutMiddleware(['web']); // no session, no CSRF, no cookies on a public machine-readable file
