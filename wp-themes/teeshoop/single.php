<?php
/**
 * One article.
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
		<p class="ts-prose__meta"><?php echo esc_html( get_the_date() ); ?></p>
		<?php the_content(); ?>
	</article>
	<?php
endwhile;

advice_block();
get_footer();
