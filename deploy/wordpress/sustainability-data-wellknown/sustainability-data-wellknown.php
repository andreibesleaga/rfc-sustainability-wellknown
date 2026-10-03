<?php
/**
 * Plugin Name:       Sustainability Data (well-known)
 * Plugin URI:        https://github.com/andreibesleaga/rfc-sustainability-wellknown
 * Description:       Publishes this site's energy and carbon figures at /.well-known/sustainability-data, signed with a key generated on this site.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Andrei Nicolae Besleaga
 * Author URI:        https://andreibesleaga.com/
 * License:           GPLv2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       sustainability-data-wellknown
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This program is free software; you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version. This program is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License (LICENSE) for more details.
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/includes/class-sustainability-data-wellknown.php';

Sustainability_Data_Wellknown::boot( __FILE__ );
