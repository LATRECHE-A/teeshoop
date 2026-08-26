<?php
/**
 * The B2B page: what a company gets, and what we need from them.
 *
 * Chapter 00 of the brief describes three campaign families and gives each one
 * its needs AND its arguments, verbatim, with the instruction that they must
 * never share an argument. They are reproduced here rather than rewritten.
 * Separate landing pages per sector are session 11's, which owns SEO; this page
 * is the one a buyer reaches from the navigation.
 *
 * NOTHING ON THIS PAGE IS A CLAIM WE CANNOT BACK. The invoice fields are the
 * ones `Legal::fields()` actually prints; the lead time is the standard one the
 * workshop calendar computes, and only that one; the price grid is the shop's
 * own `Pricing::grid()`, the same table the product page and the basket use.
 *
 * @package Teeshoop\Theme
 */

namespace Teeshoop\Theme;

defined( 'ABSPATH' ) || exit;

get_header();

$ts_min   = minimum();
$ts_lead  = lead_days();
$ts_conf  = pricing_config();
$ts_bases = price_bases();
?>
<div class="ts-wrap ts-prose">
	<p class="ts-eyebrow"><?php esc_html_e( 'Entreprises, associations, collectivités', 'teeshoop' ); ?></p>
	<?php
	/*
	 * The heading a buyer reads is not the title an operator sees in the list of
	 * pages. « Entreprises et associations » names the page in the admin; the h1
	 * carries the words people actually type. `Content` holds it, and the page
	 * falls back to its own title when there is none.
	 */
	$ts_copy = editorial( 'page:entreprises' );
	?>
	<h1 class="ts-prose__title">
		<?php echo esc_html( '' !== $ts_copy['h1'] ? $ts_copy['h1'] : get_the_title() ); ?>
	</h1>

	<p class="ts-lead">
		<?php esc_html_e( 'Vous vous occupez de votre entreprise. Teeshoop s’occupe de votre image textile, de la création à la livraison.', 'teeshoop' ); ?>
	</p>

	<?php
	while ( have_posts() ) :
		the_post();
		the_content();
	endwhile;
	?>
</div>

<section class="ts-section ts-wrap" aria-labelledby="ts-pro-sectors">
	<div class="ts-section__head">
		<h2 id="ts-pro-sectors"><?php esc_html_e( 'Ce que nous faisons le plus souvent', 'teeshoop' ); ?></h2>
	</div>
	<div class="ts-sectors">
		<?php foreach ( sectors() as $ts_sector ) : ?>
			<article class="ts-sector">
				<h3 class="ts-sector__title"><?php echo esc_html( $ts_sector['title'] ); ?></h3>
				<p class="ts-sector__needs"><?php echo esc_html( $ts_sector['needs'] ); ?></p>
				<p class="ts-sector__answer"><?php echo esc_html( $ts_sector['answer'] ); ?></p>
			</article>
		<?php endforeach; ?>
	</div>
</section>

<section class="ts-section ts-wrap" aria-labelledby="ts-pro-admin">
	<div class="ts-section__head">
		<h2 id="ts-pro-admin"><?php esc_html_e( 'Le côté administratif, dit d’avance', 'teeshoop' ); ?></h2>
		<p class="ts-lead"><?php esc_html_e( 'C’est la partie que personne n’affiche et qui décide de la moitié des commandes en entreprise.', 'teeshoop' ); ?></p>
	</div>

	<dl class="ts-defs ts-defs--wide">
		<dt><?php esc_html_e( 'La facture', 'teeshoop' ); ?></dt>
		<dd>
			<?php esc_html_e( 'Établie à votre raison sociale, avec votre SIRET et votre numéro de TVA intracommunautaire, et un numéro dans une série continue. Elle est figée le jour de son émission : elle ne se recalcule pas si un tarif change ensuite.', 'teeshoop' ); ?>
		</dd>

		<dt><?php esc_html_e( 'Le prix', 'teeshoop' ); ?></dt>
		<dd>
			<?php
			$ts_tax = tax_basis_note();
			if ( '' !== $ts_tax ) {
				echo esc_html( $ts_tax ) . ' ';
			}
			esc_html_e( 'Le tarif baisse par paliers de quantité, et le palier atteint est appliqué automatiquement : il n’y a pas de code promotionnel à saisir et pas de remise à demander.', 'teeshoop' );
			?>
		</dd>

		<dt><?php esc_html_e( 'L’acompte', 'teeshoop' ); ?></dt>
		<dd>
			<?php esc_html_e( 'Sur une grosse série, un acompte peut ouvrir la production, le solde restant dû avant expédition. Chaque encaissement est une ligne datée sur la commande et donne lieu à une facture d’acompte numérotée, comme l’article 289 du code général des impôts l’exige.', 'teeshoop' ); ?>
		</dd>

		<dt><?php esc_html_e( 'Le délai', 'teeshoop' ); ?></dt>
		<dd>
			<?php if ( isset( $ts_lead['standard'] ) ) : ?>
				<?php
				printf(
					/* translators: %s: a number of working days. */
					esc_html__( '%s jours ouvrés de fabrication, comptés à partir du moment où vous validez le bon à tirer, pas à partir de la commande. Nous ne publions pas de délai plus court : nous en avons deux au catalogue interne et nous ne les tenons pas encore de façon fiable, alors nous les traitons au cas par cas.', 'teeshoop' ),
					'<span class="ts-num">' . esc_html( num( (float) $ts_lead['standard'] ) ) . '</span>'
				);
				?>
			<?php else : ?>
				<?php esc_html_e( 'Le délai est donné sur le devis, en jours ouvrés, à partir de la validation du bon à tirer.', 'teeshoop' ); ?>
			<?php endif; ?>
		</dd>

		<?php if ( null !== $ts_min ) : ?>
			<dt><?php esc_html_e( 'Le minimum', 'teeshoop' ); ?></dt>
			<dd>
				<?php
				printf(
					/* translators: 1: minimum pieces, 2: minimum order value. */
					esc_html__( '%1$s pièces et %2$s. Le minimum porte sur la commande entière, pas sur chaque ligne : trois t-shirts et trois sweats font six pièces et passent.', 'teeshoop' ),
					'<span class="ts-num">' . esc_html( num( (float) $ts_min['qty'] ) ) . '</span>',
					'<span class="ts-num">' . esc_html( eur( $ts_min['ht_cents'] ) ) . '</span>'
				);
				?>
			</dd>
		<?php endif; ?>

		<dt><?php esc_html_e( 'Les échantillons', 'teeshoop' ); ?></dt>
		<dd>
			<?php esc_html_e( 'Un textile nu peut vous être envoyé avant la série. Ce n’est pas gratuit et ce n’est pas cher : demandez-le dans le devis et le prix vous sera donné avec le reste, jamais découvert sur la facture.', 'teeshoop' ); ?>
		</dd>
	</dl>
</section>

<?php
/*
 * The public grid, for the garment the shop actually prices. The same table the
 * product page prints, from `Pricing::grid()`, because a B2B page carrying its
 * own copy of a price list is how the two stop agreeing.
 */
$ts_products = personalisable_products( 1 );
$ts_first    = $ts_products[0] ?? null;
$ts_garment  = $ts_first instanceof \WC_Product && class_exists( '\\Teeshoop\\Core\\Product' )
	? \Teeshoop\Core\Product::garment_of( $ts_first->get_id() )
	: '';

if ( '' !== $ts_garment && class_exists( '\\Teeshoop\\Core\\Pricing' ) && defined( 'TEESHOOP_CORE_DIR' ) ) :
	$ts_qtys = \Teeshoop\Core\Pricing::grid_qtys( $ts_conf );
	$ts_max  = class_exists( '\\Teeshoop\\Core\\Garments' )
		? max( 1, \Teeshoop\Core\Garments::printable_sides_count( $ts_garment ) )
		: 1;
	$ts_rows = \Teeshoop\Core\Pricing::grid( $ts_garment, $ts_qtys, range( 1, $ts_max ), $ts_conf );
	?>
	<?php
	/*
	 * NO HEADING OF ITS OWN. `product-price-grid.php` carries « Le prix par
	 * quantité » already, and a section that announced « Le tarif par quantité,
	 * publié » directly above it printed the same sentence twice, two lines
	 * apart. The lead goes before the template and the template's own h2 is the
	 * heading of the section.
	 */
	?>
	<section class="ts-section ts-wrap" aria-label="<?php esc_attr_e( 'Le prix par quantité', 'teeshoop' ); ?>">
		<div class="ts-section__head">
			<p class="ts-lead">
				<?php
				printf(
					/* translators: %s: the name of the garment the grid is for. */
					esc_html__( 'Pour %s. Les colonnes sont les quantités où le prix change vraiment, pas des nombres ronds choisis pour la mise en page.', 'teeshoop' ),
					esc_html( $ts_first->get_name() )
				);
				?>
			</p>
		</div>
		<?php
		wc_get_template(
			'teeshoop/product-price-grid.php',
			array(
				'garment'  => $ts_garment,
				'config'   => $ts_conf,
				'qtys'     => $ts_qtys,
				'rows'     => $ts_rows,
				'std_area' => \Teeshoop\Core\Pricing::std_area_sq_cm( $ts_conf ),
				'request'   => array(
					'qty'   => 0,
					'faces' => 1,
				),
				// This page carries no form, so a « sur devis » cell must lead to
				// the one that does rather than to an anchor that is not here.
				'quote_url' => quote_url(),
			),
			'',
			TEESHOOP_CORE_DIR . 'templates/'
		);
		?>
		<p class="ts-note">
			<a href="<?php echo esc_url( (string) get_permalink( $ts_first->get_id() ) ); ?>">
				<?php esc_html_e( 'Voir la fiche, les zones d’impression en centimètres et l’éditeur', 'teeshoop' ); ?>
			</a>
		</p>
	</section>
<?php endif; ?>

<?php
/*
 * The editorial copy, under everything the page computes.
 *
 * Same rule as a category listing and for the same measured reason: five French
 * competitors out of five put their long copy below the thing the visitor came
 * for. Here that thing is the sector blocks, the administrative answers and the
 * price grid, all of which are drawn from the code above.
 */
editorial_body( $ts_copy, 'ts-edito-entreprises' );

advice_block();
get_footer();
