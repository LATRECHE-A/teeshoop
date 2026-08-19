<?php
/**
 * The page a customer opens from the proof e-mail.
 *
 * A WHOLE DOCUMENT AND NOT A WORDPRESS PAGE. It renders its own head and its
 * own stylesheet and asks the theme for nothing, because what a customer
 * approved has to look the same whatever the shop's theme is doing that week,
 * and because a proof wrapped in a site header, a menu, a cookie banner and a
 * footer is a proof somebody scrolls past. `Invoice::serve` streams a PDF from
 * the same kind of endpoint for the same reason.
 *
 * EVERY STATE IS DRAWN. A link that has expired, a version that has been
 * replaced, a proof already answered and a proof waiting for an answer are four
 * different things to be told, and each of them says what to do next. The one
 * that says nothing useful is the 404, deliberately: it is also the answer to a
 * wrong token, and a helpful message there would confirm that an order number
 * exists.
 *
 * NO SCRIPT AT ALL. Two forms and a stylesheet. An approval is a legal act and
 * it must work with JavaScript off, on a ten-year-old phone, in a mail client's
 * built-in browser.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class BatPage {

	/**
	 * The stylesheet.
	 *
	 * Inline because this page is served from `admin-post.php` and enqueues
	 * nothing: a linked file would be one more request on a mobile connection
	 * for two kilobytes, and `assets/product.css` is scoped to the shop's own
	 * blocks and would style none of this.
	 *
	 * The palette separates the brand accent from the semantic colours, so
	 * "this is the button" and "this went well" are never the same blue.
	 */
	private static function css(): string {
		return <<<'CSS'
:root{
  --ink:#14171a; --ink-soft:#5b6470; --line:#dce0e5; --paper:#fff; --wash:#f6f7f9;
  --accent:#1f4fd8; --accent-ink:#fff;
  --good:#0f7b4f; --warn:#a85b00; --bad:#b3261e;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--wash);color:var(--ink);
  font:400 16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-variant-numeric:tabular-lining}
main{max-width:46rem;margin:0 auto;padding:1rem 1rem 4rem}
header.doc{padding:1.25rem 0 1rem;border-bottom:2px solid var(--ink)}
.eyebrow{margin:0;font-size:.8125rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft)}
h1{margin:.15rem 0 .35rem;font-size:1.5rem;line-height:1.2;font-weight:650}
h2{margin:2rem 0 .5rem;font-size:1.125rem;font-weight:650}
h3{margin:1.25rem 0 .35rem;font-size:.9375rem;font-weight:650}
p{margin:.5rem 0}
.meta{margin:0;color:var(--ink-soft);font-size:.9375rem}
.card{background:var(--paper);border:1px solid var(--line);padding:1rem;margin:1rem 0}
.note{border-left:3px solid var(--warn);background:var(--paper);padding:.75rem 1rem;margin:1rem 0;font-size:.9375rem}
.note.good{border-left-color:var(--good)}
.note.bad{border-left-color:var(--bad)}
.side{border-top:1px solid var(--line);padding-top:1rem;margin-top:1rem}
.side:first-of-type{border-top:0;margin-top:.5rem;padding-top:0}
.shot{display:block;width:100%;max-width:22rem;height:auto;background:var(--wash);border:1px solid var(--line)}
dl.figs{display:grid;grid-template-columns:1fr auto;gap:.15rem .75rem;margin:.75rem 0 0;font-size:.9375rem}
dl.figs dt{color:var(--ink-soft)}
dl.figs dd{margin:0;text-align:right;font-variant-numeric:tabular-nums}
ul.plain{margin:.5rem 0;padding-left:1.1rem}
ul.plain li{margin:.2rem 0}
table.sizes{border-collapse:collapse;margin:.5rem 0;font-size:.9375rem}
table.sizes th,table.sizes td{border:1px solid var(--line);padding:.3rem .6rem;text-align:right;font-variant-numeric:tabular-nums}
table.sizes th{background:var(--wash);font-weight:600}
.decide{background:var(--paper);border:1px solid var(--line);padding:1rem;margin:1.5rem 0}
.accept{font-size:.9375rem;color:var(--ink)}
button{font:inherit;cursor:pointer;border:1px solid transparent;padding:.7rem 1.1rem;width:100%}
button.primary{background:var(--accent);color:var(--accent-ink);font-weight:600}
button.secondary{background:var(--paper);color:var(--ink);border-color:var(--ink-soft)}
button:hover{filter:brightness(.94)}
a:focus-visible,button:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
textarea{font:inherit;width:100%;min-height:7rem;padding:.6rem;border:1px solid var(--ink-soft);background:var(--paper);color:var(--ink)}
label{display:block;font-size:.9375rem;font-weight:600;margin:.25rem 0}
.hint{font-size:.875rem;color:var(--ink-soft);margin:.25rem 0 .6rem}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--line);color:var(--ink-soft);font-size:.875rem}
@media (min-width:40rem){
  main{padding:1.5rem 1.5rem 5rem}
  h1{font-size:1.875rem}
  button{width:auto;min-width:16rem}
  .two{display:grid;grid-template-columns:22rem 1fr;gap:1.25rem;align-items:start}
}
CSS;
	}

	/** Open the document. */
	private static function head( string $title ): void {
		echo "<!doctype html>\n<html lang=\"fr\"><head><meta charset=\"utf-8\">";
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
		echo '<meta name="robots" content="noindex, nofollow, noarchive">';
		echo '<title>' . esc_html( $title ) . '</title>';
		echo '<style>' . self::css() . '</style>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- a literal stylesheet.
		echo '</head><body><main>';
	}

	private static function foot(): void {
		$identity = Legal::identity();
		echo '<footer><p>';
		echo esc_html( '' !== $identity['raison_sociale'] ? $identity['raison_sociale'] : 'Teeshoop' );
		echo '</p><p>';
		esc_html_e( 'Ce document est un bon à tirer. Il n’est ni une facture ni un bon de commande.', 'teeshoop' );
		echo '</p></footer></main></body></html>';
	}

	/**
	 * The one answer to a wrong token, an unknown order and a version that does
	 * not exist. Identical on purpose: three different messages would let
	 * somebody with a link tell one from another.
	 */
	public static function not_found(): void {
		self::head( __( 'Lien introuvable', 'teeshoop' ) );
		echo '<header class="doc"><p class="eyebrow">Teeshoop</p><h1>';
		esc_html_e( 'Ce lien ne mène à rien', 'teeshoop' );
		echo '</h1></header>';
		echo '<p>';
		esc_html_e( 'Le lien est incomplet, il a été remplacé, ou il n’a jamais existé. Reprenez celui du dernier message que nous vous avons envoyé.', 'teeshoop' );
		echo '</p><p>';
		esc_html_e( 'Si vous n’en avez pas, répondez à ce message : nous vous en renvoyons un.', 'teeshoop' );
		echo '</p>';
		self::foot();
	}

	/**
	 * The proof.
	 *
	 * @param array  $version the frozen version.
	 * @param string $state   ok | expired | superseded | decided | operateur.
	 * @param string $token   the capability, echoed into the decision form.
	 */
	public static function render( \WC_Order $order, array $version, string $state, string $token ): void {
		$number = (string) ( $version['order']['number'] ?? $order->get_order_number() );
		self::head( sprintf( __( 'Bon à tirer, commande %s', 'teeshoop' ), $number ) );

		echo '<header class="doc">';
		echo '<p class="eyebrow">Teeshoop</p>';
		printf( '<h1>%s</h1>', esc_html__( 'Bon à tirer', 'teeshoop' ) );
		printf(
			'<p class="meta">%s</p>',
			esc_html(
				sprintf(
					/* translators: 1: order number, 2: version number, 3: a date. */
					__( 'Commande %1$s, version %2$d, établie le %3$s', 'teeshoop' ),
					$number,
					(int) $version['version'],
					Lifecycle::human_date( (string) $version['issued_at'] )
				)
			)
		);
		$who = trim( (string) ( $version['customer']['company'] ?? '' ) );
		if ( '' === $who ) {
			$who = trim( (string) ( $version['customer']['name'] ?? '' ) );
		}
		if ( '' !== $who ) {
			printf( '<p class="meta">%s</p>', esc_html( $who ) );
		}
		echo '</header>';

		self::state_banner( $version, $state );

		if ( '' !== trim( (string) ( $version['note'] ?? '' ) ) ) {
			echo '<div class="note"><p><strong>';
			esc_html_e( 'Remarque de l’atelier', 'teeshoop' );
			echo '</strong></p><p>' . esc_html( (string) $version['note'] ) . '</p></div>';
		}

		foreach ( (array) $version['lines'] as $line ) {
			self::line( $line );
		}

		self::tolerances( $version );

		if ( 'ok' === $state ) {
			self::decision_form( $order, $version, $token );
		}

		self::foot();
	}

	/** What this page is for, right now, in one band. */
	private static function state_banner( array $version, string $state ): void {
		if ( 'ok' === $state ) {
			echo '<div class="note"><p>';
			esc_html_e( 'Vérifiez chaque élément ci-dessous. Rien n’est imprimé tant que vous n’avez pas validé.', 'teeshoop' );
			echo '</p><p>';
			esc_html_e( 'Les couleurs d’un écran ne sont pas celles d’un textile imprimé : jugez le placement et les dimensions, pas la teinte exacte.', 'teeshoop' );
			echo '</p></div>';
			return;
		}

		if ( 'decided' === $state && ! empty( $version['approval'] ) ) {
			echo '<div class="note good"><p><strong>';
			esc_html_e( 'Bon à tirer validé', 'teeshoop' );
			echo '</strong></p><p>';
			echo esc_html(
				sprintf(
					/* translators: %s: a date and time. */
					__( 'Validé le %s. Nous lançons la production. Vous n’avez rien d’autre à faire.', 'teeshoop' ),
					Lifecycle::human_date( (string) $version['approval']['at'] )
				)
			);
			echo '</p></div>';
			return;
		}

		if ( 'operateur' === $state ) {
			// The same document, opened from the admin. It says whose view this
			// is, because a proof with no buttons and no explanation reads like
			// a proof that has expired.
			echo '<div class="note"><p><strong>';
			esc_html_e( 'Vue atelier', 'teeshoop' );
			echo '</strong></p><p>';
			esc_html_e( 'Ce document est affiché tel que le client le voit. Seul le client peut le valider, depuis le lien qui lui a été envoyé.', 'teeshoop' );
			echo '</p></div>';
			return;
		}

		if ( 'decided' === $state && empty( $version['changes'] ) ) {
			// Reachable only if a decision was recorded and then removed, which
			// nothing does today. Saying nothing here would print a date read
			// off an empty array.
			echo '<div class="note"><p>';
			esc_html_e( 'Ce bon à tirer n’attend plus de réponse.', 'teeshoop' );
			echo '</p></div>';
			return;
		}

		if ( 'decided' === $state ) {
			$changes = (array) ( $version['changes'] ?? array() );
			$last    = end( $changes );
			echo '<div class="note"><p><strong>';
			esc_html_e( 'Modifications demandées', 'teeshoop' );
			echo '</strong></p><p>';
			echo esc_html(
				sprintf(
					/* translators: %s: a date and time. */
					__( 'Reçues le %s. Nous préparons une nouvelle version et vous la renvoyons par courriel.', 'teeshoop' ),
					Lifecycle::human_date( (string) ( $last['at'] ?? '' ) )
				)
			);
			echo '</p>';
			if ( ! empty( $last['comment'] ) ) {
				echo '<p><strong>';
				esc_html_e( 'Ce que vous nous avez écrit :', 'teeshoop' );
				echo '</strong></p><p>' . nl2br( esc_html( (string) $last['comment'] ) ) . '</p>';
			}
			echo '</div>';
			return;
		}

		if ( 'superseded' === $state ) {
			echo '<div class="note"><p><strong>';
			esc_html_e( 'Cette version a été remplacée', 'teeshoop' );
			echo '</strong></p><p>';
			esc_html_e( 'Une version plus récente vous a été envoyée par courriel. Utilisez ce message-là : c’est celle-ci que nous imprimerons.', 'teeshoop' );
			echo '</p></div>';
			return;
		}

		echo '<div class="note"><p><strong>';
		esc_html_e( 'Ce lien a expiré', 'teeshoop' );
		echo '</strong></p><p>';
		esc_html_e( 'Le bon à tirer ci-dessous est bien le vôtre, mais le lien de validation n’est plus actif. Répondez au message, nous vous en renvoyons un tout de suite.', 'teeshoop' );
		echo '</p></div>';
	}

	/** One ordered line, with a mockup and the numbers per printed side. */
	private static function line( array $line ): void {
		echo '<section class="card">';
		printf( '<h2>%s</h2>', esc_html( (string) $line['name'] ) );

		echo '<dl class="figs">';
		self::fig( __( 'Couleur', 'teeshoop' ), (string) $line['colour'] );
		self::fig( __( 'Référence', 'teeshoop' ), (string) $line['brand_ref'] );
		self::fig( __( 'Technique', 'teeshoop' ), (string) $line['technique'] );
		self::fig( __( 'Quantité', 'teeshoop' ), (string) $line['quantity'] );
		echo '</dl>';

		$sizes = (array) ( $line['sizes'] ?? array() );
		if ( ! empty( $sizes ) ) {
			echo '<h3>' . esc_html__( 'Tailles', 'teeshoop' ) . '</h3>';
			echo '<table class="sizes"><thead><tr>';
			foreach ( array_keys( $sizes ) as $size ) {
				printf( '<th scope="col">%s</th>', esc_html( strtoupper( (string) $size ) ) );
			}
			echo '</tr></thead><tbody><tr>';
			foreach ( $sizes as $count ) {
				printf( '<td>%d</td>', (int) $count );
			}
			echo '</tr></tbody></table>';
		}

		foreach ( (array) $line['sides'] as $side ) {
			self::side( $line, $side );
		}
		echo '</section>';
	}

	/** One printed face: what it looks like, and the numbers a press works to. */
	private static function side( array $line, array $side ): void {
		echo '<div class="side"><h3>' . esc_html( (string) $side['label'] ) . '</h3>';
		echo '<div class="two">';

		$shot = (string) ( ( (array) ( $line['previews'] ?? array() ) )[ $side['id'] ] ?? '' );
		if ( '' === $shot && ! empty( $line['preview'] ) ) {
			// An order placed before the per-side mockups existed has one image
			// and it is the front. Showing it under « Dos » would be a lie, so
			// it is shown only where it belongs.
			$shot = 'front' === $side['id'] ? (string) $line['preview'] : '';
		}
		if ( '' !== $shot ) {
			printf(
				'<img class="shot" src="%s" alt="%s" width="900" height="900" loading="lazy">',
				esc_url( $shot ),
				esc_attr(
					sprintf(
						/* translators: %s: the name of a printed face. */
						__( 'Aperçu du vêtement, face %s', 'teeshoop' ),
						mb_strtolower( (string) $side['label'] )
					)
				)
			);
		} else {
			echo '<p class="hint">' . esc_html__( 'Aperçu indisponible pour cette face. Demandez-le-nous avant de valider.', 'teeshoop' ) . '</p>';
		}

		echo '<div>';
		echo '<dl class="figs">';
		self::fig( __( 'Surface imprimée', 'teeshoop' ), Money::number( (float) $side['area_sq_cm'], 0 ) . "\u{00A0}cm²" );

		if ( ! empty( $side['placed'] ) ) {
			self::fig(
				__( 'Zone d’impression', 'teeshoop' ),
				Garments::cm( (float) $side['zone_w_cm'] ) . ' × ' . Garments::cm( (float) $side['zone_h_cm'] )
			);
			if ( null !== $side['drop_cm'] ) {
				self::fig( __( 'Centre de la zone sous l’encolure', 'teeshoop' ), Garments::cm( (float) $side['drop_cm'] ) );
			}
			$n = 1;
			foreach ( (array) $side['pieces'] as $piece ) {
				$label = count( (array) $side['pieces'] ) > 1
					/* translators: %d: the number of a transfer among several. */
					? sprintf( __( 'Visuel %d', 'teeshoop' ), $n )
					: __( 'Visuel', 'teeshoop' );
				self::fig(
					$label,
					Garments::cm( (float) $piece['w_cm'] ) . ' × ' . Garments::cm( (float) $piece['h_cm'] )
				);
				self::fig(
					/* translators: %s: the name of a transfer. */
					sprintf( __( '%s, haut sous le bord de la zone', 'teeshoop' ), $label ),
					Garments::cm( (float) $piece['top_cm'] )
				);
				self::fig(
					/* translators: %s: the name of a transfer. */
					sprintf( __( '%s, décalage par rapport à l’axe', 'teeshoop' ), $label ),
					self::signed_cm( (float) $piece['center_dx_cm'] )
				);
				++$n;
			}
		} else {
			/*
			 * SAYING SO RATHER THAN PRINTING A ZERO. A placement that was never
			 * measured, or one the gate refused, has no number. Printing one
			 * anyway in the same type as a measured one is the single worst
			 * thing this document could do, because the customer would approve
			 * it and the workshop would press something else.
			 */
			echo '</dl><p class="hint">';
			esc_html_e( 'Le placement exact de ce visuel n’a pas été mesuré automatiquement. Il sera confirmé avec vous avant impression.', 'teeshoop' );
			echo '</p><dl class="figs">';
		}

		if ( ! empty( $line['measured_at'] ) ) {
			self::fig( __( 'Dimensions données pour la taille', 'teeshoop' ), strtoupper( (string) $line['measured_at'] ) );
		}
		echo '</dl>';
		if ( ! empty( $line['measured_at'] ) ) {
			echo '<p class="hint">';
			esc_html_e( 'Le marquage est mis à l’échelle avec le vêtement : il est plus grand sur les grandes tailles et plus petit sur les petites.', 'teeshoop' );
			echo '</p>';
		}
		echo '</div></div></div>';
	}

	/** "-1,5 cm" and "+1,5 cm": on a proof, the direction is half the number. */
	private static function signed_cm( float $value ): string {
		if ( abs( $value ) < 0.05 ) {
			return __( 'centré', 'teeshoop' );
		}
		$word = $value > 0 ? __( 'vers la droite', 'teeshoop' ) : __( 'vers la gauche', 'teeshoop' );
		return Garments::cm( abs( $value ) ) . ' ' . $word;
	}

	private static function fig( string $label, string $value ): void {
		if ( '' === trim( $value ) ) {
			return;
		}
		printf( '<dt>%s</dt><dd>%s</dd>', esc_html( $label ), esc_html( $value ) );
	}

	private static function tolerances( array $version ): void {
		$list = (array) ( $version['tolerances'] ?? array() );
		if ( empty( $list ) ) {
			return;
		}
		echo '<h2>' . esc_html__( 'Ce que vous acceptez en validant', 'teeshoop' ) . '</h2>';
		echo '<ul class="plain">';
		foreach ( $list as $item ) {
			printf( '<li>%s</li>', esc_html( (string) $item ) );
		}
		echo '</ul>';
	}

	/** The two ways out. Both say what will happen, not what they are called. */
	private static function decision_form( \WC_Order $order, array $version, string $token ): void {
		$post = esc_url( admin_url( 'admin-post.php' ) );
		$hidden = sprintf(
			'<input type="hidden" name="action" value="%s"><input type="hidden" name="c" value="%d"><input type="hidden" name="v" value="%d"><input type="hidden" name="j" value="%s">',
			esc_attr( Bat::ACTION_DECIDE ),
			(int) $order->get_id(),
			(int) $version['version'],
			esc_attr( $token )
		);

		echo '<h2>' . esc_html__( 'Votre décision', 'teeshoop' ) . '</h2>';

		echo '<div class="decide">';
		echo '<p class="accept">' . esc_html( (string) $version['text'] ) . '</p>';
		printf( '<form method="post" action="%s">', $post ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
		echo $hidden; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts.
		echo '<input type="hidden" name="choix" value="valider">';
		printf( '<button type="submit" class="primary">%s</button>', esc_html__( 'Valider le bon à tirer', 'teeshoop' ) );
		echo '</form></div>';

		echo '<div class="decide">';
		printf( '<form method="post" action="%s">', $post ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
		echo $hidden; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts.
		echo '<input type="hidden" name="choix" value="modifier">';
		printf( '<label for="ts-bat-comment">%s</label>', esc_html__( 'Quelque chose ne va pas ?', 'teeshoop' ) );
		echo '<p class="hint">';
		esc_html_e( 'Dites-nous quoi, face par face : la taille du visuel, sa position, une faute dans un texte. Plus c’est précis, moins il y a d’allers-retours.', 'teeshoop' );
		echo '</p>';
		printf(
			'<textarea id="ts-bat-comment" name="commentaire" maxlength="4000" required placeholder="%s"></textarea>',
			esc_attr__( 'Par exemple : sur le dos, le logo est trop bas de 3 cm.', 'teeshoop' )
		);
		printf( '<p><button type="submit" class="secondary">%s</button></p>', esc_html__( 'Demander des modifications', 'teeshoop' ) );
		echo '</form></div>';
	}
}
