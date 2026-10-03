<?php
/**
 * The plugin: the declaration, its signature, the endpoint and the settings page.
 *
 * @package Sustainability_Data_Wellknown
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Serves /.well-known/sustainability-data from the figures saved in Settings > Sustainability data.
 */
final class Sustainability_Data_Wellknown {

	public const OPTION       = 'sdwk_declaration';
	public const KEY_OPTION   = 'sdwk_signing_key';
	public const QUERY_VAR    = 'sdwk_declaration';
	public const PATH         = '/.well-known/sustainability-data';
	public const MEDIA_TYPE   = 'application/sustainability-data+json';
	public const METHODS      = array( 'hardware-metered', 'hardware-estimated', 'cloud-billing', 'third-party-modeled' );
	public const TARGET_TYPES = array( 'origin', 'path', 'organization', 'service', 'product', 'device', 'tenant', 'data-source' );
	public const ACCOUNTING   = array( 'location-based', 'market-based' );
	public const FIELDS       = array(
		'target',
		'provider',
		'methodology_uri',
		'period',
		'measurement_method',
		'target_type',
		'energy_kwh',
		'carbon_kgco2e',
		'scope_1',
		'scope_2',
		'scope_3',
		'renewable_percent',
		'carbon_accounting',
		'disclosure_uri',
	);

	/** Response headers recorded instead of sent when SDWK_NO_EXIT is defined (offline tests only). */
	public static array $sent = array();

	/** The main plugin file, for the activation hooks and plugin_basename(). */
	private static string $file = '';

	public static function boot( string $file ): void {
		self::$file = $file;
		add_action( 'init', array( self::class, 'rewrite' ) );
		add_filter( 'query_vars', static fn( array $vars ): array => array_merge( $vars, array( self::QUERY_VAR ) ) );
		add_action( 'template_redirect', array( self::class, 'serve' ), 0 );
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_init', array( self::class, 'settings' ) );
		add_action( 'admin_notices', array( self::class, 'notices' ) );
		add_action( 'wp_initialize_site', array( self::class, 'initialize_site' ), 100 );
		register_activation_hook( $file, array( self::class, 'activate' ) );
		register_deactivation_hook( $file, array( self::class, 'deactivate' ) );
	}

	// ---- lifecycle (single site and multisite) ------------------------------------------------

	public static function activate( bool $network_wide = false ): void {
		self::for_each_site(
			$network_wide,
			static function (): void {
				self::rewrite();
				flush_rewrite_rules();
				self::ensure_key();
			}
		);
	}

	public static function deactivate( bool $network_wide = false ): void {
		self::for_each_site(
			$network_wide,
			static function (): void {
				flush_rewrite_rules();
			}
		);
	}

	/** A site created after network activation gets its rule and its key. */
	public static function initialize_site( $site ): void {
		if ( ! is_multisite() || ! function_exists( 'is_plugin_active_for_network' ) || ! is_plugin_active_for_network( plugin_basename( self::$file ) ) ) {
			return;
		}
		switch_to_blog( (int) $site->blog_id );
		self::rewrite();
		flush_rewrite_rules();
		self::ensure_key();
		restore_current_blog();
	}

	private static function for_each_site( bool $network_wide, callable $callback ): void {
		if ( $network_wide && is_multisite() ) {
			foreach ( get_sites(
				array(
					'fields' => 'ids',
					'number' => 0,
				)
			) as $id ) {
				switch_to_blog( (int) $id );
				$callback();
				restore_current_blog();
			}
			return;
		}
		$callback();
	}

	/** The site's Ed25519 key, created once; add_option() never overwrites a key a concurrent request made. */
	public static function ensure_key(): ?array {
		$key = get_option( self::KEY_OPTION );
		if ( is_array( $key ) ) {
			return $key;
		}
		if ( ! function_exists( 'sodium_crypto_sign_keypair' ) ) {
			return null;
		}
		$pair = sodium_crypto_sign_keypair();
		add_option(
			self::KEY_OPTION,
			array(
				'secret' => base64_encode( sodium_crypto_sign_secretkey( $pair ) ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- key storage, not obfuscation.
			'public'     => base64_encode( sodium_crypto_sign_publickey( $pair ) ), // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- key storage, not obfuscation.
			),
			'',
			false
		);
		$key = get_option( self::KEY_OPTION );
		return is_array( $key ) ? $key : null;
	}

	public static function rewrite(): void {
		add_rewrite_rule( '^\.well-known/sustainability-data$', 'index.php?' . self::QUERY_VAR . '=1', 'top' );
	}

	// ---- the declaration -----------------------------------------------------------------------

	/**
	 * What is wrong with saved settings, as field => message; empty when they make a declaration.
	 * One rule set for the settings form and for the endpoint, so the two cannot disagree.
	 */
	public static function problems( array $o ): array {
		$s = static fn( string $k ): string => trim( (string) ( $o[ $k ] ?? '' ) );
		$p = array();
		if ( $s( 'provider' ) === '' ) {
			$p['provider'] = __( 'Provider is required.', 'sustainability-data-wellknown' );
		}
		if ( ! self::is_https( $s( 'methodology_uri' ) ) ) {
			$p['methodology_uri'] = __( 'Methodology page must be an https:// address.', 'sustainability-data-wellknown' );
		}
		if ( ! self::is_period( $s( 'period' ) ) ) {
			$p['period'] = __( 'Reporting period must be YYYY, YYYY-MM or YYYY-MM-DD, a real calendar date.', 'sustainability-data-wellknown' );
		}
		if ( ! in_array( $s( 'measurement_method' ), self::METHODS, true ) ) {
			$p['measurement_method'] = __( 'Choose how the figures were obtained.', 'sustainability-data-wellknown' );
		}
		foreach ( array( 'energy_kwh', 'carbon_kgco2e' ) as $k ) {
			if ( $s( $k ) !== '' && ( ! is_numeric( $s( $k ) ) || (float) $s( $k ) < 0 ) ) {
				$p[ $k ] = __( 'Energy and carbon must be numbers, zero or more.', 'sustainability-data-wellknown' );
			}
		}
		foreach ( array( 'scope_1', 'scope_2', 'scope_3' ) as $k ) {
			if ( $s( $k ) !== '' && ! is_numeric( $s( $k ) ) ) {
				$p[ $k ] = __( 'Scopes must be numbers (negative only for removals).', 'sustainability-data-wellknown' );
			}
		}
		if ( $s( 'renewable_percent' ) !== '' && ( ! is_numeric( $s( 'renewable_percent' ) ) || (float) $s( 'renewable_percent' ) < 0 || (float) $s( 'renewable_percent' ) > 100 ) ) {
			$p['renewable_percent'] = __( 'Renewable energy is a percentage from 0 to 100.', 'sustainability-data-wellknown' );
		}
		if ( $s( 'disclosure_uri' ) !== '' && ! self::is_https( $s( 'disclosure_uri' ) ) ) {
			$p['disclosure_uri'] = __( 'Disclosure page must be an https:// address.', 'sustainability-data-wellknown' );
		}
		if ( $s( 'energy_kwh' ) === '' && $s( 'carbon_kgco2e' ) === '' && $s( 'disclosure_uri' ) === '' ) {
			$p['figures'] = __( 'Give an energy figure, a carbon figure or a disclosure page: a declaration carries a figure or an evidence link.', 'sustainability-data-wellknown' );
		}
		return $p;
	}

	private static function is_https( string $u ): bool {
		return (bool) preg_match( '#^https://[^\s/]+#', $u );
	}

	private static function is_period( string $p ): bool {
		if ( ! preg_match( '/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/', $p, $m ) ) {
			return false;
		}
		$month = isset( $m[2] ) ? (int) $m[2] : 1;
		$day   = isset( $m[3] ) ? (int) $m[3] : 1;
		return checkdate( $month, $day, (int) $m[1] );
	}

	/** The declaration object from the saved settings, or null when the settings do not make one. */
	public static function declaration(): ?array {
		$o = get_option( self::OPTION );
		if ( ! is_array( $o ) || self::problems( $o ) !== array() ) {
			return null;
		}
		$s   = static fn( string $k ): string => trim( (string) ( $o[ $k ] ?? '' ) );
		$doc = array(
			'updated'            => gmdate( 'Y-m-d\TH:i:s\Z', (int) ( $o['saved_at'] ?? time() ) ),
			'capabilities'       => 'basic',
			'provider'           => $s( 'provider' ),
			'measurement-method' => $s( 'measurement_method' ),
			'methodology-uri'    => $s( 'methodology_uri' ),
			'reporting-period'   => $s( 'period' ),
			'target'             => $s( 'target' ) !== '' ? $s( 'target' ) : (string) wp_parse_url( home_url(), PHP_URL_HOST ),
			'target-type'        => in_array( $s( 'target_type' ), self::TARGET_TYPES, true ) ? $s( 'target_type' ) : 'origin',
		);
		if ( $s( 'energy_kwh' ) !== '' ) {
			$doc['energy-consumption'] = (float) $s( 'energy_kwh' );
			$doc['energy-unit']        = 'kWh';
		}
		if ( $s( 'carbon_kgco2e' ) !== '' ) {
			$doc['carbon-footprint'] = (float) $s( 'carbon_kgco2e' );
			$doc['carbon-unit']      = 'kgCO2e';
		}
		$scopes = false;
		foreach ( array(
			'scope_1' => 'scope-1',
			'scope_2' => 'scope-2',
			'scope_3' => 'scope-3',
		) as $k => $m ) {
			if ( $s( $k ) !== '' ) {
				$doc[ $m ] = (float) $s( $k );
				$scopes    = true;
			}
		}
		if ( $scopes && ! isset( $doc['carbon-unit'] ) ) {
			$doc['carbon-unit'] = 'kgCO2e'; // scopes are entered in kgCO2e
		}
		if ( $s( 'renewable_percent' ) !== '' ) {
			$doc['renewable-energy'] = (float) $s( 'renewable_percent' );
		}
		if ( in_array( $s( 'carbon_accounting' ), self::ACCOUNTING, true ) ) {
			$doc['carbon-accounting'] = $s( 'carbon_accounting' );
		}
		if ( $s( 'disclosure_uri' ) !== '' ) {
			$doc['disclosure-uri'] = $s( 'disclosure_uri' );
		}
		return $doc;
	}

	/** base64url (RFC 4648 section 5), the JWS encoding; not obfuscation. */
	private static function b64url( string $bytes ): string {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- JWS encoding (RFC 7515).
	}

	/** The object with its `signed` member (EdDSA JWS over the object without it), or unchanged without a key. */
	public static function sign( array $doc ): array {
		$key = self::ensure_key();
		if ( null === $key || ! function_exists( 'sodium_crypto_sign_detached' ) ) {
			return $doc;
		}
		unset( $doc['signed'] );
		$public = base64_decode( (string) $key['public'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- key storage, not obfuscation.
		$secret = base64_decode( (string) $key['secret'], true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- key storage, not obfuscation.
		if ( false === $public || false === $secret ) {
			return $doc;
		}
		$header        = array(
			'alg' => 'EdDSA',
			'cty' => 'sustainability-data+json',
			'jwk' => array(
				'kty' => 'OKP',
				'crv' => 'Ed25519',
				'x'   => self::b64url( $public ),
				'alg' => 'EdDSA',
				'use' => 'sig',
			),
		);
		$h             = self::b64url( (string) wp_json_encode( $header, JSON_UNESCAPED_SLASHES ) );
		$p             = self::b64url( (string) wp_json_encode( $doc, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) );
		$doc['signed'] = $h . '.' . $p . '.' . self::b64url( sodium_crypto_sign_detached( $h . '.' . $p, $secret ) );
		return $doc;
	}

	// ---- the HTTP endpoint ---------------------------------------------------------------------

	public static function serve(): void {
		if ( ! get_query_var( self::QUERY_VAR ) ) {
			return;
		}
		// Answer only at the well-known path itself, not at any URL carrying the query variable.
		$uri  = sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '' ) );
		$want = (string) wp_parse_url( home_url( self::PATH ), PHP_URL_PATH );
		if ( (string) wp_parse_url( $uri, PHP_URL_PATH ) !== $want ) {
			return;
		}
		$method = strtoupper( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_METHOD'] ?? 'GET' ) ) );
		if ( 'GET' !== $method && 'HEAD' !== $method ) {
			status_header( 405 );
			self::header( 'Allow: GET, HEAD' );
			self::header( 'Content-Type: application/json' );
			self::header( 'X-Content-Type-Options: nosniff' );
			self::header( 'Cache-Control: no-store' );
			echo '{"error":"method not allowed"}';
			self::done();
			return;
		}
		$doc = self::declaration();
		if ( null === $doc ) {
			status_header( 404 );
			self::header( 'Content-Type: application/json' );
			self::header( 'X-Content-Type-Options: nosniff' );
			self::header( 'Cache-Control: no-store' );
			echo '{"error":"no sustainability declaration is published"}';
			self::done();
			return;
		}
		$body = (string) wp_json_encode( self::sign( $doc ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "\n";
		$etag = '"' . substr( hash( 'sha256', $body ), 0, 32 ) . '"';
		status_header( 200 );
		self::header( 'Content-Type: ' . self::MEDIA_TYPE );
		self::header( 'X-Content-Type-Options: nosniff' );
		self::header( 'Access-Control-Allow-Origin: *' );
		self::header( 'Cache-Control: public, max-age=86400' );
		self::header( 'ETag: ' . $etag );
		self::header( 'Last-Modified: ' . gmdate( 'D, d M Y H:i:s', (int) strtotime( $doc['updated'] ) ) . ' GMT' );
		$inm  = sanitize_text_field( wp_unslash( $_SERVER['HTTP_IF_NONE_MATCH'] ?? '' ) );
		$tags = array_map( static fn( string $t ): string => preg_replace( '#^W/#', '', trim( $t ) ), explode( ',', $inm ) );
		if ( '' !== $inm && ( in_array( $etag, $tags, true ) || in_array( '*', $tags, true ) ) ) {
			status_header( 304 );
			self::done();
			return;
		}
		if ( 'GET' === $method ) {
			echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- machine-readable JSON built by wp_json_encode() above, served as application/sustainability-data+json with nosniff, not HTML.
		}
		self::done();
	}

	private static function header( string $line ): void {
		if ( defined( 'SDWK_NO_EXIT' ) ) {
			self::$sent[] = $line;
			return;
		}
		header( $line );
	}

	private static function done(): void {
		if ( defined( 'SDWK_NO_EXIT' ) ) {
			return;
		}
		exit;
	}

	// ---- settings page -------------------------------------------------------------------------

	public static function menu(): void {
		add_options_page(
			__( 'Sustainability data', 'sustainability-data-wellknown' ),
			__( 'Sustainability data', 'sustainability-data-wellknown' ),
			'manage_options',
			'sdwk',
			array( self::class, 'page' )
		);
	}

	public static function settings(): void {
		register_setting(
			'sdwk',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( self::class, 'sanitize' ),
			)
		);
	}

	/** Cleans the input, keeps it (so the form can be corrected) and reports every rule it breaks. */
	public static function sanitize( $input ): array {
		$input = is_array( $input ) ? $input : array();
		$out   = array();
		foreach ( self::FIELDS as $k ) {
			$out[ $k ] = isset( $input[ $k ] ) ? sanitize_text_field( (string) $input[ $k ] ) : '';
		}
		foreach ( array( 'methodology_uri', 'disclosure_uri' ) as $k ) {
			if ( '' !== $out[ $k ] ) {
				$out[ $k ] = esc_url_raw( $out[ $k ], array( 'https' ) );
			}
		}
		$out['saved_at'] = time();
		foreach ( self::problems( $out ) as $field => $message ) {
			add_settings_error( 'sdwk', 'sdwk_' . $field, $message, 'error' );
		}
		return $out;
	}

	/** Tells an administrator when the site's PHP cannot sign. */
	public static function notices(): void {
		if ( ! current_user_can( 'manage_options' ) || function_exists( 'sodium_crypto_sign_keypair' ) ) {
			return;
		}
		echo '<div class="notice notice-warning"><p>' . esc_html__( 'Sustainability data: this PHP has no sodium extension, so the declaration is published unsigned.', 'sustainability-data-wellknown' ) . '</p></div>';
	}

	public static function page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$o         = get_option( self::OPTION, array() );
		$o         = is_array( $o ) ? $o : array();
		$url       = home_url( self::PATH );
		$published = self::declaration() !== null;

		echo '<div class="wrap"><h1>' . esc_html__( 'Sustainability data', 'sustainability-data-wellknown' ) . '</h1>';
		echo '<div class="notice ' . ( $published ? 'notice-success' : 'notice-info' ) . ' inline"><p>';
		if ( $published ) {
			/* translators: %s: the address where the declaration is served. */
			printf( esc_html__( 'Published at %s.', 'sustainability-data-wellknown' ), '<a href="' . esc_url( $url ) . '"><code>' . esc_html( $url ) . '</code></a>' );
		} else {
			esc_html_e( 'Not published yet: the address answers 404 until the required fields below are filled in correctly.', 'sustainability-data-wellknown' );
		}
		echo '</p></div>';
		echo '<p>' . esc_html__( 'The figures are yours; the plugin only publishes them. Check the result with:', 'sustainability-data-wellknown' )
			. ' <code>npx -y -p sustainability-wellknown-consumer sustainability-fetch ' . esc_html( home_url() ) . ' --strict</code></p>';

		echo '<form method="post" action="options.php">';
		settings_fields( 'sdwk' );
		echo '<table class="form-table" role="presentation">';
		self::text_row( $o, 'provider', __( 'Provider (required)', 'sustainability-data-wellknown' ), __( 'Example Ltd (https://example.com/contact)', 'sustainability-data-wellknown' ), __( 'Who publishes these figures and how to reach them; a role, not a personal address.', 'sustainability-data-wellknown' ) );
		self::text_row( $o, 'methodology_uri', __( 'Methodology page (required, https)', 'sustainability-data-wellknown' ), 'https://example.com/sustainability/methodology', __( 'A public page that says how the figures were obtained.', 'sustainability-data-wellknown' ) );
		self::text_row( $o, 'period', __( 'Reporting period (required)', 'sustainability-data-wellknown' ), '2026', __( 'YYYY, YYYY-MM or YYYY-MM-DD, a completed period.', 'sustainability-data-wellknown' ) );
		self::select_row( $o, 'measurement_method', __( 'Measurement method (required)', 'sustainability-data-wellknown' ), self::METHODS, true, __( 'hardware-metered only for a meter reading; a model or a calculator is third-party-modeled.', 'sustainability-data-wellknown' ) );
		self::text_row( $o, 'target', __( 'Target', 'sustainability-data-wellknown' ), (string) wp_parse_url( home_url(), PHP_URL_HOST ), __( 'What the figures are about; the site host by default.', 'sustainability-data-wellknown' ) );
		self::select_row( $o, 'target_type', __( 'Target type', 'sustainability-data-wellknown' ), self::TARGET_TYPES, false, '' );
		self::text_row( $o, 'energy_kwh', __( 'Energy (kWh)', 'sustainability-data-wellknown' ), '', '' );
		self::text_row( $o, 'carbon_kgco2e', __( 'Carbon (kgCO2e)', 'sustainability-data-wellknown' ), '', '' );
		self::text_row( $o, 'scope_1', __( 'Scope 1 (kgCO2e)', 'sustainability-data-wellknown' ), '', '' );
		self::text_row( $o, 'scope_2', __( 'Scope 2 (kgCO2e)', 'sustainability-data-wellknown' ), '', '' );
		self::text_row( $o, 'scope_3', __( 'Scope 3 (kgCO2e)', 'sustainability-data-wellknown' ), '', '' );
		self::select_row( $o, 'carbon_accounting', __( 'Carbon accounting', 'sustainability-data-wellknown' ), self::ACCOUNTING, true, '' );
		self::text_row( $o, 'renewable_percent', __( 'Renewable energy (%)', 'sustainability-data-wellknown' ), '', '' );
		self::text_row( $o, 'disclosure_uri', __( 'Disclosure page (https)', 'sustainability-data-wellknown' ), 'https://example.com/sustainability', __( 'Where the full report lives. A declaration needs a figure or this link.', 'sustainability-data-wellknown' ) );
		echo '</table>';
		submit_button();
		echo '</form></div>';
	}

	private static function text_row( array $o, string $key, string $label, string $placeholder, string $help ): void {
		echo '<tr><th scope="row"><label for="' . esc_attr( 'sdwk-' . $key ) . '">' . esc_html( $label ) . '</label></th><td>';
		printf(
			'<input type="text" class="regular-text" id="%1$s" name="%2$s[%3$s]" value="%4$s" placeholder="%5$s">',
			esc_attr( 'sdwk-' . $key ),
			esc_attr( self::OPTION ),
			esc_attr( $key ),
			esc_attr( (string) ( $o[ $key ] ?? '' ) ),
			esc_attr( $placeholder )
		);
		if ( '' !== $help ) {
			echo '<p class="description">' . esc_html( $help ) . '</p>';
		}
		echo '</td></tr>';
	}

	private static function select_row( array $o, string $key, string $label, array $choices, bool $empty_choice, string $help ): void {
		$current = (string) ( $o[ $key ] ?? '' );
		echo '<tr><th scope="row"><label for="' . esc_attr( 'sdwk-' . $key ) . '">' . esc_html( $label ) . '</label></th><td>';
		echo '<select id="' . esc_attr( 'sdwk-' . $key ) . '" name="' . esc_attr( self::OPTION ) . '[' . esc_attr( $key ) . ']">';
		if ( $empty_choice ) {
			echo '<option value="">' . esc_html__( 'choose', 'sustainability-data-wellknown' ) . '</option>';
		}
		foreach ( $choices as $choice ) {
			echo '<option value="' . esc_attr( $choice ) . '"';
			selected( $current, $choice );
			echo '>' . esc_html( $choice ) . '</option>';
		}
		echo '</select>';
		if ( '' !== $help ) {
			echo '<p class="description">' . esc_html( $help ) . '</p>';
		}
		echo '</td></tr>';
	}
}
