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

	/** Whether the last read actually reached a well-formed projection. */
	private static bool $readable = false;

	/** One marker per request, however many blocks ask for it. */
	private static bool $drawn = false;

	/** The register's home prefix for everything the price authority holds. */
	public const HOME_PRICING = 'php:Teeshoop\\Core\\Pricing::default_config()';

	/** The other two shipped configs a stored option can overtake the same way. */
	public const HOME_SHIPPING = 'php:Teeshoop\\Core\\Shipping::default_config()';
	public const HOME_INVOICE  = 'php:Teeshoop\\Core\\Invoice::default_config()';

	public static function path(): string {
		return ( defined( 'TEESHOOP_CORE_DIR' ) ? TEESHOOP_CORE_DIR : __DIR__ . '/../' ) . 'data/hypotheses.php';
	}

	/**
	 * The rows, and separately whether we were able to read them.
	 *
	 * THESE ARE TWO STATES, NOT ONE, and conflating them is the defect this
	 * project keeps finding in its own code: "there is nothing assumed here" and
	 * "I could not look" are different answers, and only one of them means the
	 * marker should stay quiet. A deploy that copies `includes/` and not `data/`
	 * would otherwise produce a shop that silently claims every figure on it is
	 * decided, which is the single thing this class exists to prevent.
	 *
	 * The file is executable PHP, so a truncated one is a ParseError and not a
	 * caught decoding failure. `require` is wrapped for that reason: a half
	 * written projection must degrade to a warning on an admin screen, never to
	 * a fatal on a product page.
	 *
	 * @return array<int,array<string,mixed>>
	 */
	public static function rows(): array {
		if ( null !== self::$cache ) {
			return self::$cache;
		}

		self::$cache    = array();
		self::$readable = false;

		$path = self::path();
		if ( ! is_readable( $path ) ) {
			return self::$cache;
		}

		try {
			$rows = require $path;
		} catch ( \Throwable $e ) {
			return self::$cache;
		}

		if ( ! is_array( $rows ) ) {
			return self::$cache;
		}

		self::$readable = true;
		self::$cache    = array_values( array_filter( $rows, 'is_array' ) );
		return self::$cache;
	}

	/** Whether the projection was actually read. False is a fault, not an empty register. */
	public static function readable(): bool {
		self::rows();
		return self::$readable;
	}

	/**
	 * Top-level price-config keys a stored option overrides.
	 *
	 * The register homes every money row at `Pricing::default_config()`, which is
	 * what ships. What the cart charges is `Settings::pricing()`, the stored
	 * `teeshoop_pricing` option merged over those defaults, and the README
	 * documents that option as the supported way to change one value. So an
	 * overridden key means the row's statement describes the shipped default and
	 * not what this shop charges, and the screen says so rather than letting the
	 * reader assume otherwise. Only the key names are read, never the values:
	 * this method is about provenance, not about money.
	 *
	 * @return string[]
	 */
	public static function overridden_keys(): array {
		$out = array();
		foreach ( self::homes() as $home ) {
			$stored = get_option( $home['option'], array() );
			if ( ! is_array( $stored ) || empty( $stored ) ) {
				continue;
			}
			foreach ( array_intersect( array_keys( $stored ), array_keys( ( $home['defaults'] )() ) ) as $key ) {
				$out[] = $key;
			}
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * Every home whose shipped value a stored option can overtake.
	 *
	 * ONE TABLE, BECAUSE THIS KEPT BEING TRUE OF ONE HOME ONLY. The mechanism
	 * was written for the price config, and session 04 added three more homes
	 * that work exactly the same way: the carriage grid, the VAT timeline and
	 * the invoice series each ship a default that a stored option replaces per
	 * top-level key. Left as it was, an operator who set the packing to
	 * 0,30 EUR would read "0,60 EUR hors taxes par pièce" on the register screen
	 * with no marker beside it, which is the register lying about the shop it
	 * describes: the exact defect that was fixed for prices and would have been
	 * reintroduced four times over.
	 *
	 * `defaults` is a callable rather than an array so nothing is computed for
	 * an option nobody has stored, and the option names are read HERE rather
	 * than in the list of home strings below: `config_key()` is used by the pure
	 * test suite, which runs with no WordPress and therefore without the
	 * plugin's own constants.
	 *
	 * @return array<int,array{home:string,option:string,defaults:callable}>
	 */
	private static function homes(): array {
		return array(
			array(
				'home'     => self::HOME_PRICING,
				'option'   => OPTION_PRICING,
				'defaults' => array( Pricing::class, 'default_config' ),
			),
			array(
				'home'     => self::HOME_SHIPPING,
				'option'   => OPTION_SHIPPING,
				'defaults' => array( Shipping::class, 'default_config' ),
			),
			array(
				'home'     => self::HOME_INVOICE,
				'option'   => OPTION_INVOICE,
				'defaults' => array( Invoice::class, 'default_config' ),
			),
		);
	}

	/**
	 * The same homes, as strings, with nothing WordPress about them.
	 *
	 * @return string[]
	 */
	private static function home_prefixes(): array {
		return array( self::HOME_PRICING, self::HOME_SHIPPING, self::HOME_INVOICE );
	}

	/**
	 * The price-config key a row's home reads, or '' when it reads none.
	 *
	 * `php:…Pricing::default_config()#garments.tee.base_ht+garments.tee.first_side_ht`
	 * is about `garments`. Only the first segment matters, because that is the
	 * granularity `Pricing::merge_config` overwrites at.
	 */
	public static function config_key( string $home ): string {
		foreach ( self::home_prefixes() as $prefix ) {
			if ( 0 !== strpos( $home, $prefix . '#' ) ) {
				continue;
			}
			$path = substr( $home, strlen( $prefix ) + 1 );
			$path = explode( '+', $path )[0];
			return explode( '.', $path )[0];
		}
		return '';
	}

	/**
	 * Whether a stored setting has overtaken this row.
	 *
	 * THIS IS THE HALF THE CI GUARD STRUCTURALLY CANNOT DO. It runs with no
	 * WordPress and no database, so it can only ever read what the plugin
	 * SHIPS; the option that changes a price in production does not exist where
	 * it looks. This class is the one piece of the register that runs inside
	 * WordPress, so telling the reader that a sentence describes the shipped
	 * default rather than what this shop charges is its job and nobody else's.
	 */
	public static function overridden_row( array $row ): bool {
		$key = self::config_key( (string) ( $row['home'] ?? '' ) );
		return '' !== $key && in_array( $key, self::overridden_keys(), true );
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

		/*
		 * ONCE PER REQUEST, not once per block.
		 *
		 * A product page draws the buy box and the price grid, and both are about
		 * the same price config, so both used to print the same paragraph. Two
		 * identical notices on one page is the badge soup the design bar bans,
		 * and it teaches the reader to skip the thing they are supposed to read.
		 */
		if ( self::$drawn ) {
			return;
		}

		/*
		 * "Could not look" is not "nothing to say".
		 *
		 * A missing or unreadable projection produces no rows, which would render
		 * a page carrying ten assumed figures as though every one of them were
		 * decided. So the fault gets its own sentence.
		 */
		if ( ! self::readable() ) {
			self::$drawn = true;
			?>
			<p class="ts-admin-note">
				<?php
				esc_html_e(
					'Visible par vous seul : le registre des hypothèses de l’extension est introuvable ou illisible, donc cette page ne peut pas dire lesquels de ses montants sont supposés. Ce n’est pas la même chose que « tout est validé ».',
					'teeshoop'
				);
				?>
			</p>
			<?php
			return;
		}

		$rows = self::assumed_at( $home_prefix );
		if ( empty( $rows ) ) {
			return;
		}

		self::$drawn = true;
		$url         = admin_url( 'admin.php?page=teeshoop-hypotheses' );
		?>
		<p class="ts-admin-note">
			<?php
			printf(
				esc_html(
					/* translators: 1: a number of values, 2: a list of question numbers. */
					_n(
						'Visible par vous seul : %1$d valeur du calcul de prix de cette boutique est une hypothèse et non une décision de l’associé (question %2$s).',
						'Visible par vous seul : %1$d valeurs du calcul de prix de cette boutique sont des hypothèses et non des décisions de l’associé (questions %2$s).',
						count( $rows ),
						'teeshoop'
					)
				),
				count( $rows ),
				esc_html( self::question_list( $rows ) )
			);

			/*
			 * A row whose key a stored setting overwrites no longer describes
			 * what this shop charges, only what the extension ships. Saying so
			 * here matters more than on the register screen: this is the page
			 * where the prices are.
			 */
			$overtaken = array_filter( $rows, array( self::class, 'overridden_row' ) );
			if ( ! empty( $overtaken ) ) {
				echo ' ';
				printf(
					esc_html(
						/* translators: %d: a number of values. */
						_n(
							'%d d’entre elles est remplacée par un réglage enregistré, donc la phrase du registre décrit ce que l’extension livre et non ce que cette boutique facture.',
							'%d d’entre elles sont remplacées par un réglage enregistré, donc les phrases du registre décrivent ce que l’extension livre et non ce que cette boutique facture.',
							count( $overtaken ),
							'teeshoop'
						)
					),
					count( $overtaken )
				);
			}
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

		if ( ! self::readable() ) {
			// The fault and the empty register get different sentences, because
			// they call for different actions: one is a deploy to repair, the
			// other is a project with nothing left to assume.
			echo '<div class="notice notice-error"><p>' . esc_html(
				sprintf(
					/* translators: %s: a file path inside the plugin. */
					__( 'Le registre est introuvable ou illisible : %s. Tant que c’est le cas, aucune page ne peut dire lesquels de ses montants sont supposés, ce qui n’est pas la même chose que « tout est validé ». Il est engendré par « node scripts/hypotheses-guard.mjs --write » et doit être déployé avec l’extension.', 'teeshoop' ),
					'data/hypotheses.php'
				)
			) . '</p></div></div>';
			return;
		}

		if ( empty( $rows ) ) {
			echo '<p>' . esc_html__(
				'Aucune hypothèse n’est enregistrée pour la boutique : plus rien ici n’attend une réponse de l’associé.',
				'teeshoop'
			) . '</p></div>';
			return;
		}

		echo '<p>' . esc_html__(
			'Ces valeurs ont été choisies à la place de l’associé, faute de réponse, et le site s’appuie dessus. Chacune n’existe qu’à un seul endroit dans le code, et un contrôle automatique échoue si une copie apparaît ailleurs. Le registre complet, y compris ce qui ne concerne pas la boutique, est dans docs/hypotheses.json.',
			'teeshoop'
		) . '</p>';

		/*
		 * The register describes what the plugin SHIPS. A stored option can
		 * override any of it, and the README documents that as the supported way
		 * to set a value, so the reader has to be told when a row's sentence is
		 * no longer what this shop charges.
		 */
		$overridden = self::overridden_keys();
		if ( ! empty( $overridden ) ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html(
				sprintf(
					/* translators: %s: a list of configuration keys. */
					__( 'Attention : un réglage enregistré remplace ce que l’extension livre pour %s. Les lignes concernées sont marquées ci-dessous : leur phrase décrit la valeur livrée, pas celle que cette boutique facture.', 'teeshoop' ),
					implode( ', ', $overridden )
				)
			) . '</p></div>';
		}

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
			if ( self::overridden_row( $row ) ) {
				echo ' <strong>' . esc_html__( 'remplacée par un réglage enregistré', 'teeshoop' ) . '</strong>';
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
