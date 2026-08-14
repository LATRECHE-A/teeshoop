<?php
/**
 * Demander un devis.
 *
 * Mistertee opens their quote path at ten pieces and collects three fields and a
 * file, so the adviser starts from nothing on a page the buyer arrived at with a
 * fully formed intent. Tostadora has no B2B path at all: an association ordering
 * sixty shirts is offered a coupon. The form below therefore starts from what
 * this page already knows (the garment, the quantity, the faces, the size
 * breakdown) and asks only for what actually shortens the exchange.
 *
 * IT IS OFFERED AT EVERY QUANTITY and REQUIRED past the threshold. Those are two
 * different things, and conflating them is what makes a quote form feel like a
 * punishment. Someone ordering twelve polos may simply want to talk to a person.
 *
 * @package Teeshoop\Core
 *
 * @var int    $product_id
 * @var string $garment
 * @var array  $config
 * @var array  $request
 * @var array  $sizes
 */

use Teeshoop\Core\Quote;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- reading our own redirect result.
$ts_result = isset( $_GET['devis'] ) ? sanitize_key( wp_unslash( (string) $_GET['devis'] ) ) : '';
$ts_reason = isset( $_GET['raison'] ) ? sanitize_key( wp_unslash( (string) $_GET['raison'] ) ) : '';
// phpcs:enable WordPress.Security.NonceVerification.Recommended

$ts_errors = array(
	'email'            => __( 'L’adresse e-mail n’est pas valide. Nous ne pourrions pas vous répondre.', 'teeshoop' ),
	'contact'          => __( 'Indiquez le nom de la personne à qui répondre.', 'teeshoop' ),
	'expire'           => __( 'Le formulaire est resté ouvert trop longtemps. Rechargez la page, puis renvoyez-le.', 'teeshoop' ),
	'stamp'            => __( 'Le formulaire n’a pas été reconnu. Rechargez la page, puis renvoyez-le.', 'teeshoop' ),
	'trop_rapide'      => __( 'Le formulaire est parti trop vite pour avoir été rempli. Réessayez.', 'teeshoop' ),
	'trop_de_demandes' => __( 'Plusieurs demandes sont déjà parties depuis cette connexion. Réessayez dans une heure, ou appelez-nous.', 'teeshoop' ),
	'robot'            => __( 'La demande a été prise pour un envoi automatique. Rechargez la page, puis réessayez.', 'teeshoop' ),
	'enregistrement'   => __( 'La demande n’a pas pu être enregistrée. Rien n’a été envoyé. Réessayez dans un instant.', 'teeshoop' ),
);
?>
<section class="ts-devis" id="teeshoop-devis">
	<h2 class="ts-devis__title"><?php esc_html_e( 'Demander un devis', 'teeshoop' ); ?></h2>

	<?php if ( 'ok' === $ts_result ) : ?>
		<p class="ts-msg ts-msg--good" role="status">
			<?php esc_html_e( 'Demande envoyée. Vous recevez un accusé par e-mail, puis le chiffrage avec le délai de fabrication et les conditions de paiement.', 'teeshoop' ); ?>
		</p>
	<?php else : ?>
		<?php if ( 'erreur' === $ts_result ) : ?>
			<p class="ts-msg ts-msg--bad" role="alert">
				<?php echo esc_html( $ts_errors[ $ts_reason ] ?? __( 'La demande n’a pas pu être envoyée. Réessayez, ou appelez-nous.', 'teeshoop' ) ); ?>
			</p>
		<?php endif; ?>

		<p class="ts-devis__lead">
			<?php esc_html_e( 'Pour une grande série, plusieurs vêtements dans la même commande, une matière particulière ou une date à tenir, un chiffrage à la main coûte souvent moins cher que le tarif public. Dites-nous ce qu’il vous faut.', 'teeshoop' ); ?>
		</p>

		<form class="ts-devis__form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( Quote::ACTION ); ?>">
			<input type="hidden" name="product_id" value="<?php echo esc_attr( (string) $product_id ); ?>">
			<input type="hidden" name="stamp" value="<?php echo esc_attr( Quote::stamp() ); ?>">
			<input type="hidden" name="faces" value="<?php echo esc_attr( (string) (int) $request['faces'] ); ?>">
			<?php foreach ( (array) $request['grid'] as $ts_size => $ts_count ) : ?>
				<input type="hidden" name="tailles[<?php echo esc_attr( (string) $ts_size ); ?>]" value="<?php echo esc_attr( (string) (int) $ts_count ); ?>">
			<?php endforeach; ?>

			<div class="ts-form__row">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Votre nom', 'teeshoop' ); ?></span>
					<input type="text" name="contact" required autocomplete="name" maxlength="120">
				</label>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Société', 'teeshoop' ); ?></span>
					<input type="text" name="societe" autocomplete="organization" maxlength="160">
				</label>
			</div>

			<div class="ts-form__row">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'E-mail', 'teeshoop' ); ?></span>
					<input type="email" name="email" required autocomplete="email" inputmode="email" maxlength="180">
				</label>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Téléphone', 'teeshoop' ); ?></span>
					<input type="tel" name="telephone" autocomplete="tel" maxlength="40">
				</label>
			</div>

			<div class="ts-form__row">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Nombre de pièces', 'teeshoop' ); ?></span>
					<input type="number" name="qte" min="1" step="1" inputmode="numeric" value="<?php echo esc_attr( (string) (int) $request['qty'] ); ?>">
				</label>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Date de livraison souhaitée', 'teeshoop' ); ?></span>
					<input type="date" name="echeance">
					<span class="ts-form__hint"><?php esc_html_e( 'Facultatif. Une date nous dit tout de suite si le délai est tenable.', 'teeshoop' ); ?></span>
				</label>
			</div>

			<label class="ts-form__field">
				<span class="ts-form__label"><?php esc_html_e( 'SIRET', 'teeshoop' ); ?></span>
				<input type="text" name="siret" inputmode="numeric" maxlength="20" autocomplete="off">
				<span class="ts-form__hint"><?php esc_html_e( 'Facultatif. Il nous permet d’établir une facture hors taxes à votre nom.', 'teeshoop' ); ?></span>
			</label>

			<label class="ts-form__field">
				<span class="ts-form__label"><?php esc_html_e( 'Votre projet', 'teeshoop' ); ?></span>
				<textarea name="message" rows="5" maxlength="4000" placeholder="<?php esc_attr_e( 'Les vêtements, les emplacements du marquage, les couleurs, ce que vous avez déjà comme fichier.', 'teeshoop' ); ?>"></textarea>
			</label>

			<?php /* A real field, labelled for assistive technology, hidden from sight. A bot that fills every input identifies itself. */ ?>
			<div class="ts-hp" aria-hidden="true">
				<label for="ts-site-web"><?php esc_html_e( 'Laissez ce champ vide', 'teeshoop' ); ?></label>
				<input type="text" id="ts-site-web" name="site_web" tabindex="-1" autocomplete="off">
			</div>

			<button type="submit" class="ts-cta"><?php esc_html_e( 'Envoyer la demande', 'teeshoop' ); ?></button>

			<p class="ts-form__legal">
				<?php esc_html_e( 'Ces informations servent uniquement à établir votre devis et à vous répondre. Elles ne sont ni vendues ni utilisées pour de la prospection. Elles sont conservées trois ans après notre dernier échange, puis effacées. Vous pouvez à tout moment demander à les consulter, les corriger ou les supprimer en nous écrivant.', 'teeshoop' ); ?>
			</p>
		</form>
	<?php endif; ?>
</section>
