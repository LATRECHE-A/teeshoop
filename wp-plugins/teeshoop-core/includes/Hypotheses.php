<?php
/**
 * What the shop is still assuming, said to the person who could correct it.
 *
 * The associate has not answered `QUESTIONS-ASSOCIE.md`, and the decision of
 * 18/08/2026 is to build on the written default hypotheses rather than stop.
 * Rule 2 of that decision, in his own document, is that a supposed amount must
 * be marked as one ON SCREEN, for him and for the workshop: "un nombre inventé
 * qui ressemble à un nombre validé est le pire des deux mondes".
 *
 * This class is that rule. It renders one marker, never a badge on every
 * figure, and it renders it from `docs/hypotheses.json` rather than from prose
 * typed into a template. That matters for a reason session 03b found the hard
 * way: the two admin notes this replaced both sent the reader to question 04,
 * which is about DTF supplier rates. The selling grid is questions 03, 06 and
 * 08. A hand-written pointer to the wrong question is worse than none, because
 * it is followed.
 *
 * WHERE THE DATA COMES FROM. `wp-plugins/teeshoop-core/data/hypotheses.php` is
 * written by `scripts/hypotheses-guard.mjs --write` and is a FILTERED projection
 * of the register: only rows whose home is inside this plugin cross over. That
 * filter is a boundary, not plumbing. Film economics, purchase costs and
 * supplier terms have rows in the register and must never enter a directory
 * `scripts/php-guard.mjs` scans. The guard fails when the projection is stale.
 *
 * It is PHP and not JSON because this directory answers HTTP. The rows say what
 * the shop does not enforce and what nobody has priced yet, which is nobody
 * else's business, and an unguessable path is not an access control.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Hypotheses {

	/** @var array<int,array<string,mixed>>|null Parsed once per request. */
	private static ?array $cache = null;

	/** The register's home prefix for everything the price authority holds. */
	public const HOME_PRICING = 'php:Teeshoop\\Core\\Pricing::default_config()';

	public static function path(): string {
		return ( defined( 'TEESHOOP_CORE_DIR' ) ? TEESHOOP_CORE_DIR : __DIR__ . '/../' ) . 'data/hypotheses.php';
	}

	/**
	 * The rows, or none.
	 *
	 * None is a legible state: no marker is drawn, which is what a shop with
	 * nothing left to assume should look like. It is never a guess, and the
	 * continuous integration check refuses a missing or stale file, so "none"
	 * here cannot quietly mean "the file went away".
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function rows(): array {
		if ( null !== self::$cache ) {
			return self::$cache;
		}

		$path = self::path();
		if ( ! is_readable( $path ) ) {
			self::$cache = array();
			return self::$cache;
		}

		$rows = require $path;

		self::$cache = is_array( $rows ) ? array_values( array_filter( $rows, 'is_array' ) ) : array();
		return self::$cache;
	}

	/**
	 * The rows still assumed whose value lives at `$home_prefix`.
	 *
	 * Prefix and not equality, because one home string carries the path into
	 * the value: every row of the price config starts with the same call and
	 * ends with a different key.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function assumed_at( string $home_prefix ): array {
		$out = array();
		foreach ( self::rows() as $row ) {
			if ( 'assumption' !== ( $row['status'] ?? '' ) ) {
				continue;
			}
			if ( 0 !== strpos( (string) ( $row['home'] ?? '' ), $home_prefix ) ) {
				continue;
			}
			$out[] = $row;
		}
		return $out;
	}

	/** The questions behind a set of rows, sorted and deduplicated: "02, 06, 08". */
	public static function question_list( array $rows ): string {
		$numbers = array();
		foreach ( $rows as $row ) {
			$q = (string) ( $row['question'] ?? '' );
			if ( '' !== $q ) {
				$numbers[] = substr( $q, 1 );
			}
		}
		$numbers = array_unique( $numbers );
		sort( $numbers );
		return implode( ', ', $numbers );
	}

	/**
	 * The one marker, for a reader who can act on it.
	 *
	 * Shown only to someone with `manage_woocommerce`, because a customer
	 * reading "these prices are assumptions" learns nothing they can use and
	 * doubts a number that is otherwise computed correctly. What a customer
	 * gets instead is the French wording each figure is displayed under, which
	 * the register requires and the guard checks.
	 *
	 * THE CAPABILITY IS CHECKED HERE, not only at the call site. Two templates
	 * call this today and a third will one day; a rule enforced once per caller
	 * is a rule that leaks the first time somebody forgets. This is the same
	 * argument the rest of the session makes about values, applied to a check.
	 */
	public static function note( string $home_prefix, string $also = '' ): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		$rows = self::assumed_at( $home_prefix );
		if ( empty( $rows ) ) {
			return;
		}

		$url = admin_url( 'admin.php?page=teeshoop-hypotheses' );
		?>
		<p class="ts-admin-note">
			<?php
			printf(
				esc_html(
					/* translators: 1: a number of values, 2: a list of question numbers. */
					_n(
						'Visible par vous seul : %1$d valeur de cette page est une hypothèse et non une décision de l’associé (question %2$s).',
						'Visible par vous seul : %1$d valeurs de cette page sont des hypothèses et non des décisions de l’associé (questions %2$s).',
						count( $rows ),
						'teeshoop'
					)
				),
				count( $rows ),
				esc_html( self::question_list( $rows ) )
			);
			/*
			 * A block may add one sentence of its own INSIDE this paragraph
			 * rather than beside it. Two consecutive admin notes on the same
			 * block read as decoration and get skipped; one paragraph is read.
			 */
			if ( '' !== $also ) {
				echo ' ' . esc_html( $also );
			}
			?>
			<a href="<?php echo esc_url( $url ); ?>"><?php esc_html_e( 'Le registre des hypothèses', 'teeshoop' ); ?></a>
		</p>
		<?php
	}

	public static function init(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
	}

	public static function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Hypothèses Teeshoop', 'teeshoop' ),
			__( 'Hypothèses', 'teeshoop' ),
			'manage_woocommerce',
			'teeshoop-hypotheses',
			array( self::class, 'screen' )
		);
	}

	/** How much a late answer costs, in words rather than in a code. */
	private static function cost_label( string $cost ): string {
		switch ( $cost ) {
			case 'on refait':
				return __( 'Une partie est à refaire', 'teeshoop' );
			case 'reglage et remesure':
				return __( 'Un réglage, puis une remesure', 'teeshoop' );
			default:
				return __( 'Un réglage', 'teeshoop' );
		}
	}

	/** Who meets the value, in words. */
	private static function reach_label( string $reach ): string {
		switch ( $reach ) {
			case 'customer':
				return __( 'client', 'teeshoop' );
			case 'supplier':
				return __( 'fournisseur', 'teeshoop' );
			case 'printer':
				return __( 'atelier', 'teeshoop' );
			case 'operator':
				return __( 'vous', 'teeshoop' );
			default:
				return __( 'interne', 'teeshoop' );
		}
	}

	/**
	 * The register, read-only.
	 *
	 * Read-only on purpose. Editing a hypothesis here would be editing a price
	 * from a page whose subject is that the price is not decided yet; the values
	 * themselves live in `teeshoop_pricing` and in the code, and the answer that
	 * settles them is a working session (13b), not a text field.
	 */
	public static function screen(): void {
		$rows = self::rows();
		echo '<div class="wrap">';
		echo '<h1>' . esc_html__( 'Les hypothèses de la boutique', 'teeshoop' ) . '</h1>';

		if ( empty( $rows ) ) {
			echo '<p>' . esc_html__(
				'Aucune hypothèse enregistrée pour la boutique. Si ce n’est pas ce que vous attendiez, le fichier data/hypotheses.json de l’extension est absent ou illisible.',
				'teeshoop'
			) . '</p></div>';
			return;
		}

		echo '<p>' . esc_html__(
			'Ces valeurs ont été choisies à la place de l’associé, faute de réponse, et le site s’appuie dessus. Chacune n’existe qu’à un seul endroit dans le code, et un contrôle automatique échoue si une copie apparaît ailleurs. Le registre complet, y compris ce qui ne concerne pas la boutique, est dans docs/hypotheses.json.',
			'teeshoop'
		) . '</p>';

		echo '<table class="widefat striped"><thead><tr>';
		echo '<th scope="col">' . esc_html__( 'Ce qui est supposé', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Question', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Qui la voit', 'teeshoop' ) . '</th>';
		echo '<th scope="col">' . esc_html__( 'Si la réponse arrive tard', 'teeshoop' ) . '</th>';
		echo '</tr></thead><tbody>';

		foreach ( $rows as $row ) {
			$reaches = array_map(
				array( self::class, 'reach_label' ),
				array_filter( (array) ( $row['reaches'] ?? array() ), 'is_string' )
			);

			echo '<tr>';
			echo '<td><strong>' . esc_html( (string) ( $row['statement_fr'] ?? '' ) ) . '</strong><br><code>'
				. esc_html( (string) ( $row['id'] ?? '' ) ) . '</code>';
			if ( 'refused' === ( $row['status'] ?? '' ) ) {
				echo ' <em>' . esc_html__( 'refus assumé : rien n’a été construit', 'teeshoop' ) . '</em>';
			}
			echo '</td>';
			echo '<td>' . esc_html( str_replace( 'Q', '', (string) ( $row['question'] ?? '' ) ) )
				. ' <span class="description">' . esc_html( (string) ( $row['level'] ?? '' ) ) . '</span></td>';
			echo '<td>' . esc_html( implode( ', ', $reaches ) ) . '</td>';
			echo '<td>' . esc_html( self::cost_label( (string) ( $row['cost_if_late'] ?? '' ) ) ) . '</td>';
			echo '</tr>';
		}

		echo '</tbody></table></div>';
	}
}
