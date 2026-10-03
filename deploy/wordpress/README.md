# WordPress plugin: Sustainability Data (well-known)

The plugin folder `sustainability-data-wellknown/` is what gets zipped for the WordPress.org directory
(GPLv2-or-later, as the directory requires). It serves `/.well-known/sustainability-data` from figures
entered in Settings → Sustainability data, with the draft's media type and the right headers, HEAD and
405 handling, ETag/304, and an Ed25519 signature made with a key generated on the site at activation.
It makes no external calls.

Structure: `sustainability-data-wellknown.php` (header, loader), `includes/class-sustainability-data-wellknown.php`
(the plugin), `uninstall.php` (removes both options, on every site of a network), `readme.txt`, `LICENSE` (GPLv2
text), `.distignore` (`tests/` is not shipped).

Checks, all run in CI by `deploy-kit.yml`:
- `php tests/run.php` — offline, with WordPress function stubs: settings rules and their error messages, the
  declaration, the Ed25519 signature, GET/HEAD/304/405, the path check, the settings page. With
  `SDWK_DUMP=<file>` it writes the served body, which CI validates and whose signature it verifies with the consumer.
- `phpcs --standard=WordPress-Extra` and `--standard=PHPCompatibilityWP --runtime-set testVersion 8.1-`: clean.
- `bash ../wordpress-e2e.sh`: a real WordPress in Docker (MariaDB + the official image + WP-CLI), the plugin
  activated with pretty permalinks, the endpoint checked by the consumer in strict mode.

Owner steps to publish: run the Plugin Check plugin on a test site (zero errors), zip the folder (without
`tests/`, per `.distignore`), add two screenshots, submit at
https://wordpress.org/plugins/developers/add/ from the owner's wordpress.org account; expect a review of
days to weeks; the slug cannot start with a trademark (it does not). Until then the zip installs on any
site through Plugins → Add New → Upload.
