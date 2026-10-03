<?php
/**
 * Removes the plugin's options on uninstall, on every site of a network.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

$sdwk_delete = static function (): void {
	delete_option( 'sdwk_declaration' );
	delete_option( 'sdwk_signing_key' );
};

if ( is_multisite() ) {
	foreach ( get_sites(
		array(
			'fields' => 'ids',
			'number' => 0,
		)
	) as $sdwk_site_id ) {
		switch_to_blog( (int) $sdwk_site_id );
		$sdwk_delete();
		restore_current_blog();
	}
} else {
	$sdwk_delete();
}
