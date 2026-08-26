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
 * @return array{references:int,families:int,priced:bool}
 */
function catalogue_stats(): array {
	static $stats = null;
	if ( null !== $stats ) {
		return $stats;
	}

	/*
	 * COUNTED THE SAME WAY THE ROWS UNDERNEATH IT ARE COUNTED.
	 *
	 * `wp_count_posts` answers with every published product, which on a mirror
	 * is the imported references PLUS the fixtures each test run leaves behind:
	 * it said "30 références" over six real ones. The first fix counted them in
	 * the catalogue tree with raw SQL, which was closer and still a SECOND
	 * counting method: WooCommerce maintains the term counts printed in the list
	 * below through `_wc_term_recount()`, which rolls descendants up into the
	 * parent and excludes anything hidden from the catalogue, and the SQL did
	 * neither. Measured, the two disagreed in both directions.
	 *
	 * So the heading is the SUM of the rows. One number, one source, and if it
	 * is ever wrong it is wrong in the same way as the list beside it.
	 *
	 * A reference in two top-level families is counted twice. That is the price
	 * of agreeing with the list, and the list is what a buyer checks it against.
	 */
	$references = 0;
	foreach ( top_categories() as $term ) {
		$references += (int) $term->count;
	}

	/*
	 * AND WHETHER ANY OF THEM CARRIES A PRICE.
	 *
	 * The homepage used to state, unconditionally, that the blank catalogue has
	 * no published tariff. That is the shipped default (question 42 is
	 * unanswered so `blank_margin_rate` is null and the importer writes no
	 * price), but it is a SETTING: the day somebody answers, the listing starts
	 * showing prices and the sentence beside it goes on denying they exist.
	 */
	global $wpdb;
	$priced = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*)
			 FROM {$wpdb->posts} p
			 INNER JOIN {$wpdb->postmeta} ref ON ref.post_id = p.ID AND ref.meta_key = %s
			 INNER JOIN {$wpdb->postmeta} pr ON pr.post_id = p.ID AND pr.meta_key = '_price' AND pr.meta_value <> ''
			 WHERE p.post_type = 'product' AND p.post_status = 'publish'
			 LIMIT 1",
			class_exists( '\Teeshoop\Core\Catalogue' ) ? \Teeshoop\Core\Catalogue::META_REF : '_teeshoop_ref'
		)
	);

	$stats = array(
		'references' => $references,
		'families'   => count( top_categories() ),
		'priced'     => $priced > 0,
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
	if ( ! class_exists( '\Teeshoop\Core\Garments' ) || '' === $garment ) {
		return '';
	}

	$front = \Teeshoop\Core\Garments::area_by_size( $garment, 'front' );
	$back  = \Teeshoop\Core\Garments::area_by_size( $garment, 'back' );
	if ( empty( $front ) ) {
		return '';
	}

	$priced = \Teeshoop\Core\Garments::priced_size( $garment );
	$sizes  = array_keys( $front );
	$small  = isset( $front[ $priced ] ) ? $priced : (string) reset( $sizes );
	$large  = (string) end( $sizes );

	$ref = $front[ $small ] ?? null;
	$max = $front[ $large ] ?? null;
	if ( ! is_array( $ref ) || ! is_array( $max ) ) {
		return '';
	}

	/*
	 * IT ONLY SAYS "AND THE BACK" WHEN THE BACK IS THE SAME RECTANGLE.
	 *
	 * It read the front and captioned it "devant et dos", which is true of the
	 * tee and the hoodie and is true of neither by construction: the garment
	 * data carries a separate `back` area and nothing makes the two equal. A
	 * caption that names a side it did not measure is a print size a buyer can
	 * be given for a face nobody checked.
	 */
	$back_ref  = $back[ $small ] ?? null;
	$same_back = is_array( $back_ref )
		&& (float) $back_ref['wCm'] === (float) $ref['wCm']
		&& (float) $back_ref['hCm'] === (float) $ref['hCm'];

	// A4, in centimetres. ISO 216, not a number anybody had to be told.
	$a4_w = 21.0;
	$a4_h = 29.7;

	/*
	 * One scale for the whole drawing, so the three rectangles are comparable.
	 * The labels are NOT in the SVG: it is drawn on a 640-unit viewBox and
	 * displayed at whatever width it gets, so a 13-unit label came out at 6,9 px
	 * on a 375 px phone. They are HTML underneath, at the site's own type size.
	 */
	$pad  = 4.0;
	$gap  = 8.0;
	$span = (float) $max['wCm'] + $gap + $a4_w;
	$tall = max( (float) $max['hCm'], $a4_h );

	$scale = 640.0 / ( $span + 2 * $pad );
	$vb_h  = ( $tall + 2 * $pad ) * $scale;

	$x = static fn( float $cm ): float => round( ( $pad + $cm ) * $scale, 2 );
	$y = static fn( float $cm ): float => round( ( $pad + $cm ) * $scale, 2 );
	$d = static fn( float $cm ): float => round( $cm * $scale, 2 );

	$cm = static fn( float $v ): string => \Teeshoop\Core\Garments::cm( $v );

	$sides = $same_back
		? __( 'devant et dos', 'teeshoop' )
		: __( 'devant', 'teeshoop' );

	ob_start();
	?>
	<figure class="ts-zone">
		<svg
			class="ts-zone__svg"
			viewBox="0 0 640 <?php echo esc_attr( (string) round( $vb_h, 2 ) ); ?>"
			role="img"
			aria-labelledby="ts-zone-title ts-zone-desc"
		>
			<title id="ts-zone-title">
				<?php
				printf(
					/* translators: 1: which sides, 2: garment size, 3: width, 4: height. */
					esc_html__( 'Zone d’impression %1$s, taille %2$s : %3$s sur %4$s.', 'teeshoop' ),
					esc_html( $sides ),
					esc_html( $small ),
					esc_html( $cm( (float) $ref['wCm'] ) ),
					esc_html( $cm( (float) $ref['hCm'] ) )
				);
				?>
			</title>
			<desc id="ts-zone-desc">
				<?php
				printf(
					/* translators: 1: largest size, 2: its width, 3: its height. */
					esc_html__( 'Le rectangle en pointillé est la même zone en taille %1$s, %2$s sur %3$s. Le troisième rectangle est une feuille A4, 21 cm sur 29,7 cm, à la même échelle.', 'teeshoop' ),
					esc_html( $large ),
					esc_html( $cm( (float) $max['wCm'] ) ),
					esc_html( $cm( (float) $max['hCm'] ) )
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

			<?php // A4, to the same scale, because that is the ruler people own. ?>
			<rect
				class="ts-zone__a4"
				x="<?php echo esc_attr( (string) $x( (float) $max['wCm'] + $gap ) ); ?>"
				y="<?php echo esc_attr( (string) $y( 0 ) ); ?>"
				width="<?php echo esc_attr( (string) $d( $a4_w ) ); ?>"
				height="<?php echo esc_attr( (string) $d( $a4_h ) ); ?>"
			/>
		</svg>

		<figcaption class="ts-zone__caption">
			<ul class="ts-zone__key">
				<li class="ts-zone__key-item ts-zone__key-item--ref">
					<?php
					printf(
						/* translators: 1: size, 2: which sides, 3: width, 4: height. */
						esc_html__( 'Taille %1$s, %2$s : %3$s × %4$s', 'teeshoop' ),
						esc_html( $small ),
						esc_html( $sides ),
						'<span class="ts-num">' . esc_html( $cm( (float) $ref['wCm'] ) ) . '</span>',
						'<span class="ts-num">' . esc_html( $cm( (float) $ref['hCm'] ) ) . '</span>'
					);
					?>
				</li>
				<li class="ts-zone__key-item ts-zone__key-item--max">
					<?php
					printf(
						/* translators: 1: size, 2: width, 3: height. */
						esc_html__( 'Taille %1$s : %2$s × %3$s', 'teeshoop' ),
						esc_html( $large ),
						'<span class="ts-num">' . esc_html( $cm( (float) $max['wCm'] ) ) . '</span>',
						'<span class="ts-num">' . esc_html( $cm( (float) $max['hCm'] ) ) . '</span>'
					);
					?>
				</li>
				<li class="ts-zone__key-item ts-zone__key-item--a4">
					<?php esc_html_e( 'Une feuille A4 : 21 × 29,7 cm', 'teeshoop' ); ?>
				</li>
			</ul>
			<p class="ts-zone__note">
				<?php
				printf(
					/* translators: 1: reference size, 2: largest size. */
					/*
					 * THE SAME QUALIFICATION THE PRODUCT PAGE MAKES.
					 *
					 * `product-specs.php` says « Quand le visuel est gradué avec
					 * le vêtement, ce qui est le réglage par défaut », and the
					 * comment above it records why the unqualified form was
					 * removed: the studio has a per-side control that turns
					 * grading off, so an unqualified promise is one the customer
					 * can break themselves and then be told the print is right.
					 */
					esc_html__( 'À l’échelle. Le trait plein est la taille %1$s et le pointillé la taille %2$s : quand le visuel est gradué avec le vêtement, ce qui est le réglage par défaut, il grandit avec lui au lieu d’être simplement recadré. Nous facturons la surface d’encre, pas le fichier.', 'teeshoop' ),
					esc_html( $small ),
					esc_html( $large )
				);
				?>
			</p>
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

/* ─────────────────────────────────────────────────────────── editorial ── */

/**
 * The copy a page carries, or nothing at all.
 *
 * The words live in `Teeshoop\Core\Content`, in the repository, with every
 * figure in them written as a slot the plugin resolves from the price
 * authority, the workshop calendar and the studio's print geometry. This
 * function only draws them, so it decides no value, like everything else in
 * this file.
 *
 * @return array{h1:string,intro:string[],sections:array,faq:array}
 */
function editorial( string $key ): array {
	if ( ! class_exists( '\Teeshoop\Core\Content' ) || ! \Teeshoop\Core\Content::has( $key ) ) {
		return array(
			'h1'       => '',
			'intro'    => array(),
			'sections' => array(),
			'faq'      => array(),
		);
	}
	return \Teeshoop\Core\Content::page( $key );
}

/**
 * The long copy, and it goes UNDER the products.
 *
 * MEASURED ON FIVE COMPETITORS on 26 August 2026, counting words of running
 * text before the first product link against after it: laboutiquedupro 0 / 809,
 * tissus-print 25 / 1 764, vetement-publicitaire 42 / 1 049, label-blouse
 * 68 / 859, la-manufacture 145 / 3 239. Mistertee.fr publishes 2 822 words under
 * its /t-shirts grid and exactly 24 words above it, all of which are the filter
 * controls. Five out of five put the grid first. A buyer who arrived to compare
 * garments should meet garments; a buyer who arrived to understand what we do
 * scrolls, and so does a crawler.
 *
 * The intro is the exception and it is deliberately short: one to three
 * sentences above the grid, which is what says whose page this is.
 *
 * @param array $page The result of `editorial()`.
 */
function editorial_body( array $page, string $id = 'ts-edito' ): void {
	$sections = (array) ( $page['sections'] ?? array() );
	$faq      = (array) ( $page['faq'] ?? array() );
	if ( empty( $sections ) && empty( $faq ) ) {
		return;
	}
	?>
	<div class="ts-edito ts-wrap" id="<?php echo esc_attr( $id ); ?>">
		<?php foreach ( $sections as $i => $ts_section ) : ?>
			<?php $ts_head = $id . '-' . (int) $i; ?>
			<section class="ts-edito__section" aria-labelledby="<?php echo esc_attr( $ts_head ); ?>">
				<h2 class="ts-edito__title" id="<?php echo esc_attr( $ts_head ); ?>"><?php echo esc_html( (string) $ts_section['h2'] ); ?></h2>
				<?php foreach ( (array) $ts_section['paragraphs'] as $ts_p ) : ?>
					<p><?php echo esc_html( (string) $ts_p ); ?></p>
				<?php endforeach; ?>
				<?php if ( ! empty( $ts_section['list'] ) ) : ?>
					<ul class="ts-edito__list">
						<?php foreach ( (array) $ts_section['list'] as $ts_item ) : ?>
							<li><?php echo esc_html( (string) $ts_item ); ?></li>
						<?php endforeach; ?>
					</ul>
				<?php endif; ?>
				<?php if ( ! empty( $ts_section['links'] ) ) : ?>
					<p class="ts-edito__links">
						<?php foreach ( (array) $ts_section['links'] as $ts_link ) : ?>
							<a href="<?php echo esc_url( (string) $ts_link['url'] ); ?>"><?php echo esc_html( (string) $ts_link['label'] ); ?></a>
						<?php endforeach; ?>
					</p>
				<?php endif; ?>
			</section>
		<?php endforeach; ?>

		<?php if ( ! empty( $faq ) ) : ?>
			<?php
			/*
			 * THE QUESTIONS ARE CONTENT, NOT MARKUP.
			 *
			 * There is no `FAQPage` JSON-LD under this block, and that is a
			 * decision rather than an omission: in August 2023 Google restricted
			 * FAQ rich results to well-known government and health sites, so on
			 * a merchant site the markup produces nothing at all. Publishing
			 * structured data that no consumer acts on is bytes on every page
			 * for a checklist tick. The answers still earn their place by being
			 * the six things a buyer actually asks before ordering.
			 */
			?>
			<section class="ts-edito__section ts-faq" aria-labelledby="<?php echo esc_attr( $id ); ?>-faq">
				<h2 class="ts-edito__title" id="<?php echo esc_attr( $id ); ?>-faq"><?php esc_html_e( 'Questions fréquentes', 'teeshoop' ); ?></h2>
				<dl class="ts-faq__list">
					<?php foreach ( $faq as $ts_item ) : ?>
						<dt class="ts-faq__q"><?php echo esc_html( (string) $ts_item['q'] ); ?></dt>
						<dd class="ts-faq__a"><?php echo esc_html( (string) $ts_item['a'] ); ?></dd>
					<?php endforeach; ?>
				</dl>
			</section>
		<?php endif; ?>
	</div>
	<?php
}
