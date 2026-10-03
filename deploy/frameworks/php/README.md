# PHP
`router.php` is a complete front controller, started and validated in CI with PHP's built-in server; it serves
`data/sustainability-data.json` beside it, or the file named by `SD_FILE`.
`laravel-routes.php` is the one Laravel route; `SymfonyController.php` the one Symfony controller.
WordPress: until the plugin ships, the Apache/LiteSpeed `.htaccess` recipe in `../../proxies/apache/`
works on every WordPress host that runs Apache or LiteSpeed; put the document at
`.well-known/sustainability-data` in the site root (outside `wp-content`).
A hardened plain-PHP example is `../../../example-scripts/security.php`.
