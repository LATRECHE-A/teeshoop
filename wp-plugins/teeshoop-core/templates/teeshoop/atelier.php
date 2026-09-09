<?php
/**
 * L'atelier : le document entier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SA PROPRE COQUILLE, PAS L'EN-TÊTE DU THÈME, ET C'EST UNE DÉCISION
 *
 * `get_header()` et `get_footer()` ne sont pas appelés. Le raisonnement est
 * celui de `includes/BatPage.php` : un document dont tout l'intérêt tient dans
 * une seule surface ne se met pas sous une barre de menu, une barre de
 * recherche, un fil d'Ariane, un bandeau de consentement et un pied de page à
 * quatre colonnes. À 375 px, l'en-tête de Woodmart occupe la moitié de l'écran
 * avant que le canevas commence, et le canevas EST la page.
 *
 * CE N'EST PAS POUR AUTANT UNE PAGE HORS DE WORDPRESS. `wp_head()` et
 * `wp_footer()` sont appelés, donc le thème, les extensions, la politique de
 * sécurité, le bandeau de consentement et les actifs de l'éditeur arrivent
 * normalement. Ce qui est retiré, c'est la mise en page du thème, pas
 * WordPress.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ACCESSIBILITÉ : L'ORDRE DU DOCUMENT EST L'ORDRE DU CLAVIER
 *
 * Le lien de retour est le PREMIER élément focalisable de la page. C'est
 * délibéré, et c'est l'inverse de l'usage habituel qui met le lien d'évitement
 * en premier : ici la page entière est l'outil, il n'y a rien à éviter avant
 * lui, et la première chose dont un visiteur perdu a besoin est la sortie. Le
 * lien d'évitement vient juste après et mène au canevas, qui porte
 * `tabindex="-1"` pour pouvoir recevoir le focus.
 *
 * UN SEUL `h1`. L'éditeur natif écrit ses propres titres en `h2`
 * (`src/native/editeur.ts`), en attendant explicitement qu'un `h1` le précède.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL N'Y A PAS UN PRIX DANS CE FICHIER.
 *
 * @package Teeshoop\Core
 *
 * @var string $etat        pret | sans-vetement | indisponible | sans-paquet
 * @var int    $product_id
 * @var string $titre
 * @var string $produit_url
 * @var string $devis_url
 * @var string $ancre
 */

use Teeshoop\Core\Editeur;

defined( 'ABSPATH' ) || exit;

/*
 * LES DÉFAUTS SONT LES PLUS PRUDENTS. Un gabarit appelé sans ses arguments (par
 * un thème qui l'aurait recopié, par exemple) doit montrer le chemin du devis,
 * jamais un canevas qui ne peut pas vendre.
 */
$ts_etat    = isset( $etat ) ? (string) $etat : 'sans-paquet';
$ts_titre   = isset( $titre ) ? (string) $titre : '';
$ts_produit = isset( $produit_url ) ? (string) $produit_url : '';
$ts_devis   = isset( $devis_url ) ? (string) $devis_url : $ts_produit;
$ts_ancre   = isset( $ancre ) ? (string) $ancre : 'atelier-canevas';

/* Le `h1`, par état. Un état inconnu prend celui du refus le plus prudent. */
$ts_titres = array(
	'pret'          => sprintf(
		/* translators: %s: le nom du produit. */
		__( 'Personnaliser : %s', 'teeshoop' ),
		$ts_titre
	),
	'sans-vetement' => __( 'Cet article ne se personnalise pas', 'teeshoop' ),
	'indisponible'  => __( 'Cet article n’est plus à la vente', 'teeshoop' ),
	'sans-paquet'   => __( 'Le personnalisateur ne démarre pas', 'teeshoop' ),
);
$ts_h1 = $ts_titres[ $ts_etat ] ?? $ts_titres['sans-paquet'];
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<?php
/*
 * WordPress n'imprime `<title>` que si le thème déclare `title-tag`. Woodmart
 * le fait, un thème recopié à la main ne le fait pas toujours, et une page sans
 * titre est une page dont l'onglet, le favori et l'historique ne disent rien.
 */
if ( ! current_theme_supports( 'title-tag' ) ) {
	printf( '<title>%s</title>' . "\n", esc_html( wp_get_document_title() ) );
}
wp_head();
?>
</head>
<body <?php body_class( 'ts-atelier-page' ); ?>>
<?php wp_body_open(); ?>

<div class="ts-atelier">

	<header class="ts-atelier__bar">
		<?php if ( '' !== $ts_produit ) : ?>
			<a class="ts-atelier__retour" href="<?php echo esc_url( $ts_produit ); ?>">
				<?php esc_html_e( 'Retour à la fiche produit', 'teeshoop' ); ?>
			</a>
		<?php endif; ?>

		<?php if ( 'pret' === $ts_etat ) : ?>
			<a class="ts-atelier__evitement" href="#<?php echo esc_attr( $ts_ancre ); ?>">
				<?php esc_html_e( 'Aller au personnalisateur', 'teeshoop' ); ?>
			</a>
		<?php endif; ?>

		<h1 class="ts-atelier__titre"><?php echo esc_html( $ts_h1 ); ?></h1>
	</header>

	<?php if ( 'pret' === $ts_etat ) : ?>

		<div class="ts-atelier__scene" id="<?php echo esc_attr( $ts_ancre ); ?>" tabindex="-1">
			<?php
			/*
			 * LE MÊME POINT DE MONTAGE QUE LA FICHE PRODUIT, appelé par la même
			 * méthode. Un second balisage de montage, écrit ici, serait la
			 * deuxième maison d'une règle qui n'en a qu'une : le jour où
			 * l'éditeur change d'attribut, une des deux pages cesse de démarrer
			 * et rien ne le dit. `Editeur::rendre()` pose aussi le message de
			 * secours, en français, avant que le script ne tourne.
			 */
			Editeur::rendre();
			?>
		</div>

		<?php
		/*
		 * L'ANCRE `#teeshoop-devis` EXISTE SUR CETTE PAGE, ET IL LE FAUT.
		 *
		 * Le message de secours de `Editeur::rendre()` pointe vers
		 * `#teeshoop-devis`, qui est l'identifiant du formulaire de devis de la
		 * fiche produit (`templates/teeshoop/product-quote.php`). Sur cette
		 * adresse-ci ce formulaire n'existe pas : sans ce bloc, le seul lien
		 * offert à un client dont l'éditeur vient d'échouer ne mènerait nulle
		 * part, ce qui est le pire moment pour un lien mort.
		 *
		 * Ce n'est PAS une copie du formulaire. Le formulaire de devis a un
		 * état, une protection anti-robot, une reprise de saisie et un
		 * enregistrement ; en avoir deux serait deux implémentations d'une même
		 * demande. C'est un panneau, et il mène au vrai.
		 */
		?>
		<section class="ts-atelier__devis" id="teeshoop-devis">
			<h2><?php esc_html_e( 'Vous préférez nous confier le fichier', 'teeshoop' ); ?></h2>
			<p>
				<?php esc_html_e( 'Envoyez-nous votre visuel et la quantité. Nous préparons le fichier d’impression, nous vous adressons un bon à tirer, et rien ne part en production avant votre accord.', 'teeshoop' ); ?>
			</p>
			<?php if ( '' !== $ts_devis ) : ?>
				<p>
					<a class="ts-cta ts-cta--ghost" href="<?php echo esc_url( $ts_devis ); ?>">
						<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
					</a>
				</p>
			<?php endif; ?>
		</section>

	<?php else : ?>

		<div class="ts-atelier__refus">
			<?php if ( 'sans-vetement' === $ts_etat ) : ?>

				<p><?php esc_html_e( 'Cette référence n’est pas préparée pour l’impression : la zone imprimable et les tailles ne sont pas renseignées, donc nous ne savons ni la dessiner ici ni la chiffrer.', 'teeshoop' ); ?></p>
				<p><?php esc_html_e( 'La fiche reste ouverte, et le devis aussi. Envoyez-nous votre visuel et nous chiffrons à la main.', 'teeshoop' ); ?></p>

			<?php elseif ( 'indisponible' === $ts_etat ) : ?>

				<p><?php esc_html_e( 'Nous ne prenons plus de commande sur cette référence. Sa fiche reste consultable.', 'teeshoop' ); ?></p>
				<p><?php esc_html_e( 'Si vous cherchez l’équivalent, décrivez-nous ce que vous vouliez : nous proposons une référence en stock.', 'teeshoop' ); ?></p>

			<?php else : ?>

				<p><?php esc_html_e( 'L’outil de personnalisation ne se charge pas sur cette boutique en ce moment. Cela ne vient pas de votre navigateur et rien de ce que vous avez fait n’est perdu.', 'teeshoop' ); ?></p>
				<p><?php esc_html_e( 'Vous pouvez commander malgré tout. Demandez un devis en joignant votre visuel : nous préparons le fichier d’impression et vous envoyons un bon à tirer avant de lancer la production.', 'teeshoop' ); ?></p>

			<?php endif; ?>

			<div class="ts-atelier__actions">
				<?php if ( '' !== $ts_devis ) : ?>
					<a class="ts-cta" href="<?php echo esc_url( $ts_devis ); ?>">
						<?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?>
					</a>
				<?php endif; ?>
				<?php if ( '' !== $ts_produit ) : ?>
					<a class="ts-cta ts-cta--ghost" href="<?php echo esc_url( $ts_produit ); ?>">
						<?php esc_html_e( 'Revenir à la fiche produit', 'teeshoop' ); ?>
					</a>
				<?php endif; ?>
			</div>
		</div>

		<?php
		/*
		 * LA CAUSE TECHNIQUE NE S'AFFICHE QUE POUR QUI PEUT LA CORRIGER, comme
		 * dans `Editeur::rendre()`. Un client n'a rien à faire d'un nom de
		 * répertoire, et l'opérateur qui ouvre la page sans comprendre pourquoi
		 * elle refuse a besoin de la phrase exacte.
		 */
		if ( 'sans-paquet' === $ts_etat && current_user_can( 'manage_options' ) ) :
			?>
			<p class="ts-atelier__note">
				<?php esc_html_e( 'Teeshoop : le paquet de l’éditeur est absent du greffon, ou le répertoire assets/editeur/ en porte deux. Lancez « npm run build:editeur », puis redéployez le répertoire entier.', 'teeshoop' ); ?>
			</p>
			<?php
		endif;
		?>

	<?php endif; ?>

</div>

<?php wp_footer(); ?>
</body>
</html>
