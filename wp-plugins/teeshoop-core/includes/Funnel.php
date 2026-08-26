<?php
/**
 * The conversion funnel, counted from records rather than from a tracker.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO ANALYTICS SCRIPT BEHIND THIS
 *
 * Chapter 07 of the brief asks for a dashboard: « Appels, conversations,
 * opportunités, rendez-vous, devis, paiements et retards » daily, and a monthly
 * « CA, panier, nouveaux clients, réassort, coût acquisition ». The half of that
 * which belongs to the site is already written down: a quote request IS a post
 * with a status, an order IS an order with a total, and an invoice IS a numbered
 * row. Counting them writes nothing on anybody's machine, processes no personal
 * data in aggregate, needs no consent, and costs one query per report instead of
 * one write per page view on shared hosting where a category page already takes
 * 2 431 ms.
 *
 * So this file is arithmetic over records. What it deliberately does NOT do is
 * count visits: that needs either a tracker on every request or a log parser,
 * and Search Console plus the server's own access log give it for free without
 * asking anybody's permission. A page-view counter would have been the expensive
 * way to learn something we can already read.
 *
 * WHAT IT CANNOT SEE, AND SAYS SO. The origin of a request is only known when
 * the visitor allowed it (see `Consent`), so `par_origine` reports a
 * « non renseigné » row rather than a total that quietly excludes the refusals.
 * A funnel that hides its own blind spot is worse than one that has none,
 * because it gets used for a decision.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Funnel {

	private const SLUG = 'teeshoop-tunnel';

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Tunnel Teeshoop', 'teeshoop' ),
			__( 'Tunnel', 'teeshoop' ),
			'manage_woocommerce',
			self::SLUG,
			array( self::class, 'screen' )
		);
	}

	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}

	// -----------------------------------------------------------------------
	// The arithmetic
	// -----------------------------------------------------------------------

	/**
	 * Everything the site knows about its own funnel, between two dates.
	 *
	 * `$from` and `$to` are `Y-m-d` and INCLUSIVE at both ends. They are
	 * parameters and not a clock read: the screen, the command line and any
	 * future test all see the same window, and a run can be replayed. Every
	 * other dated report in this plugin does the same and for the same reason.
	 *
	 * @return array<string,mixed>
	 */
	public static function report( string $from, string $to ): array {
		$devis = self::quotes( $from, $to );

		return array(
			'du'          => $from,
			'au'          => $to,
			'devis'       => $devis,
			'commandes'   => self::orders( $from, $to ),
			'par_origine' => self::origins( $from, $to ),
		);
	}

	/**
	 * Quote requests received in the window, by the state they are in now.
	 *
	 * COUNTED ON THE DATE THEY ARRIVED, not on the date they were last touched,
	 * because the question is "of the requests that came in during March, how
	 * many became orders". Counting by current state and current date would put
	 * a January request accepted in March into March's intake and inflate both
	 * ends of the same ratio.
	 *
	 * @return array<string,mixed>
	 */
	private static function quotes( string $from, string $to ): array {
		$by_status = array();
		foreach ( array_keys( Quote::STATUSES ) as $status ) {
			$by_status[ $status ] = 0;
		}

		$ids = get_posts(
			array(
				'post_type'        => Quote::POST_TYPE,
				'post_status'      => array_keys( Quote::STATUSES ),
				'posts_per_page'   => -1,
				'fields'           => 'ids',
				'no_found_rows'    => true,
				'suppress_filters' => false,
				'date_query'       => array(
					array(
						'after'     => $from . ' 00:00:00',
						'before'    => $to . ' 23:59:59',
						'inclusive' => true,
					),
				),
			)
		);

		/*
		 * AND HOW MANY CARRY NO ESTIMATE, because zero has three meanings here.
		 *
		 * `Quote::submit()` stores `_ts_estimate_ht = 0` when the request names
		 * no garment (the standalone /devis/ page posts product_id 0), when the
		 * quantity is past the public grid, and when the quote threw. It records
		 * which in `_ts_estimate_why`. Summing the meta blindly and printing the
		 * total under « Demandes reçues : N » invites the obvious division, and
		 * the average it gives is wrong by the ratio of priced to unpriced
		 * requests. The origins block three tables lower already says its own
		 * blind spot out loud; this one now does too.
		 */
		$estimated = 0;
		$unpriced  = 0;
		foreach ( $ids as $id ) {
			$status = (string) get_post_status( (int) $id );
			if ( isset( $by_status[ $status ] ) ) {
				++$by_status[ $status ];
			}
			$cents      = (int) get_post_meta( (int) $id, '_ts_estimate_ht', true );
			$estimated += $cents;
			if ( $cents <= 0 ) {
				++$unpriced;
			}
		}

		$total    = count( $ids );
		$accepted = (int) ( $by_status['ts-accepte'] ?? 0 );

		return array(
			'total'         => $total,
			'par_etat'      => $by_status,
			'acceptes'      => $accepted,
			/*
			 * A RATE IS NULL WHEN THERE IS NOTHING TO DIVIDE, never zero. "0 %"
			 * on a month with no requests is a statement about performance;
			 * "aucune demande" is a statement about the month, and they lead to
			 * opposite decisions.
			 */
			'taux_accepte'  => $total > 0 ? $accepted / $total : null,
			'estimation_ht' => $estimated,
			'sans_estimation' => $unpriced,
		);
	}

	/**
	 * Orders placed in the window, and what actually got paid.
	 *
	 * `wc_get_orders` rather than SQL, because HPOS moved the table and a query
	 * written against `wp_posts` would silently return nothing on a shop with
	 * high-performance order storage switched on, which teeshoop.com has.
	 *
	 * @return array<string,mixed>
	 */
	private static function orders( string $from, string $to ): array {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return array(
				'total'    => 0,
				'payees'   => 0,
				'ca_ttc'   => 0,
				'lisible'  => false,
			);
		}

		/*
		 * THE STATUSES ARE NAMED, not taken from whatever the registry holds.
		 *
		 * `wc_get_order_statuses()` is filtered, and the block checkout adds
		 * `wc-checkout-draft` to it: WooCommerce's Store API creates one of those
		 * rows as soon as a visitor touches the form, and its own comment calls
		 * them "orphaned rows from form interactions that never complete". Taking
		 * the registry wholesale therefore counted a browser who typed a postcode
		 * and left as a « commande passée », in the denominator of the devis to
		 * order ratio the associate reads. Worse, a daily cron deletes expired
		 * drafts, so a closed month kept shrinking every time the report was run.
		 */
		$statuses = array_values( array_diff( array_keys( wc_get_order_statuses() ), array( 'wc-checkout-draft' ) ) );

		$orders = wc_get_orders(
			array(
				'limit'        => -1,
				'type'         => 'shop_order',
				'status'       => $statuses,
				'date_created' => $from . '...' . $to,
				'return'       => 'objects',
			)
		);

		$paid     = 0;
		$invoiced = 0;
		$refunded = 0;
		foreach ( $orders as $order ) {
			if ( ! $order instanceof \WC_Order ) {
				continue;
			}
			if ( $order->is_paid() || null !== $order->get_date_paid() ) {
				++$paid;
				// Integer cents, like every other amount in this plugin. A float
				// total summed over a month is how a report and an invoice stop
				// agreeing in the third decimal.
				$invoiced += Money::from_eur( (string) $order->get_total() );

				/*
				 * AND WHAT WENT BACK OUT. `get_total()` is the gross and does not
				 * net a refund; `get_date_paid()` survives one, so a fully
				 * refunded order counted as paid AND booked its whole total.
				 * Measured on order 64867 of the mirror: 750,00 EUR, refunded in
				 * two halves, status `wc-refunded`, and the screen read 750,00
				 * EUR of cash. A refund is its own row rather than folded in, so
				 * the two facts stay separable.
				 */
				$refunded += Money::from_eur( (string) $order->get_total_refunded() );
			}
		}

		return array(
			'total'    => count( $orders ),
			'payees'   => $paid,
			'facture'  => $invoiced,
			'rembourse' => $refunded,
			'ca_ttc'   => $invoiced - $refunded,
			'lisible'  => true,
		);
	}

	/**
	 * Which page produced each request, and how many we cannot attribute.
	 *
	 * TWO SOURCES WITH TWO LEGAL BASES, kept apart on purpose. `_ts_page` is the
	 * page the form was submitted from and is always known, because reading the
	 * request that is being handled stores nothing on a visitor's machine.
	 * `_ts_src_page` is the page they first arrived on and exists only when they
	 * allowed it. A row that merged the two would report the devis page as the
	 * origin of every request, which is true and useless.
	 *
	 * @return array<string,mixed>
	 */
	private static function origins( string $from, string $to ): array {
		$ids = get_posts(
			array(
				'post_type'      => Quote::POST_TYPE,
				'post_status'    => array_keys( Quote::STATUSES ),
				'posts_per_page' => -1,
				'fields'         => 'ids',
				'no_found_rows'  => true,
				'date_query'     => array(
					array(
						'after'     => $from . ' 00:00:00',
						'before'    => $to . ' 23:59:59',
						'inclusive' => true,
					),
				),
			)
		);

		$forms   = array();
		$landing = array();
		$refs    = array();
		$unknown = 0;

		foreach ( $ids as $id ) {
			$page = (string) get_post_meta( (int) $id, '_ts_page', true );
			$key  = '' !== $page ? $page : __( '(page inconnue)', 'teeshoop' );
			$forms[ $key ] = ( $forms[ $key ] ?? 0 ) + 1;

			$src = (string) get_post_meta( (int) $id, '_ts_src_page', true );
			if ( '' === $src ) {
				++$unknown;
			} else {
				$landing[ $src ] = ( $landing[ $src ] ?? 0 ) + 1;
			}

			$ref = (string) get_post_meta( (int) $id, '_ts_src_ref', true );
			if ( '' !== $ref ) {
				$refs[ $ref ] = ( $refs[ $ref ] ?? 0 ) + 1;
			}
		}

		arsort( $forms );
		arsort( $landing );
		arsort( $refs );

		return array(
			'formulaire'   => $forms,
			'arrivee'      => $landing,
			'referents'    => $refs,
			'sans_origine' => $unknown,
		);
	}

	// -----------------------------------------------------------------------
	// The screen
	// -----------------------------------------------------------------------

	public static function screen(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a read-only report; the window is a navigation choice.
		$to   = isset( $_GET['au'] ) ? sanitize_text_field( wp_unslash( $_GET['au'] ) ) : Settings::today();
		$from = isset( $_GET['du'] ) ? sanitize_text_field( wp_unslash( $_GET['du'] ) ) : gmdate( 'Y-m-d', strtotime( $to . ' -30 days' ) );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		$from   = self::valid_date( $from, gmdate( 'Y-m-d', strtotime( Settings::today() . ' -30 days' ) ) );
		$to     = self::valid_date( $to, Settings::today() );
		$report = self::report( $from, $to );

		echo '<div class="wrap"><h1>' . esc_html__( 'Tunnel', 'teeshoop' ) . '</h1>';

		echo '<form method="get" action="' . esc_url( admin_url( 'admin.php' ) ) . '">';
		echo '<input type="hidden" name="page" value="' . esc_attr( self::SLUG ) . '">';
		printf(
			'<label>%s <input type="date" name="du" value="%s"></label> ',
			esc_html__( 'Du', 'teeshoop' ),
			esc_attr( $from )
		);
		printf(
			'<label>%s <input type="date" name="au" value="%s"></label> ',
			esc_html__( 'au', 'teeshoop' ),
			esc_attr( $to )
		);
		echo '<button class="button">' . esc_html__( 'Afficher', 'teeshoop' ) . '</button>';
		echo '</form>';

		self::render_report( $report );

		echo '</div>';
	}

	/** @param array<string,mixed> $report */
	private static function render_report( array $report ): void {
		$devis  = (array) $report['devis'];
		$orders = (array) $report['commandes'];

		echo '<h2>' . esc_html__( 'Demandes de devis', 'teeshoop' ) . '</h2>';

		if ( 0 === (int) $devis['total'] ) {
			/*
			 * THE EMPTY STATE IS THE SHIPPED STATE and it has to say something
			 * an operator can act on. Nothing has been sold through this site
			 * yet; a table of zeroes would read as a broken screen.
			 */
			echo '<p>' . esc_html__( 'Aucune demande sur cette période. Le tunnel se remplit à partir du formulaire de devis : tant que le site n’est pas en ligne, cet écran reste vide et c’est normal.', 'teeshoop' ) . '</p>';
		} else {
			echo '<table class="widefat striped" style="max-width:48rem"><tbody>';
			self::row( __( 'Demandes reçues', 'teeshoop' ), (string) (int) $devis['total'] );
			foreach ( Quote::STATUSES as $status => $label ) {
				self::row( '   ' . $label, (string) (int) ( $devis['par_etat'][ $status ] ?? 0 ) );
			}
			self::row(
				__( 'Taux d’acceptation', 'teeshoop' ),
				null === $devis['taux_accepte']
					? esc_html__( 'sans objet', 'teeshoop' )
					: Money::number( $devis['taux_accepte'] * 100, 1 ) . "\u{00A0}%"
			);
			self::row( __( 'Estimation cumulée des demandes, hors taxes', 'teeshoop' ), Money::format( (int) $devis['estimation_ht'] ) );
			self::row( __( 'Dont demandes sans estimation', 'teeshoop' ), (string) (int) $devis['sans_estimation'] );
			echo '</tbody></table>';
			echo '<p class="description">' . esc_html__( 'Une demande sans estimation ne vaut pas zéro : elle ne nomme aucun article, ou sa quantité dépasse la grille publique. Diviser l’estimation cumulée par le nombre de demandes donne donc une moyenne fausse tant que cette ligne n’est pas nulle.', 'teeshoop' ) . '</p>';

			self::render_origins( (array) $report['par_origine'], (int) $devis['total'] );
		}

		echo '<h2>' . esc_html__( 'Commandes', 'teeshoop' ) . '</h2>';
		if ( empty( $orders['lisible'] ) ) {
			echo '<p>' . esc_html__( 'WooCommerce n’est pas disponible : les commandes ne peuvent pas être comptées.', 'teeshoop' ) . '</p>';
		} else {
			echo '<table class="widefat striped" style="max-width:48rem"><tbody>';
			self::row( __( 'Commandes passées', 'teeshoop' ), (string) (int) $orders['total'] );
			self::row( __( 'Dont payées', 'teeshoop' ), (string) (int) $orders['payees'] );
			self::row( __( 'Facturé, toutes taxes comprises', 'teeshoop' ), Money::format( (int) $orders['facture'] ) );
			self::row( __( 'Remboursé', 'teeshoop' ), Money::format( (int) $orders['rembourse'] ) );
			self::row( __( 'Net, toutes taxes comprises', 'teeshoop' ), Money::format( (int) $orders['ca_ttc'] ) );
			echo '</tbody></table>';
			echo '<p class="description">' . esc_html__( 'Les brouillons que le tunnel de commande crée quand un visiteur touche le formulaire sans jamais payer ne sont pas comptés. Une commande remboursée reste comptée comme payée, et son remboursement figure sur sa propre ligne : « payée » et « encaissée » ne sont pas la même chose.', 'teeshoop' ) . '</p>';
		}
	}

	/** @param array<string,mixed> $origins */
	private static function render_origins( array $origins, int $total ): void {
		echo '<h2>' . esc_html__( 'D’où viennent les demandes', 'teeshoop' ) . '</h2>';

		echo '<p class="description">';
		printf(
			/* translators: %d: how many requests carry no recorded origin. */
			esc_html__( 'La page du formulaire est toujours connue. La page d’arrivée sur le site n’est enregistrée que pour les visiteurs qui l’ont autorisée : %d demande(s) n’en portent aucune, et ce n’est pas une erreur.', 'teeshoop' ),
			(int) $origins['sans_origine']
		);
		echo '</p>';

		self::render_counts( __( 'Page du formulaire', 'teeshoop' ), (array) $origins['formulaire'], $total );
		self::render_counts( __( 'Page d’arrivée', 'teeshoop' ), (array) $origins['arrivee'], $total );
		self::render_counts( __( 'Site référent', 'teeshoop' ), (array) $origins['referents'], $total );
	}

	/** @param array<string,int> $counts */
	private static function render_counts( string $title, array $counts, int $total ): void {
		if ( empty( $counts ) ) {
			return;
		}
		echo '<h3>' . esc_html( $title ) . '</h3>';
		echo '<table class="widefat striped" style="max-width:48rem"><tbody>';
		foreach ( array_slice( $counts, 0, 20, true ) as $key => $count ) {
			self::row(
				(string) $key,
				sprintf(
					'%d (%s %%)',
					(int) $count,
					Money::number( $total > 0 ? ( $count / $total ) * 100 : 0, 1 )
				)
			);
		}
		echo '</tbody></table>';
	}

	private static function row( string $label, string $value ): void {
		printf(
			'<tr><th scope="row" style="width:24rem">%s</th><td style="font-variant-numeric:tabular-nums">%s</td></tr>',
			esc_html( $label ),
			esc_html( $value )
		);
	}

	private static function valid_date( string $raw, string $fallback ): string {
		$parsed = \DateTimeImmutable::createFromFormat( '!Y-m-d', $raw );
		return ( $parsed && $parsed->format( 'Y-m-d' ) === $raw ) ? $raw : $fallback;
	}
}
