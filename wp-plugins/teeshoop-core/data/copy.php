<?php
/**
 * The shop's editorial copy: category text, sector landing pages and guides.
 *
 * Read by includes/Content.php, which resolves every `{SLOT}` in it against the
 * price authority, the workshop calendar and the studio's own print geometry.
 * See that file for why the words live in the repository and why not one figure
 * here is written as a figure.
 *
 * GUARDED ON ABSPATH because `data/` answers HTTP: this directory is inside
 * wp-content/plugins and a plain request for this path must render nothing.
 *
 * @package Teeshoop\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return array();
