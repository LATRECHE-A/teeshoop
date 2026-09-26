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
	$sides = zone_sides( $garment, $small );

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
				<?php foreach ( (array) ( $ts_section['after'] ?? array() ) as $ts_p ) : ?>
					<p><?php echo esc_html( (string) $ts_p ); ?></p>
				<?php endforeach; ?>
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

/**
 * Les faces qu'un rectangle de devant décrit vraiment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI C'EST UNE FONCTION ET PAS UNE PHRASE ÉCRITE DANS LE GABARIT.
 *
 * Trois endroits de la page d'accueil publient la zone d'impression : la tuile
 * des chiffres, le dessin à l'échelle, et le vêtement du bandeau. Tous les
 * trois mesurent le DEVANT, et la question « puis-je aussi dire "et le dos" »
 * n'a qu'une bonne réponse : oui si le dos est le même rectangle, non sinon.
 *
 * MESURÉ LE 9 SEPTEMBRE 2026, la tuile des chiffres l'écrivait sans condition :
 *
 *   tee    taille M : devant 30,5 x 40,6   dos 30,5 x 40,6   identiques
 *   sweat  taille M : devant 30,5 x 30,5   dos 30,5 x 35,6   NON identiques
 *
 * Sur une boutique dont le premier produit personnalisable est un sweat, la
 * page d'accueil annonçait donc « 30,5 x 30,5 cm, devant et dos » alors que le
 * dos accepte 5,1 cm de plus. Un acheteur qui dimensionne son marquage de dos
 * sur ce chiffre perd 14 % de la hauteur qu'il paie, et personne ne le lui dit.
 * Le dessin à l'échelle, lui, avait la bonne règle depuis le début, avec le
 * commentaire qui l'explique : c'était la SECONDE implémentation qui était
 * fausse, exactement la panne que la maison interdit.
 *
 * SANS MESURE DU DOS, ON NE PROMET QUE LE DEVANT. « Je n'ai pas pu regarder »
 * n'est pas « c'est pareil ».
 */
function zone_sides( string $garment, string $size ): string {
	$devant = __( 'devant', 'teeshoop' );
	/*
	 * `method_exists` ET PAS SEULEMENT `class_exists`, à cause d'une fenêtre du
	 * déploiement. `deploiement.sh` échange l'extension puis le thème, ce qui est
	 * le bon ordre à l'aller ; `retour` défait dans le même ordre, donc il
	 * repose l'ANCIENNE extension avant l'ancien thème et laisse, le temps de
	 * deux renommages, un thème neuf devant une extension qui n'a ni
	 * `same_back()` ni `art()`. Une classe présente et une méthode absente est
	 * une erreur fatale, c'est-à-dire une page blanche sur l'accueil pendant une
	 * marche arrière, qui est exactement le moment où l'on ne veut pas d'une
	 * seconde panne.
	 */
	if ( '' === $garment || '' === $size
		|| ! class_exists( '\Teeshoop\Core\Garments' )
		|| ! method_exists( '\Teeshoop\Core\Garments', 'same_back' ) ) {
		return $devant;
	}

	// LA MESURE EST DANS L'EXTENSION, la phrase est ici. Ce fichier ne décide
	// aucune valeur, c'est la règle de son en-tête.
	return \Teeshoop\Core\Garments::same_back( $garment, $size )
		? __( 'devant et dos', 'teeshoop' )
		: $devant;
}

/**
 * Le vêtement dont toute la page d'accueil parle, décidé UNE fois.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEUX APPELS DIFFÉRENTS POUR LA MÊME QUESTION, C'EST DÉJÀ UN DE TROP.
 *
 * Le gabarit lisait `personalisable_products( 8 )[0]` et `demo_source()` lisait
 * `personalisable_products( 1 )[0]`. Ce n'est pas la même question : la fonction
 * demande N lignes à la base PUIS jette celles qui n'ont pas de photographie,
 * donc avec une limite de 1, un premier produit sans photo rend une liste VIDE,
 * là où une limite de 8 rend le suivant. La démonstration disparaissait alors de
 * la page sans un mot, sur une boutique qui avait pourtant un vêtement à
 * montrer.
 *
 * Les deux ne se contredisaient pas sur l'IDENTITÉ du produit, et c'est le
 * genre de chose qui n'est vraie que par chance : le prix, le bouton, la zone
 * et le dessin doivent décrire le même vêtement, et la seule façon de s'en
 * assurer est qu'une seule ligne de code choisisse.
 */
function hero_product(): ?\WC_Product {
	return personalisable_products( 8 )[0] ?? null;
}

/* ──────────────────────────────────────────────────── la démonstration ── */

/**
 * Le vêtement de la page d'accueil, sa palette et sa zone d'impression.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * C'EST LE VÊTEMENT DU BANDEAU OU RIEN, ET JAMAIS UN AUTRE.
 *
 * Le prix affiché en haut de page, le bouton « Personnaliser » et la zone
 * d'impression décrivent tous `hero_product()`, et c'est pour ça que cette
 * fonction l'appelle au lieu de refaire la requête. Si elle
 * cherchait « le premier produit qui sait porter une démonstration », un
 * catalogue dont le premier article n'a pas de nuancier ferait dessiner le
 * sweat pendant que le prix reste celui du t-shirt : c'est exactement la panne
 * que l'en-tête de `front-page.php` raconte, et elle avait coûté à un acheteur
 * un logo dimensionné sur le mauvais dessin. Donc on prend le premier, et s'il
 * ne peut pas être dessiné on ne dessine pas.
 *
 * QUATRE CHOSES DOIVENT ÊTRE VRAIES EN MÊME TEMPS, et chacune est une raison
 * suffisante de renoncer :
 *   1. le produit déclare un vêtement du studio ;
 *   2. ce vêtement a un dessin teintable (`Garments::art`) ;
 *   3. le produit publie un nuancier MESURÉ d'au moins deux coloris, sinon le
 *      sélecteur serait un contrôle qui ne change rien ;
 *   4. la taille tarifée est mesurée, sinon la zone serait un rectangle sans
 *      légende, c'est-à-dire une taille d'impression inventée.
 *
 * @return array{product:\WC_Product,garment:string,art:array,palette:array,area:array,size:string,tint:string}|array{}
 */
function demo_source(): array {
	static $demo = null;
	if ( null !== $demo ) {
		return $demo;
	}
	$demo = array();

	// Même fenêtre de déploiement que `zone_sides()` : sans `art()` on ne dessine
	// pas, et le bandeau retombe sur la photographie au lieu d'une page blanche.
	if ( ! class_exists( '\Teeshoop\Core\Garments' )
		|| ! method_exists( '\Teeshoop\Core\Garments', 'art' )
		|| ! class_exists( '\Teeshoop\Core\Product' ) ) {
		return $demo;
	}

	$product = hero_product();
	if ( ! $product instanceof \WC_Product ) {
		return $demo;
	}

	$garment = \Teeshoop\Core\Product::garment_of( $product->get_id() );
	if ( '' === $garment ) {
		return $demo;
	}

	$art = \Teeshoop\Core\Garments::art( $garment, 'front' );
	if ( array() === $art ) {
		return $demo;
	}

	/*
	 * LE NUANCIER MESURÉ, PAS CELUI DE L'ÉDITEUR.
	 *
	 * `META_BLANK_PALETTE` répond à « qu'est-ce que le client REGARDE » : ce
	 * sont les pastilles relevées sur les puces du fabricant pour CE produit.
	 * Les dix-huit teintes de démonstration du studio (`Garments::colors()`)
	 * répondraient à une autre question, et le 4 septembre 2026 les deux
	 * différaient assez pour qu'un client choisisse un rose qui n'existe pas.
	 */
	$palette = array_values(
		array_filter(
			\Teeshoop\Core\Product::blank_palette_of( $product->get_id() ),
			static fn( array $c ): bool => '' !== (string) ( $c['id'] ?? '' )
				&& '' !== (string) ( $c['name'] ?? '' )
				&& '' !== (string) ( $c['stops'][0] ?? '' )
		)
	);
	if ( count( $palette ) < 2 ) {
		return $demo;
	}

	$size  = \Teeshoop\Core\Garments::priced_size( $garment );
	$areas = \Teeshoop\Core\Garments::area_by_size( $garment, 'front' );
	if ( ! isset( $areas[ $size ]['wCm'], $areas[ $size ]['hCm'] ) ) {
		return $demo;
	}

	/*
	 * LA TEINTE D'OUVERTURE, ET POURQUOI CE N'EST PAS « LA PREMIÈRE ».
	 *
	 * Il en faut une, et l'ordre du nuancier est celui du fournisseur : sur ce
	 * catalogue il commence par « Red », ce qui ouvre la page d'accueil sur un
	 * t-shirt rouge vif. On prend le premier des trois coloris sombres et
	 * neutres qui est réellement proposé, parce que le tracé pointillé de la
	 * zone se lit mieux dessus que sur un vif et que ce sont les trois teintes
	 * qu'une entreprise commande le plus souvent. Si aucun des trois n'est au
	 * catalogue de ce produit, on retombe sur le premier et la page reste juste.
	 */
	$tint = (string) $palette[0]['stops'][0];
	foreach ( array( 'navy', 'black', 'white' ) as $prefere ) {
		foreach ( $palette as $couleur ) {
			if ( $prefere === $couleur['id'] ) {
				$tint = (string) $couleur['stops'][0];
				break 2;
			}
		}
	}

	$demo = array(
		'product' => $product,
		'garment' => $garment,
		'art'     => $art,
		'palette' => $palette,
		'area'    => $areas[ $size ],
		'size'    => $size,
		'tint'    => $tint,
	);
	return $demo;
}

/**
 * Une règle CSS par coloris, parce que le sélecteur doit marcher sans script.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI DU CSS ENGENDRÉ ET PAS UNE LIGNE DE JAVASCRIPT.
 *
 * CSS ne sait pas lire une valeur sur un élément voisin : pour peindre le
 * vêtement avec la couleur du bouton coché, il faut une règle par couleur. Ce
 * sont dix-sept règles d'environ soixante-dix octets, écrites une fois dans
 * l'en-tête, et le prix à payer pour que le nuancier fonctionne sur une page
 * dont le script est bloqué. `style-src` porte `'unsafe-inline'` (voir l'en-tête
 * de `Csp.php`, qui explique pourquoi il ne partira pas) et les 442 pastilles de
 * `facet-couleur.php` roulent déjà dessus, donc ceci ne relâche aucune règle.
 *
 * IL N'Y A PAS DE NONCE ICI, et c'est exact plutôt qu'oublié : la politique ne
 * met de nonce que dans `script-src`. En poser un dans une balise de style
 * n'ajouterait rien, et en ajouter un à la DIRECTIVE désactiverait
 * `'unsafe-inline'` pour toute la boutique, donc les pastilles du filtre.
 */
function demo_css(): string {
	$demo = demo_source();
	if ( array() === $demo ) {
		return '';
	}

	$css = array( ':root{--ts-demo-tint:' . $demo['tint'] . ';}' );
	foreach ( $demo['palette'] as $couleur ) {
		$id  = sanitize_html_class( (string) $couleur['id'] );
		$hex = (string) $couleur['stops'][0];
		if ( '' === $id || 1 !== preg_match( '/^#[0-9a-fA-F]{3,8}$/', $hex ) ) {
			// Une valeur qu'on n'a pas su lire ne devient pas une déclaration.
			continue;
		}
		$css[] = '.ts-demo:has(#ts-demo-c-' . $id . ':checked){--ts-demo-tint:' . $hex . ';}';
	}
	return implode( "\n", $css );
}

/**
 * Le vêtement, sa zone d'impression à l'échelle et son nuancier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CE BLOC PROUVE, ET QUE NI MISTERTEE NI TOSTADORA NE PUBLIENT.
 *
 * Deux questions qu'un acheteur se pose avant tout le reste : « est-ce que mon
 * logo rentre » et « à quoi ça ressemble sur un vêtement foncé ». Le rectangle
 * répond à la première, en centimètres, sur le vêtement, à l'échelle ; le
 * nuancier répond à la seconde. Relevé le 19 août 2026 : aucun des deux
 * concurrents ne donne une seule dimension d'impression sur une fiche produit.
 *
 * RIEN ICI N'EST DESSINÉ À LA MAIN. Le vêtement vient de
 * `src/garments/tee.ts`, la même définition qui sert à composer les aperçus de
 * l'éditeur ; le rectangle vient du même fichier, dans le même repère, donc il
 * ne peut pas montrer une zone que la presse n'imprime pas ; les centimètres
 * viennent de `Garments::area_by_size()` et le test
 * `tests/test-garments.php` refait la conversion des uns vers les autres.
 *
 * LES COTES SONT EN HTML ET PAS DANS LE SVG, pour la raison écrite dans
 * `print_zone_figure()` : le dessin est tracé sur 800 unités et affiché à la
 * largeur qu'on lui donne, donc un texte de 13 unités sortait à 6,9 px sur un
 * téléphone. Le rectangle est positionné en pourcentages du repère, calculés
 * ici, et sa légende est du texte à la taille du site.
 */
function garment_demo(): string {
	$demo = demo_source();
	if ( array() === $demo ) {
		return '';
	}

	$art  = $demo['art'];
	$rect = $art['printAreaPx'];

	/*
	 * Le repère du dessin fait 800 unités de côté (`GARMENT_VIEW`), et c'est le
	 * dessin lui-même qui le déclare. On le relit dans son `viewBox` plutôt que
	 * de l'écrire ici : le jour où le studio redessine sur un autre repère, un
	 * nombre écrit en dur décalerait la zone sans que rien ne le dise.
	 */
	$view = 800.0;
	if ( preg_match( '/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/', $art['body'], $m ) ) {
		$view = (float) $m[1];
	}
	if ( $view <= 0 ) {
		return '';
	}

	$pct = static fn( float $v ): string => (string) round( $v / $view * 100, 4 );

	// Le jeton de teinte devient la propriété que le nuancier fait varier.
	$body = str_replace( '__COLOR__', 'var(--ts-demo-tint)', $art['body'] );

	$cm     = static fn( float $v ): string => \Teeshoop\Core\Garments::cm( $v );
	$w_cm   = $cm( (float) $demo['area']['wCm'] );
	$h_cm   = $cm( (float) $demo['area']['hCm'] );
	$titre  = $demo['product']->get_name();
	$ouvert = studio_url( $demo['product']->get_id() );

	ob_start();
	?>
	<figure class="ts-demo" data-teeshoop="demo-accueil">
		<div class="ts-demo__stage">
			<?php
			/*
			 * `aria-hidden` sur le dessin, et la description est portée par la
			 * légende en dessous : un lecteur d'écran qui annonce « dessin d'un
			 * t-shirt » puis lit la même chose en toutes lettres dit deux fois
			 * la même tuile, ce que WCAG 1.1.1 appelle décoratif.
			 */
			?>
			<svg class="ts-demo__svg" viewBox="0 0 <?php echo esc_attr( (string) $view ); ?> <?php echo esc_attr( (string) $view ); ?>" aria-hidden="true" focusable="false">
				<?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- SVG engendré par scripts/gen-garment-data.mjs depuis les sources du studio, sans donnée extérieure. ?>
			</svg>

			<div
				class="ts-demo__zone"
				style="--z-x:<?php echo esc_attr( $pct( (float) $rect['x'] ) ); ?>%;--z-y:<?php echo esc_attr( $pct( (float) $rect['y'] ) ); ?>%;--z-w:<?php echo esc_attr( $pct( (float) $rect['w'] ) ); ?>%;--z-h:<?php echo esc_attr( $pct( (float) $rect['h'] ) ); ?>%"
			>
				<span class="ts-demo__dim ts-num">
					<?php
					printf(
						/* translators: 1: largeur en cm, 2: hauteur en cm. */
						esc_html__( '%1$s × %2$s', 'teeshoop' ),
						esc_html( $w_cm ),
						esc_html( $h_cm )
					);
					?>
				</span>
			</div>
		</div>

		<fieldset class="ts-demo__colours">
			<legend class="ts-demo__legend">
				<?php
				printf(
					/* translators: %s: nombre de coloris. */
					esc_html( _n( '%s coloris au catalogue', '%s coloris au catalogue', count( $demo['palette'] ), 'teeshoop' ) ),
					esc_html( num( (float) count( $demo['palette'] ) ) )
				);
				?>
			</legend>
			<div class="ts-demo__swatches">
				<?php foreach ( $demo['palette'] as $ts_couleur ) : ?>
					<?php
					$ts_id  = sanitize_html_class( (string) $ts_couleur['id'] );
					$ts_hex = (string) $ts_couleur['stops'][0];
					if ( '' === $ts_id || 1 !== preg_match( '/^#[0-9a-fA-F]{3,8}$/', $ts_hex ) ) {
						continue;
					}
					?>
					<span class="ts-demo__swatch">
						<input
							class="ts-demo__radio"
							type="radio"
							name="ts-demo-coloris"
							id="ts-demo-c-<?php echo esc_attr( $ts_id ); ?>"
							value="<?php echo esc_attr( $ts_id ); ?>"
							data-tint="<?php echo esc_attr( $ts_hex ); ?>"
							<?php checked( $ts_hex, $demo['tint'] ); ?>
						>
						<label class="ts-demo__chip" for="ts-demo-c-<?php echo esc_attr( $ts_id ); ?>" style="--chip:<?php echo esc_attr( $ts_hex ); ?>">
							<span class="ts-demo__chip-name"><?php echo esc_html( (string) $ts_couleur['name'] ); ?></span>
						</label>
					</span>
				<?php endforeach; ?>
			</div>
		</fieldset>

		<figcaption class="ts-demo__note">
			<span class="ts-demo__who"><?php echo esc_html( $titre ); ?></span>
			<?php
			/*
			 * LES DEUX PHRASES QUI EMPÊCHENT CE DESSIN DE MENTIR.
			 *
			 * La première dit à quelle taille le rectangle est mesuré : sans
			 * elle, un acheteur en 3XL dimensionnerait son logo sur la zone du
			 * M, qui est 7 cm plus étroite. La seconde dit que la couleur est
			 * une mesure de la puce du fabricant et pas une photographie du
			 * tissu, parce qu'un polyester satiné ne rend pas la teinte du
			 * coton teint dans le même bain. C'est le vocabulaire que l'éditeur
			 * emploie déjà (`COPIE.apercuGabarit`), et pas un second.
			 */
			printf(
				/* translators: 1: les faces concernées, 2: la taille tarifée. */
				esc_html__( 'Zone d’impression %1$s en taille %2$s, dessinée à l’échelle sur le vêtement. Le gabarit est peint avec la couleur mesurée sur la puce du fabricant : ce n’est pas une photographie du tissu.', 'teeshoop' ),
				esc_html( zone_sides( $demo['garment'], $demo['size'] ) ),
				esc_html( $demo['size'] )
			);
			?>
			<?php if ( '' !== $ouvert ) : ?>
				<a class="ts-demo__link" href="<?php echo esc_url( $ouvert ); ?>">
					<?php esc_html_e( 'Ouvrir l’atelier sur ce vêtement', 'teeshoop' ); ?>
				</a>
			<?php endif; ?>
		</figcaption>
	</figure>
	<?php
	return (string) ob_get_clean();
}

/**
 * Ce que la boutique prend réellement en charge, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHAQUE LIGNE EST UNE CHOSE QUE LE CODE FAIT AUJOURD'HUI.
 *
 * Le chapitre 00 de la bible liste onze prises en charge (« la sélection du
 * produit, la préparation du fichier, le devis, le paiement, le BAT,
 * l'approvisionnement, la production, le contrôle, la livraison et le
 * réassort »). Ce bloc n'en publie que six, et les absences sont des décisions :
 *
 *   LE RÉASSORT EN UN CLIC N'EST PAS PROPOSÉ. « Commander à nouveau » est
 *   refusé exprès sur un produit personnalisable, parce que
 *   `woocommerce_order_again_cart_item_data` rend un panier vide et remettrait
 *   au panier un vêtement SANS son visuel (voir `ProductPage.php` et le README
 *   du greffon). Ce que la boutique tient vraiment, c'est que la référence et
 *   le nom de coloris du fabricant sont stables d'une année sur l'autre, et
 *   c'est ce que dit déjà le bloc « Pour qui ».
 *
 *   L'URGENCE ET L'EXPRESS NE SONT PAS PUBLIÉS. `ProductionPage.php` est
 *   explicite : « L'express et l'urgence ne le sont pas, précisément parce
 *   qu'ils ne tiennent pas ». Seul le délai standard sort d'ici.
 *
 *   LA PRÉPARATION DU FICHIER n'est pas annoncée comme un service, parce que
 *   rien dans la boutique ne la commande ni ne la facture : elle passe par le
 *   devis, où un humain répond.
 *
 * @param array{references:int,lead:int,minimum:int} $faits Les chiffres déjà lus ailleurs.
 * @return array<int,array{title:string,body:string,url:string,label:string}>
 */
function services( array $faits ): array {
	$catalogue = function_exists( 'wc_get_page_permalink' ) ? (string) wc_get_page_permalink( 'shop' ) : '';
	$demo      = demo_source();
	$atelier   = array() !== $demo ? studio_url( $demo['product']->get_id() ) : '';

	$liste = array();

	if ( $faits['references'] > 0 ) {
		$liste[] = array(
			'title' => __( 'Le choix du vêtement', 'teeshoop' ),
			'body'  => sprintf(
				/* translators: %s: nombre de références publiées. */
				__( '%s références de marques que vos salariés connaissent, avec leur matière, leur grammage, leurs coloris et leurs tailles. Vous filtrez par couleur mesurée, par matière et par grammage, pas par mot-clé.', 'teeshoop' ),
				num( (float) $faits['references'] )
			),
			'url'   => $catalogue,
			'label' => __( 'Parcourir le catalogue', 'teeshoop' ),
		);
	}

	$liste[] = array(
		'title' => __( 'Le dessin, en ligne', 'teeshoop' ),
		'body'  => __( 'Vous déposez votre visuel, vous le placez au centimètre sur le devant, le dos ou la manche, et vous le voyez en 2D et en 3D. Le prix se met à jour pendant que vous placez, à votre quantité, et c’est le serveur qui le calcule.', 'teeshoop' ),
		'url'   => $atelier,
		'label' => __( 'Ouvrir l’atelier', 'teeshoop' ),
	);

	$liste[] = array(
		'title' => __( 'Le devis, quand c’est plus simple à dire', 'teeshoop' ),
		'body'  => __( 'Un projet mal défini, un logo à reprendre, une date à tenir, une répartition de tailles à décider : décrivez-le et nous revenons avec un chiffrage, la répartition et le délai que nous tenons.', 'teeshoop' ),
		'url'   => quote_url(),
		'label' => __( 'Demander un devis', 'teeshoop' ),
	);

	$liste[] = array(
		'title' => __( 'Le bon à tirer', 'teeshoop' ),
		'body'  => __( 'Avant impression, nous envoyons une maquette par face imprimée, avec les dimensions du marquage et sa hauteur sous l’encolure. Rien ne part en production tant que vous ne l’avez pas validé, et la validation se fait en ligne sans créer de compte.', 'teeshoop' ),
		'url'   => '',
		'label' => '',
	);

	$liste[] = array(
		'title' => __( 'L’impression', 'teeshoop' ),
		'body'  => $faits['lead'] > 0
			? sprintf(
				/* translators: %s: nombre de jours ouvrés. */
				__( 'Transfert DTF pressé dans notre atelier, contrôlé pièce par pièce, %s jours ouvrés à partir de votre bon à tirer validé. Nous facturons la surface d’encre et pas la taille du fichier.', 'teeshoop' ),
				num( (float) $faits['lead'] )
			)
			: __( 'Transfert DTF pressé dans notre atelier et contrôlé pièce par pièce. Nous facturons la surface d’encre et pas la taille du fichier.', 'teeshoop' ),
		'url'   => '',
		'label' => '',
	);

	$liste[] = array(
		'title' => __( 'La livraison', 'teeshoop' ),
		'body'  => __( 'Colissimo suivi en France métropolitaine, Corse comprise, au tarif de la grille publique. Pour l’outre-mer ou l’étranger, nous chiffrons le transport avec vous plutôt que d’afficher un prix que nous ne tiendrions pas.', 'teeshoop' ),
		'url'   => '',
		'label' => '',
	);

	return $liste;
}
