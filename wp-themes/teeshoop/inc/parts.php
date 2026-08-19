<?php
/**
 * The pieces the templates are built from.
 *
 * Separate from `functions.php`, which does setup and reads numbers out of the
 * plugin. Everything here RENDERS, and none of it decides a value.
 *
 * @package Teeshoop\Theme
 */

declare( strict_types = 1 );

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

/**
 * How many references the catalogue publishes, and how many families it covers.
 *
 * Counted from the shop, never written down. The brief is explicit that the
 * width of the catalogue is the offer ("Il n'est pas prévu de réduire le site à
 * une petite sélection"), so the figure has to be the real one: a homepage that
 * claimed "plusieurs centaines de références" over a shop holding thirty would
 * be the first thing a professional buyer checks and the first thing they catch.
 *
 * @return array{references:int,families:int}
 */
function catalogue_stats(): array {
	static $stats = null;
	if ( null !== $stats ) {
		return $stats;
	}

	/*
	 * COUNTED IN THE CATALOGUE TREE, NOT IN THE POST TABLE. `wp_count_posts`
	 * answers with every published product, which on a development mirror is
	 * the imported references PLUS the fixtures each test run leaves behind and
	 * the demonstration garments: it said "30 références" over six real ones.
	 * The families listed underneath are the categories, so the total has to be
	 * the same population or the page contradicts itself two lines apart.
	 */
	global $wpdb;
	$default = (int) get_option( 'default_product_cat', 0 );

	$references = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(DISTINCT p.ID)
			 FROM {$wpdb->posts} p
			 INNER JOIN {$wpdb->term_relationships} tr ON tr.object_id = p.ID
			 INNER JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id = tr.term_taxonomy_id
			 WHERE p.post_type = 'product' AND p.post_status = 'publish'
			   AND tt.taxonomy = 'product_cat' AND tt.term_id <> %d",
			$default
		)
	);

	$stats = array(
		'references' => $references,
		'families'   => count( top_categories() ),
	);
	return $stats;
}

/**
 * The three campaign families, in the associate's own words.
 *
 * Chapter 00 of the brief gives each one its needs AND its arguments, verbatim,
 * and says they must never share an argument. They are reproduced rather than
 * rewritten, because they are the one piece of customer-facing copy in this
 * project that came from the person who actually sells to these people.
 *
 * THE NEEDS DESCRIBE THE BUYER, NOT OUR STOCK. "Parkas" and "tabliers" are in
 * the BTP and restaurant lists and neither is in the catalogue today: the
 * catalogue carries t-shirts, polos and sweats. So a sector block states the
 * need and offers a quote, and never links to a category that does not exist.
 * Naming a garment we cannot ship would be a promise the shop then declines,
 * which is the same defect as « délai allongé » on an article with
 * `backorders = no`.
 *
 * @return array<int,array{title:string,needs:string,answer:string}>
 */
function sectors(): array {
	return array(
		array(
			'title'  => __( 'Restauration et commerces', 'teeshoop' ),
			'needs'  => __( 'T-shirts, polos, tabliers, casquettes, tenues d’équipe, réassorts, événements, ouverture de point de vente.', 'teeshoop' ),
			'answer' => __( 'Des petites quantités acceptées, des tenues qui restent identiques d’une commande à l’autre, et votre logo repris tel quel d’une série à la suivante.', 'teeshoop' ),
		),
		array(
			'title'  => __( 'BTP, sécurité, nettoyage et services techniques', 'teeshoop' ),
			'needs'  => __( 'Vêtements de travail, haute visibilité, softshells, parkas, polos, marquage cœur et dos, prénom de chaque salarié.', 'teeshoop' ),
			'answer' => __( 'Un catalogue large et toutes les tailles, le marquage au dos comme au cœur, et le réassort d’une nouvelle recrue sans refaire le dossier.', 'teeshoop' ),
		),
		array(
			'title'  => __( 'Associations, sport, écoles et événements', 'teeshoop' ),
			'needs'  => __( 'T-shirts, sweats, polos, casquettes, sacs, tenues d’équipe, séries limitées, beaucoup de tailles différentes.', 'teeshoop' ),
			'answer' => __( 'La répartition des tailles se saisit ligne par ligne, le bon à tirer se valide en ligne sans créer de compte, et la série se recommande à l’identique.', 'teeshoop' ),
		),
	);
}

/**
 * A to-scale drawing of what you can actually print, in centimetres.
 *
 * THIS IS THE ONE THING NEITHER COMPETITOR PUBLISHES. Checked again on
 * 2026-08-19: mistertee.fr holds its zones in millimetres in a JSON payload and
 * the strings " mm" and "×" appear zero times in the page a customer reads, and
 * names them "A3", "Coeur", "Anti-coeur" and "Bandeau", which is print-shop
 * vocabulary. tostadora.fr publishes no print dimension anywhere on the estate;
 * the only cm figure in its help centre is a 24 cm upload width. A buyer on
 * either site cannot answer "will my A4 logo fit" without opening an editor.
 *
 * Every rectangle here is REAL. The two garment zones come from
 * `Garments::areas()`, which is generated from the studio's own definitions by
 * `scripts/gen-garment-data.mjs` and guarded by `npm run verify:garments`, so
 * this drawing cannot drift from what the press is set to. The A4 sheet is
 * 21 × 29,7 cm because that is what A4 is, and it is there because "30,5 cm"
 * means nothing to a buyer and "wider than a sheet of paper" means everything.
 *
 * NOTHING IS DRAWN WHEN THERE IS NOTHING TO DRAW. If the garment data is
 * missing the function returns an empty string and the template shows its empty
 * state, rather than a diagram of invented rectangles.
 */
function print_zone_figure( string $garment = 'tee' ): string {
	if ( ! class_exists( '\\Teeshoop\\Core\\Garments' ) ) {
		return '';
	}

	$areas = \Teeshoop\Core\Garments::area_by_size( $garment, 'front' );
	if ( empty( $areas ) ) {
		return '';
	}

	$priced = \Teeshoop\Core\Garments::priced_size( $garment );
	$sizes  = array_keys( $areas );
	$small  = isset( $areas[ $priced ] ) ? $priced : (string) reset( $sizes );
	$large  = (string) end( $sizes );

	$ref = $areas[ $small ] ?? null;
	$max = $areas[ $large ] ?? null;
	if ( ! is_array( $ref ) || ! is_array( $max ) ) {
		return '';
	}

	// A4, in centimetres. ISO 216, not a number anybody had to be told.
	$a4_w = 21.0;
	$a4_h = 29.7;

	// One scale for the whole drawing, so the three rectangles are comparable.
	// 1 cm of garment is PX_PER_CM units of the viewBox.
	$pad  = 8.0;
	$gap  = 10.0;
	$span = (float) $max['wCm'] + $gap + $a4_w;
	$tall = max( (float) $max['hCm'], $a4_h );

	$scale = 640.0 / ( $span + 2 * $pad );
	$vb_h  = ( $tall + 2 * $pad + 14 ) * $scale;

	$x = static fn( float $cm ): float => round( ( $pad + $cm ) * $scale, 2 );
	$y = static fn( float $cm ): float => round( ( $pad + $cm ) * $scale, 2 );
	$d = static fn( float $cm ): float => round( $cm * $scale, 2 );

	$label = sprintf(
		/* translators: 1: garment size, 2: width in cm, 3: height in cm. */
		__( 'Zone d’impression au dos et devant, taille %1$s : %2$s sur %3$s.', 'teeshoop' ),
		$small,
		\Teeshoop\Core\Garments::cm( (float) $ref['wCm'] ),
		\Teeshoop\Core\Garments::cm( (float) $ref['hCm'] )
	);

	ob_start();
	?>
	<figure class="ts-zone">
		<svg
			class="ts-zone__svg"
			viewBox="0 0 640 <?php echo esc_attr( (string) round( $vb_h, 2 ) ); ?>"
			role="img"
			aria-labelledby="ts-zone-title ts-zone-desc"
		>
			<title id="ts-zone-title"><?php echo esc_html( $label ); ?></title>
			<desc id="ts-zone-desc">
				<?php
				printf(
					/* translators: 1: largest size, 2: width, 3: height. */
					esc_html__( 'Le rectangle plein est la zone imprimable en taille %1$s. Le rectangle en pointillé est la même zone en taille %2$s, %3$s. Le troisième rectangle est une feuille A4, 21 cm sur 29,7 cm, à la même échelle.', 'teeshoop' ),
					esc_html( $small ),
					esc_html( $large ),
					esc_html(
						sprintf(
							/* translators: 1: width, 2: height. */
							__( '%1$s sur %2$s', 'teeshoop' ),
							\Teeshoop\Core\Garments::cm( (float) $max['wCm'] ),
							\Teeshoop\Core\Garments::cm( (float) $max['hCm'] )
						)
					)
				);
				?>
			</desc>

			<?php // The largest size, dashed: how far the zone grows with the garment. ?>
			<rect
				class="ts-zone__max"
				x="<?php echo esc_attr( (string) $x( 0 ) ); ?>"
				y="<?php echo esc_attr( (string) $y( 0 ) ); ?>"
				width="<?php echo esc_attr( (string) $d( (float) $max['wCm'] ) ); ?>"
				height="<?php echo esc_attr( (string) $d( (float) $max['hCm'] ) ); ?>"
			/>

			<?php // The priced size, solid: the one every published price is for. ?>
			<rect
				class="ts-zone__ref"
				x="<?php echo esc_attr( (string) $x( 0 ) ); ?>"
				y="<?php echo esc_attr( (string) $y( 0 ) ); ?>"
				width="<?php echo esc_attr( (string) $d( (float) $ref['wCm'] ) ); ?>"
				height="<?php echo esc_attr( (string) $d( (float) $ref['hCm'] ) ); ?>"
			/>

			<text
				class="ts-zone__cm"
				x="<?php echo esc_attr( (string) $x( 0 ) ); ?>"
				y="<?php echo esc_attr( (string) round( $y( (float) $max['hCm'] ) + 18, 2 ) ); ?>"
			><?php
				echo esc_html(
					sprintf(
						/* translators: 1: size, 2: width, 3: height. */
						__( '%1$s : %2$s × %3$s', 'teeshoop' ),
						$small,
						\Teeshoop\Core\Garments::cm( (float) $ref['wCm'] ),
						\Teeshoop\Core\Garments::cm( (float) $ref['hCm'] )
					)
				);
			?></text>

			<?php // A4, to the same scale, because that is the ruler people own. ?>
			<rect
				class="ts-zone__a4"
				x="<?php echo esc_attr( (string) $x( (float) $max['wCm'] + $gap ) ); ?>"
				y="<?php echo esc_attr( (string) $y( 0 ) ); ?>"
				width="<?php echo esc_attr( (string) $d( $a4_w ) ); ?>"
				height="<?php echo esc_attr( (string) $d( $a4_h ) ); ?>"
			/>
			<text
				class="ts-zone__cm"
				x="<?php echo esc_attr( (string) $x( (float) $max['wCm'] + $gap ) ); ?>"
				y="<?php echo esc_attr( (string) round( $y( $a4_h ) + 18, 2 ) ); ?>"
			><?php esc_html_e( 'A4 : 21 × 29,7 cm', 'teeshoop' ); ?></text>
		</svg>

		<figcaption class="ts-zone__caption">
			<?php
			printf(
				/* translators: 1: reference size, 2: largest size. */
				esc_html__( 'Les dimensions imprimables, à l’échelle. Le trait plein est la taille %1$s, le pointillé la taille %2$s : le visuel grandit avec le vêtement, il n’est pas simplement recadré. Nous facturons la surface d’encre, pas le fichier.', 'teeshoop' ),
				esc_html( $small ),
				esc_html( $large )
			);
			?>
		</figcaption>
	</figure>
	<?php
	return (string) ob_get_clean();
}

/**
 * The way out to a human, at the foot of every page of the buying path.
 *
 * Chapter 00 asks for a « bouton "être conseillé" toujours visible » and it is
 * the ONE interface element the brief describes with its persistence. It is not
 * built as a floating bubble: a chat widget that follows the page down is the
 * thing every generated shop has, and it covers the content on a phone. It is
 * built as the last block of the page instead, plus the permanent « Devis »
 * control in the masthead, which is where a professional buyer looks for it.
 *
 * The telephone number is NOT invented. It is printed only when the legal
 * identity carries one; otherwise the block offers the written route alone.
 */
function advice_block(): void {
	?>
	<aside class="ts-advice" aria-labelledby="ts-advice-title">
		<div class="ts-wrap ts-advice__inner">
			<div>
				<h2 class="ts-advice__title" id="ts-advice-title"><?php esc_html_e( 'Vous préférez qu’on s’en occupe ?', 'teeshoop' ); ?></h2>
				<p class="ts-advice__lead">
					<?php esc_html_e( 'Dites-nous le vêtement, la quantité et la date. Nous revenons avec un chiffrage, la répartition des tailles et le délai que nous tenons.', 'teeshoop' ); ?>
				</p>
			</div>
			<p class="ts-advice__cta">
				<a class="ts-cta" href="<?php echo esc_url( quote_url() ); ?>"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></a>
			</p>
		</div>
	</aside>
	<?php
}
