<?php
/**
 * The workshop's screen: what is ready, when it has to be bought, what is on
 * film already.
 *
 * WHY IT IS A WORDPRESS SCREEN AND NOT ONLY A STUDIO ONE. The layout is measured
 * in the studio, because that is the only place a canvas exists, but the DAY is
 * planned here: the orders, the money, the proofs and the dates all live in
 * WooCommerce, and an operator who has to open a second application to find out
 * what is late will not. So this screen answers the three questions of a morning
 *, what can be printed, what must be bought today, what is already on film ,
 * and hands off to the studio for the one thing it cannot do.
 *
 * WHAT IT REFUSES TO DO. It never creates a lot. A lot needs a measured layout
 * and this screen has none; a button here that guessed one would be a second,
 * worse packer. The only write it offers is moving a lot along a state it has
 * already reached in the real world (the film was ordered, the film arrived).
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class ProductionPage {

	private const SLUG         = 'teeshoop-production';
	private const ACTION_STATE = 'teeshoop_lot_etat';

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_action( 'admin_post_' . self::ACTION_STATE, array( self::class, 'handle_state' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Production Teeshoop', 'teeshoop' ),
			__( 'Production', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	/** Where the workshop tool lives, or '' when nobody has said. */
	private static function studio_url(): string {
		$origin = Settings::get( 'studio_origin' );
		return '' === $origin ? '' : rtrim( $origin, '/' ) . '/admin.html#production';
	}

	public static function handle_state(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Vous n’avez pas le droit de modifier un lot.', 'teeshoop' ), '', array( 'response' => 403 ) );
		}
		check_admin_referer( self::ACTION_STATE );

		$id    = isset( $_POST['lot'] ) ? (int) $_POST['lot'] : 0;
		$state = isset( $_POST['etat'] ) ? sanitize_key( wp_unslash( $_POST['etat'] ) ) : '';

		$done = Production::SENT === $state
			? Production::send_lot( $id )
			: Production::advance_lot( $id, $state );

		wp_safe_redirect(
			add_query_arg(
				$done['ok'] ? array( 'teeshoop_ok' => '1' ) : array( 'teeshoop_ko' => rawurlencode( $done['reason'] ) ),
				self::url()
			)
		);
		exit;
	}

	public static function screen(): void {
		$config = Production::config();
		$film   = (array) ( Costing::config()['film'] ?? array() );
		$today  = Settings::today();
		$queue  = Production::queue( $today );
		$lots   = Production::lots( 15 );

		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Production', 'teeshoop' ) . '</h1>';

		if ( isset( $_GET['teeshoop_ko'] ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html( sanitize_text_field( wp_unslash( (string) $_GET['teeshoop_ko'] ) ) ) . '</p></div>';
		} elseif ( isset( $_GET['teeshoop_ok'] ) ) {
			echo '<div class="notice notice-success"><p>' . esc_html__( 'Le lot a été mis à jour.', 'teeshoop' ) . '</p></div>';
		}

		self::feasibility_notice( $config, $film );
		self::queue_table( $queue, $today, $config );
		self::lots_table( $lots );

		echo '</div>';
	}

	/**
	 * The promises that cannot be kept, stated before anything else.
	 *
	 * It is the first thing on the screen because it is not a property of any one
	 * order: it is arithmetic on four settings, and no amount of scheduling fixes
	 * it. An operator who does not know that every urgent order starts two days
	 * late will read the queue as a list of failures.
	 */
	private static function feasibility_notice( array $config, array $film ): void {
		$broken = array();
		foreach ( Production::feasibility( $config, $film ) as $urgency => $slack ) {
			if ( $slack['fr'] < 0 ) {
				$broken[] = sprintf(
					/* translators: 1: urgency level, 2: promised working days, 3: days short. */
					__( '%1$s : %2$d jours ouvrés promis, %3$d jours de travail de plus qu’il n’y a de place, même en achetant le film en France.', 'teeshoop' ),
					PriceRule::URGENCES[ $urgency ] ?? $urgency,
					(int) $slack['days'],
					-(int) $slack['fr']
				);
			}
		}
		if ( array() === $broken ) {
			return;
		}
		echo '<div class="notice notice-warning"><p><strong>' .
			esc_html__( 'Un délai annoncé ne tient pas.', 'teeshoop' ) .
			'</strong></p><ul style="list-style:disc;margin-left:1.5em">';
		foreach ( $broken as $line ) {
			echo '<li>' . esc_html( $line ) . '</li>';
		}
		echo '</ul><p>' .
			esc_html__( 'Ces durées sont des valeurs par défaut, pas un engagement : rien sur le site n’annonce de date. La question 14 attend la réponse de l’associé, et tant qu’elle n’est pas là ces commandes partent en retard dès leur validation.', 'teeshoop' ) .
			'</p></div>';
	}

	private static function queue_table( array $queue, string $today, array $config ): void {
		echo '<h2>' . esc_html__( 'À imprimer', 'teeshoop' ) . '</h2>';

		if ( array() === $queue ) {
			/*
			 * THE EMPTY STATE IS BUILT, not left blank. Nothing to print is the
			 * normal state of a workshop at four in the afternoon, and a blank
			 * table reads as a broken screen.
			 */
			echo '<p>' . esc_html__( 'Aucune commande n’attend la presse : tout ce qui est payé et dont le bon à tirer est validé est déjà dans un lot.', 'teeshoop' ) . '</p>';
			return;
		}

		$groups = array();
		foreach ( $queue as $row ) {
			$groups[ $row['origin'] ][] = $row;
		}

		foreach ( array( 'es', 'fr' ) as $origin ) {
			if ( empty( $groups[ $origin ] ) ) {
				continue;
			}
			$rows      = $groups[ $origin ];
			$garments  = array_sum( array_column( $rows, 'garments' ) );
			$order_by  = min( array_column( $rows, 'order_by' ) );

			echo '<h3>' . esc_html(
				sprintf(
					/* translators: 1: where the film is bought, 2: how many orders, 3: how many garments. */
					__( 'Film %1$s, %2$d commande(s), %3$d vêtements', 'teeshoop' ),
					'es' === $origin ? __( 'Espagne', 'teeshoop' ) : __( 'France', 'teeshoop' ),
					count( $rows ),
					$garments
				)
			) . '</h3>';

			echo '<p>' . esc_html(
				sprintf(
					/* translators: 1: a date, 2: how many working days of pressing. */
					__( 'Film à commander au plus tard le %1$s. Pressage estimé : %2$d jour(s) ouvré(s).', 'teeshoop' ),
					Production::fr_date( $order_by ),
					Production::press_days( $garments, $config )
				)
			);
			if ( $garments > (int) $config['manual_above'] ) {
				echo ' <strong>' . esc_html(
					sprintf(
						/* translators: %d: the number of garments above which a human decides. */
						__( 'Au-delà de %d vêtements dans un lot, la question 23 demande une validation avant lancement.', 'teeshoop' ),
						(int) $config['manual_above']
					)
				) . '</strong>';
			}
			echo '</p>';

			echo '<table class="widefat striped"><thead><tr>';
			foreach (
				array(
					__( 'Commande', 'teeshoop' ),
					__( 'Client', 'teeshoop' ),
					__( 'Urgence', 'teeshoop' ),
					__( 'BAT', 'teeshoop' ),
					__( 'Date cible', 'teeshoop' ),
					__( 'Film avant le', 'teeshoop' ),
					__( 'Vêtements', 'teeshoop' ),
					__( 'Transferts', 'teeshoop' ),
					__( 'Encre', 'teeshoop' ),
				) as $head
			) {
				echo '<th scope="col">' . esc_html( $head ) . '</th>';
			}
			echo '</tr></thead><tbody>';

			foreach ( $rows as $row ) {
				echo '<tr>';
				printf(
					'<td><a href="%s">%s</a></td>',
					esc_url( (string) get_edit_post_link( (int) $row['id'] ) ?: admin_url( 'admin.php?page=wc-orders&action=edit&id=' . (int) $row['id'] ) ),
					esc_html( $row['ref'] )
				);
				echo '<td>' . esc_html( $row['customer'] ) . '</td>';
				echo '<td>' . esc_html( PriceRule::URGENCES[ $row['urgency'] ] ?? $row['urgency'] ) . '</td>';
				echo '<td>' . esc_html(
					sprintf(
						/* translators: 1: proof version number, 2: who cleared it. */
						__( 'v%1$d, %2$s', 'teeshoop' ),
						(int) $row['bat']['version'],
						'client' === $row['bat']['by'] ? __( 'validé par le client', 'teeshoop' ) : __( 'renonciation atelier', 'teeshoop' )
					)
				) . '</td>';
				echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( Production::fr_date( $row['target_on'] ) ) . '</td>';
				echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( Production::fr_date( $row['order_by'] ) );
				if ( $row['late'] ) {
					echo '<br><strong>' . esc_html__( 'en retard', 'teeshoop' ) . '</strong>';
				}
				echo '</td>';
				echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( (string) (int) $row['garments'] ) . '</td>';
				echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( (string) (int) $row['transfers'] ) . '</td>';
				echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( Money::number( (float) $row['ink_sq_cm'], 0 ) . ' cm²' ) . '</td>';
				echo '</tr>';
			}
			echo '</tbody></table>';
		}

		$studio = self::studio_url();
		echo '<p>';
		if ( '' === $studio ) {
			echo esc_html__( 'Pour imbriquer ces commandes, renseignez l’adresse du studio dans les réglages Teeshoop : c’est là que les planches sont calculées et que le dossier d’atelier est produit.', 'teeshoop' );
		} else {
			printf(
				'<a class="button button-primary" href="%s" target="_blank" rel="noopener">%s</a> ',
				esc_url( $studio ),
				esc_html__( 'Imbriquer dans le studio', 'teeshoop' )
			);
			echo esc_html__( 'Le studio lit cette même file, imbrique les commandes choisies sur un seul film et renvoie le lot ici.', 'teeshoop' );
		}
		echo '</p>';
	}

	private static function lots_table( array $lots ): void {
		echo '<h2>' . esc_html__( 'Lots', 'teeshoop' ) . '</h2>';

		if ( array() === $lots ) {
			echo '<p>' . esc_html__( 'Aucun lot n’a encore été constitué. Un lot est un film acheté une fois pour plusieurs commandes ; il se crée depuis le studio, après imbrication.', 'teeshoop' ) . '</p>';
			return;
		}

		echo '<table class="widefat striped"><thead><tr>';
		foreach (
			array(
				__( 'Lot', 'teeshoop' ),
				__( 'État', 'teeshoop' ),
				__( 'Origine', 'teeshoop' ),
				__( 'Commandes', 'teeshoop' ),
				__( 'Film', 'teeshoop' ),
				__( 'Coût', 'teeshoop' ),
				__( 'Économie', 'teeshoop' ),
				__( 'Action', 'teeshoop' ),
			) as $head
		) {
			echo '<th scope="col">' . esc_html( $head ) . '</th>';
		}
		echo '</tr></thead><tbody>';

		$states = Production::states();
		foreach ( $lots as $lot ) {
			$bill = (array) ( $lot['bill'] ?? array() );
			echo '<tr>';
			echo '<td>' . esc_html( '#' . (int) $lot['lot_id'] ) . '<br><small>' . esc_html( Production::fr_date( (string) $lot['created_on'] ) ) . '</small></td>';
			echo '<td>' . esc_html( $states[ $lot['state'] ] ?? $lot['state'] ) . '</td>';
			echo '<td>' . esc_html( 'es' === $lot['origin'] ? __( 'Espagne', 'teeshoop' ) : __( 'France', 'teeshoop' ) ) . '</td>';
			echo '<td>';
			foreach ( (array) $lot['members'] as $member ) {
				echo esc_html( $member['ref'] ) . '<br>';
			}
			echo '</td>';
			echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( Money::number( (float) ( $lot['layout']['pooled_m'] ?? 0 ), 2 ) . ' m' ) . '</td>';
			echo '<td style="font-variant-numeric:tabular-nums">' . esc_html( Money::format( (int) ( $bill['total_ht'] ?? 0 ) ) ) . '</td>';
			echo '<td style="font-variant-numeric:tabular-nums">';
			$saved = (int) ( $bill['saved_ht'] ?? 0 );
			echo esc_html( Money::format( $saved ) );
			if ( ! empty( $bill['worse'] ) ) {
				echo '<br><strong>' . esc_html__( 'plus cher que séparément', 'teeshoop' ) . '</strong>';
			}
			echo '</td>';
			echo '<td>';
			self::state_button( (int) $lot['lot_id'], (string) $lot['state'] );
			echo '</td>';
			echo '</tr>';

			if ( ! empty( $lot['warnings'] ) ) {
				echo '<tr><td colspan="8"><ul style="list-style:disc;margin-left:1.5em">';
				foreach ( (array) $lot['warnings'] as $warning ) {
					echo '<li>' . esc_html( (string) $warning ) . '</li>';
				}
				echo '</ul></td></tr>';
			}
		}
		echo '</tbody></table>';
	}

	/**
	 * The one write this screen offers, and it says what will happen.
	 *
	 * « Commander le film » and then « Film commandé », never « Valider » and
	 * « Succès ». The wording is the difference between a button an operator
	 * presses knowing it spends money and one they press to make a row go green.
	 */
	private static function state_button( int $lot_id, string $state ): void {
		$next = array(
			Production::DRAFT    => array( Production::SENT, __( 'Commander le film', 'teeshoop' ) ),
			Production::SENT     => array( Production::RECEIVED, __( 'Marquer le film reçu', 'teeshoop' ) ),
			Production::RECEIVED => array( Production::DONE, __( 'Clore le lot', 'teeshoop' ) ),
		);
		if ( ! isset( $next[ $state ] ) ) {
			echo esc_html__( 'Terminé', 'teeshoop' );
			return;
		}
		[ $to, $label ] = $next[ $state ];
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( self::ACTION_STATE );
		echo '<input type="hidden" name="action" value="' . esc_attr( self::ACTION_STATE ) . '">';
		echo '<input type="hidden" name="lot" value="' . esc_attr( (string) $lot_id ) . '">';
		echo '<input type="hidden" name="etat" value="' . esc_attr( $to ) . '">';
		echo '<button type="submit" class="button">' . esc_html( $label ) . '</button>';
		echo '</form>';
	}
}
