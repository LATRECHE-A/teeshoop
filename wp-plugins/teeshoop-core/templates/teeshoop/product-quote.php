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
 *
 * Et, depuis le 26/09/2026, ce que seule la page devis remet (`Quote::page_args`),
 * absent de la fiche produit, d'où les valeurs par défaut plus bas :
 *
 * @var bool       $grille      les quantités par taille, en clair
 * @var string     $titre       l'article choisi
 * @var string     $image       sa vignette
 * @var string     $atelier_url l'atelier de cet article
 * @var array|null $modeles     les modèles du client pour ce type de vêtement ; null = ne pas en parler
 * @var bool       $connecte
 * @var string     $compte_url
 * @var array      $choix       sans article, ceux qu'on peut personnaliser
 */

use Teeshoop\Core\Quote;

defined( 'ABSPATH' ) || exit;

// phpcs:disable WordPress.Security.NonceVerification.Recommended -- reading our own redirect result.
$ts_result = isset( $_GET['devis'] ) ? sanitize_key( wp_unslash( (string) $_GET['devis'] ) ) : '';
$ts_reason = isset( $_GET['raison'] ) ? sanitize_key( wp_unslash( (string) $_GET['raison'] ) ) : '';
// phpcs:enable WordPress.Security.NonceVerification.Recommended

// What the prospect typed before the submission was refused, if anything.
$ts_back = \Teeshoop\Core\Quote::resume();
$ts_val  = static fn( string $key, string $fallback = '' ): string => (string) ( $ts_back[ $key ] ?? $fallback );

$ts_choix    = isset( $choix ) && is_array( $choix ) ? $choix : array();
$ts_grille   = ! empty( $grille ) && ! empty( $sizes );
$ts_atelier  = isset( $atelier_url ) ? (string) $atelier_url : '';
$ts_modeles  = isset( $modeles ) && is_array( $modeles ) ? $modeles : null;
$ts_connecte = ! empty( $connecte );
$ts_ici      = get_permalink( (int) get_queried_object_id() ) ?: home_url( '/' );
// Un refus renvoie à la page d'où l'on vient, article compris : sans lui, la page
// devis rouvrirait sans le produit choisi.
$ts_retour   = $ts_grille ? add_query_arg( 'produit', (int) $product_id, $ts_ici ) : $ts_ici;
$ts_tailles  = (array) ( $ts_back['tailles'] ?? array() );
$ts_modele   = (string) ( $ts_back['design_id'] ?? '' );
$ts_qte      = (string) (int) ( $ts_back['qte'] ?? $request['typed'] );

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
			<?php esc_html_e( 'Pour une grande série, plusieurs vêtements dans la même commande, une matière particulière ou une date à tenir, nous chiffrons à la main : le tarif public ne sait pas décrire ces commandes. Dites-nous ce qu’il vous faut.', 'teeshoop' ); ?>
		</p>

		<?php if ( ! empty( $ts_choix ) ) : ?>
			<?php /* Un formulaire à part, en GET : choisir un article recharge la page sur lui, et rien de ce qui est tapé plus bas ne passe dans l'adresse. */ ?>
			<form class="ts-devis__article" method="get" action="<?php echo esc_url( $ts_ici ); ?>">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'L’article à personnaliser', 'teeshoop' ); ?></span>
					<select name="produit" required>
						<?php foreach ( $ts_choix as $ts_id => $ts_nom ) : ?>
							<option value="<?php echo esc_attr( (string) (int) $ts_id ); ?>"><?php echo esc_html( (string) $ts_nom ); ?></option>
						<?php endforeach; ?>
					</select>
					<span class="ts-form__hint"><?php esc_html_e( 'Pour indiquer les quantités par taille et joindre un de vos modèles. Pour un article qui n’est pas dans cette liste, décrivez-le dans le message plus bas.', 'teeshoop' ); ?></span>
				</label>
				<button type="submit" class="ts-cta ts-cta--ghost"><?php esc_html_e( 'Choisir cet article', 'teeshoop' ); ?></button>
			</form>
		<?php elseif ( $ts_grille ) : ?>
			<div class="ts-devis__produit">
				<?php if ( '' !== (string) ( $image ?? '' ) ) : ?>
					<img src="<?php echo esc_url( (string) $image ); ?>" alt="" width="72" height="72" loading="lazy" decoding="async">
				<?php endif; ?>
				<div>
					<p class="ts-devis__produit-nom"><?php echo esc_html( (string) ( $titre ?? '' ) ); ?></p>
					<a href="<?php echo esc_url( remove_query_arg( array( 'produit', 'devis', 'raison', 'reprise' ) ) ); ?>"><?php esc_html_e( 'Choisir un autre article', 'teeshoop' ); ?></a>
				</div>
			</div>
		<?php endif; ?>

		<form class="ts-devis__form" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
			<input type="hidden" name="action" value="<?php echo esc_attr( Quote::ACTION ); ?>">
			<input type="hidden" name="product_id" value="<?php echo esc_attr( (string) $product_id ); ?>">
			<?php /* The page this form is on, so a refusal comes back to the form and not to the homepage. Validated against this host in Quote::return_url. */ ?>
			<input type="hidden" name="retour" value="<?php echo esc_url( $ts_retour ); ?>">
			<input type="hidden" name="stamp" value="<?php echo esc_attr( Quote::stamp() ); ?>">
			<input type="hidden" name="faces" value="<?php echo esc_attr( (string) (int) $request['faces'] ); ?>">
			<?php if ( ! $ts_grille ) : ?>
				<?php foreach ( (array) $request['grid'] as $ts_size => $ts_count ) : ?>
					<input type="hidden" name="tailles[<?php echo esc_attr( (string) $ts_size ); ?>]" value="<?php echo esc_attr( (string) (int) $ts_count ); ?>">
				<?php endforeach; ?>
			<?php endif; ?>

			<?php if ( $ts_grille ) : ?>
				<fieldset class="ts-devis__tailles">
					<legend class="ts-form__label"><?php esc_html_e( 'Nombre de pièces par taille', 'teeshoop' ); ?></legend>
					<div class="ts-devis__tailles-grille">
						<?php foreach ( (array) $sizes as $ts_size ) : ?>
							<label class="ts-devis__taille">
								<span><?php echo esc_html( (string) $ts_size ); ?></span>
								<input type="number" name="tailles[<?php echo esc_attr( (string) $ts_size ); ?>]" min="0" step="1" inputmode="numeric" value="<?php echo esc_attr( isset( $ts_tailles[ $ts_size ] ) && (int) $ts_tailles[ $ts_size ] > 0 ? (string) (int) $ts_tailles[ $ts_size ] : '' ); ?>">
							</label>
						<?php endforeach; ?>
					</div>
					<p class="ts-form__hint"><?php esc_html_e( 'Laissez vide une taille que vous ne voulez pas. Le total est la somme des tailles.', 'teeshoop' ); ?></p>
					<?php /* Juste sous les tailles, parce qu'il les remplace : placé plus bas, entre le téléphone et la date, il se lisait comme une seconde quantité. */ ?>
					<label class="ts-form__field">
						<span class="ts-form__label"><?php esc_html_e( 'Ou un nombre de pièces', 'teeshoop' ); ?></span>
						<input type="number" name="qte" min="1" step="1" inputmode="numeric" value="<?php echo esc_attr( $ts_qte ); ?>">
						<span class="ts-form__hint"><?php esc_html_e( 'Si les tailles ne sont pas encore décidées. Des tailles remplies l’emportent.', 'teeshoop' ); ?></span>
					</label>
				</fieldset>

				<fieldset class="ts-devis__visuel">
					<legend class="ts-form__label"><?php esc_html_e( 'Votre visuel', 'teeshoop' ); ?></legend>
					<?php if ( null !== $ts_modeles ) : ?>
						<?php if ( ! $ts_connecte ) : ?>
							<p class="ts-form__hint">
								<a href="<?php echo esc_url( (string) ( $compte_url ?? '' ) ); ?>"><?php esc_html_e( 'Connectez-vous', 'teeshoop' ); ?></a>
								<?php esc_html_e( 'pour retrouver les modèles enregistrés depuis l’atelier et en joindre un à votre demande.', 'teeshoop' ); ?>
							</p>
						<?php elseif ( array() === $ts_modeles ) : ?>
							<p class="ts-form__hint"><?php esc_html_e( 'Aucun modèle enregistré pour ce type de vêtement. Créez votre visuel avec « Personnalisation », puis enregistrez-le comme modèle depuis l’atelier.', 'teeshoop' ); ?></p>
						<?php else : ?>
							<label class="ts-form__field">
								<span class="ts-form__label"><?php esc_html_e( 'Modèles sauvegardés', 'teeshoop' ); ?></span>
								<select name="design_id" data-ts-modele>
									<option value=""><?php esc_html_e( 'Aucun modèle', 'teeshoop' ); ?></option>
									<?php foreach ( $ts_modeles as $ts_m ) : ?>
										<option value="<?php echo esc_attr( (string) $ts_m['id'] ); ?>"<?php selected( $ts_modele, (string) $ts_m['id'] ); ?>><?php echo esc_html( (string) $ts_m['nom'] ); ?></option>
									<?php endforeach; ?>
								</select>
								<span class="ts-form__hint"><?php esc_html_e( 'Le modèle choisi part avec votre demande, et « Personnalisation » l’ouvre sur cet article.', 'teeshoop' ); ?></span>
							</label>
						<?php endif; ?>
					<?php endif; ?>
					<?php if ( '' !== $ts_atelier ) : ?>
						<a class="ts-cta ts-cta--ghost" href="<?php echo esc_url( $ts_atelier ); ?>" data-ts-atelier><?php esc_html_e( 'Personnalisation', 'teeshoop' ); ?></a>
					<?php endif; ?>
				</fieldset>
			<?php endif; ?>

			<div class="ts-form__row">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Votre nom', 'teeshoop' ); ?></span>
					<input type="text" name="contact" required autocomplete="name" maxlength="120" value="<?php echo esc_attr( $ts_val( 'contact' ) ); ?>">
				</label>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Société', 'teeshoop' ); ?></span>
					<input type="text" name="societe" autocomplete="organization" maxlength="160" value="<?php echo esc_attr( $ts_val( 'societe' ) ); ?>">
				</label>
			</div>

			<div class="ts-form__row">
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'E-mail', 'teeshoop' ); ?></span>
					<input type="email" name="email" required autocomplete="email" inputmode="email" maxlength="180" value="<?php echo esc_attr( $ts_val( 'email' ) ); ?>">
				</label>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Téléphone', 'teeshoop' ); ?></span>
					<input type="tel" name="telephone" autocomplete="tel" maxlength="40" value="<?php echo esc_attr( $ts_val( 'telephone' ) ); ?>">
				</label>
			</div>

			<div class="ts-form__row">
				<?php if ( ! $ts_grille ) : ?>
					<label class="ts-form__field">
						<span class="ts-form__label"><?php esc_html_e( 'Nombre de pièces', 'teeshoop' ); ?></span>
						<input type="number" name="qte" min="1" step="1" inputmode="numeric" value="<?php echo esc_attr( $ts_qte ); ?>">
					</label>
				<?php endif; ?>
				<label class="ts-form__field">
					<span class="ts-form__label"><?php esc_html_e( 'Date de livraison souhaitée', 'teeshoop' ); ?></span>
					<input type="date" name="echeance" value="<?php echo esc_attr( $ts_val( 'echeance' ) ); ?>">
					<span class="ts-form__hint"><?php esc_html_e( 'Facultatif. Une date nous dit tout de suite si le délai est tenable.', 'teeshoop' ); ?></span>
				</label>
			</div>

			<label class="ts-form__field">
				<span class="ts-form__label"><?php esc_html_e( 'SIRET', 'teeshoop' ); ?></span>
				<input type="text" name="siret" inputmode="numeric" maxlength="20" autocomplete="off" value="<?php echo esc_attr( $ts_val( 'siret' ) ); ?>">
				<span class="ts-form__hint"><?php esc_html_e( 'Facultatif. Il nous permet d’établir une facture hors taxes à votre nom.', 'teeshoop' ); ?></span>
			</label>

			<label class="ts-form__field">
				<span class="ts-form__label"><?php esc_html_e( 'Votre projet', 'teeshoop' ); ?></span>
				<textarea name="message" rows="5" maxlength="4000" placeholder="<?php esc_attr_e( 'Les vêtements, les emplacements du marquage, les couleurs, ce que vous avez déjà comme fichier.', 'teeshoop' ); ?>"><?php echo esc_textarea( $ts_val( 'message' ) ); ?></textarea>
			</label>

			<?php /* A real field, labelled for assistive technology, hidden from sight. A bot that fills every input identifies itself. */ ?>
			<div class="ts-hp" aria-hidden="true">
				<label for="ts-site-web"><?php esc_html_e( 'Laissez ce champ vide', 'teeshoop' ); ?></label>
				<input type="text" id="ts-site-web" name="site_web" tabindex="-1" autocomplete="off">
			</div>

			<button type="submit" class="ts-cta"><?php esc_html_e( 'Envoyer la demande', 'teeshoop' ); ?></button>

			<p class="ts-form__legal">
				<?php esc_html_e( 'Ces informations servent uniquement à établir votre devis et à vous répondre : c’est la base contractuelle, nous ne vous demandons pas de consentement pour cela. Elles ne sont ni vendues ni utilisées pour de la prospection. Elles sont conservées trois ans après notre dernier échange, puis supprimées automatiquement. Vous pouvez à tout moment demander à les consulter, les corriger, les recevoir ou les supprimer en nous écrivant, et saisir la CNIL si notre réponse ne vous convient pas.', 'teeshoop' ); ?>
			</p>
		</form>
	<?php endif; ?>
</section>
