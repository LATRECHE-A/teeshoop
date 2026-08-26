<?php
/**
 * An ordinary page: the cart, the checkout, the account, the legal pages, and
 * the sector landing pages session 11 added.
 *
 * WooCommerce renders the first three through their shortcodes or blocks inside
 * `the_content()`, so nothing here has to know about them.
 *
 * THE HEADING CAN COME FROM THE REPOSITORY. A landing page's title in WordPress
 * is what an operator reads in a list of pages ("Associations"); its `h1` is
 * what a buyer and a crawler read, and it has to carry the words they use ("Des
 * t-shirts et des sweats personnalisés pour votre association"). They are not
 * the same string and pretending they are costs the page its subject. When
 * `Content` holds one, it wins; otherwise the page title is the heading, as
 * before.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

while ( have_posts() ) :
	the_post();

	$ts_key  = 'page:' . get_post_field( 'post_name', get_the_ID() );
	$ts_page = editorial( $ts_key );
	?>
	<article class="ts-wrap ts-prose">
		<h1 class="ts-prose__title">
			<?php echo esc_html( '' !== $ts_page['h1'] ? $ts_page['h1'] : get_the_title() ); ?>
		</h1>

		<?php foreach ( $ts_page['intro'] as $ts_line ) : ?>
			<p class="ts-lead"><?php echo esc_html( $ts_line ); ?></p>
		<?php endforeach; ?>

		<?php
		/*
		 * Anything the associate typed into the editor still appears, above the
		 * repository's copy rather than instead of it. The admin screen tells
		 * him where the rest lives; see `Content::notice()`.
		 */
		the_content();
		?>
	</article>

	<?php editorial_body( $ts_page, 'ts-edito-' . get_the_ID() ); ?>

	<?php
endwhile;

/*
 * The written route out, on every landing page.
 *
 * These pages exist to be arrived at from a search, by somebody who has not
 * seen the shop. Sending them to a category with no next step is the mistake
 * the whole session is trying not to make.
 */
if ( class_exists( '\Teeshoop\Core\Content' ) && \Teeshoop\Core\Content::has( 'page:' . get_post_field( 'post_name', get_queried_object_id() ) ) ) {
	advice_block();
}

get_footer();
