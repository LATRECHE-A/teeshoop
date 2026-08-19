<?php
/**
 * An ordinary page: the cart, the checkout, the account, the legal pages.
 *
 * WooCommerce renders the first three through their shortcodes or blocks inside
 * `the_content()`, so nothing here has to know about them.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

while ( have_posts() ) :
	the_post();
	?>
	<article class="ts-wrap ts-prose">
		<h1 class="ts-prose__title"><?php the_title(); ?></h1>
		<?php the_content(); ?>
	</article>
	<?php
endwhile;

get_footer();
