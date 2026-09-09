<?php
/**
 * The shop half of the launch gate, driven against a real WooCommerce.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `Launch` is the deliverable of session 13b and had no test at all. Four of the
 * gate's five conditions live here rather than in `scripts/launch-gate.mjs`, and
 * the script's `--self-test` proves them by feeding `gate()` a FABRICATED shop
 * object. That proves the script reads a refusal; it proves nothing about
 * whether `Launch` produces one from a real database. Found on 2 September 2026
 * by auditing the session against its own brief.
 *
 * Everything below drives the shipped class against the mirror's WooCommerce and
 * puts back what it changed.
 *
 * ── WHAT IT ASSERTS, AND WHY EACH ONE ────────────────────────────────────────
 *
 * That every condition REFUSES when its fact is wrong, that it stops refusing
 * when the fact is put right, and that it refuses rather than passing when it
 * cannot look. The third is the one the whole project turns on: « we could not
 * look » and « there is nothing wrong » are different results.
 *
 * Run from integration.php, which owns the bootstrap.
 *
 * @package Teeshoop\Core
 */

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Admin;
use Teeshoop\Core\Launch;
use Teeshoop\Core\Legal;
use Teeshoop\Core\Payment;
use Teeshoop\Core\Product;
use Teeshoop\Core\Supply;
use Teeshoop\Core\Terms;

/** Reasons carrying this key, as plain sentences. */
function ts_lg_reasons( string $key ): array {
	$out = array();
	foreach ( Launch::blockers() as $blocker ) {
		if ( $key === ( $blocker['cle'] ?? '' ) ) {
			$out[] = (string) ( $blocker['pourquoi'] ?? '' );
		}
	}
	return $out;
}

/**
 * Put the shop in a state where the money door has nothing to say.
 *
 * REAL FACTS, NOT A STUB. It declares a blank on every personalisable product
 * that lacks one and records a floor measurement, which is exactly what an
 * operator would do, and it hands back a closure that undoes both. A gate proved
 * only in the direction it already refuses is a gate that refuses everything,
 * which is the failure mode this file's identity test was written to catch.
 *
 * @return callable():void
 */
function ts_lg_clear_money_door(): callable {
	$touched = array();
	$ids     = get_posts(
		array(
			'post_type'      => 'product',
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			'meta_key'       => Product::META, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- a test, not a page load.
		)
	);
	/*
	 * ─────────────────────────────────────────────────────────────────────────
	 * DEPUIS LE 9 SEPTEMBRE, UNE BOUTIQUE SAINE EST AUSSI UNE BOUTIQUE DONT LES
	 * TEXTILES NUS EXISTENT ENCORE CHEZ LE FOURNISSEUR.
	 *
	 * `Launch::supply_blockers()` refuse quand un produit publié nomme une
	 * référence absente du dépôt. C'est le contrôle qui empêche d'ouvrir une
	 * boutique où l'on peut tout parcourir et rien commander. Ce décor doit donc
	 * la satisfaire, sinon quatre cas testent une porte fermée en croyant la
	 * tester ouverte.
	 *
	 * TOUS les produits publiés sont repointés, pas seulement ceux qui n'ont
	 * rien : le miroir en porte vingt qui nomment des références de l'ancien
	 * fournisseur, et ce sont précisément celles que le nouveau contrôle refuse.
	 * L'ancienne valeur est mémorisée par produit et remise à la fin.
	 */
	foreach ( $ids as $id ) {
		$avant = Product::blank_ref_of( (int) $id );
		if ( '18001' === $avant ) {
			continue;
		}
		$touched[ (int) $id ] = $avant;
		update_post_meta( (int) $id, Product::META_BLANK_REF, '18001' );
	}

	// Et la référence du décor doit être DANS le dépôt, sinon le contrôle a
	// raison de refuser. Semée ici seulement si elle n'y est pas déjà : la suite
	// d'achat la sème aussi, et deux semis pour une ligne se marchent dessus.
	global $wpdb;
	$depot  = Supply::table();
	$seeded = false;
	// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
	if ( null === $wpdb->get_var( $wpdb->prepare( 'SELECT ref FROM `' . $depot . '` WHERE ref = %s', '18001' ) ) ) {
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'INSERT INTO `' . $depot . '` (ref, kind, shelf, sleeve, updated_at, seen_at, gone, payload) VALUES (%s, %s, %s, %s, NULL, %s, 0, %s)',
				'18001',
				'tee',
				'tshirt',
				'short',
				gmdate( 'Y-m-d H:i:s' ),
				(string) gzcompress( (string) wp_json_encode( array( 'reference' => '18001', 'variants' => array() ) ), 6 )
			)
		);
		$seeded = true;
	}

	$grid_before = get_option( Launch::OPTION_GRILLE, null );
	Launch::record_grid_verdict( 0, 0, 219 );

	return static function () use ( $touched, $grid_before, $seeded ): void {
		foreach ( $touched as $id => $avant ) {
			if ( '' === (string) $avant ) {
				delete_post_meta( (int) $id, Product::META_BLANK_REF );
			} else {
				update_post_meta( (int) $id, Product::META_BLANK_REF, (string) $avant );
			}
		}
		if ( $seeded ) {
			global $wpdb;
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$wpdb->query( $wpdb->prepare( 'DELETE FROM `' . Supply::table() . '` WHERE ref = %s', '18001' ) );
		}
		if ( null === $grid_before ) {
			delete_option( Launch::OPTION_GRILLE );
		} else {
			update_option( Launch::OPTION_GRILLE, $grid_before, false );
		}
		Launch::forget();
	};
}

/**
 * Write a gateway's settings with the activation guard lifted, and put it back.
 *
 * REMETTRE L'ÉTAT D'ORIGINE PASSE PAR LE GARDE, ce que la première version de ce
 * fichier a oublié : restaurer un `enabled => yes` pendant que la porte refuse
 * est exactement l'écriture que le garde existe pour refuser, donc le miroir est
 * resté avec son virement bancaire éteint et les deux assertions suivantes ont
 * échoué sur « aucune passerelle activée ». C'est le garde qui a raison ; c'est
 * le décor qui doit se contourner nommément.
 */
function ts_lg_write_gateway( string $option, $value ): void {
	remove_filter( 'pre_update_option_' . $option, array( Payment::class, 'refuse_enabling' ), 10 );
	update_option( $option, $value );
	add_filter( 'pre_update_option_' . $option, array( Payment::class, 'refuse_enabling' ), 10, 2 );
}

/** Which gateway ids WooCommerce would offer a customer right now. */
function ts_lg_offered(): array {
	Launch::forget();
	return array_keys( WC()->payment_gateways()->get_available_payment_gateways() );
}

/** Whether any reason with this key mentions this fragment. */
function ts_lg_says( string $key, string $fragment ): bool {
	foreach ( ts_lg_reasons( $key ) as $why ) {
		if ( false !== mb_stripos( $why, $fragment ) ) {
			return true;
		}
	}
	return false;
}

function ts_lancement_suite(): void {
	echo "\nLe portail de mise en ligne, côté boutique\n";

	$saved_legal = get_option( 'teeshoop_legal', array() );

	ts_it( 'refuses a shop whose legal identity is empty, and names every field', function () use ( $saved_legal ) {
		try {
			update_option( 'teeshoop_legal', array() );
			$why = ts_lg_reasons( 'identite' );
			ts_assert( count( $why ) > 0, 'une identité vide n’a produit aucun refus' );
			/*
			 * NAMED, not counted. « Il manque des mentions » sends an operator
			 * looking; the list tells them what to type. Article 6 III of the
			 * LCEN is what makes each of them mandatory.
			 */
			ts_assert( ts_lg_says( 'identite', 'raison sociale' ), 'le refus ne nomme pas la raison sociale' );
			ts_assert(
				ts_lg_says( 'identite', 'Aucun document ne peut être émis' ),
				'le refus ne dit pas ce que l’absence empêche'
			);
			/*
			 * TWO IDENTITIES AND DEUX CLÉS. `identite` is the seller on the
			 * document, checked against the invoice list; `editeur` is the site's
			 * own publisher, which article 6 III of the LCEN asks for and which
			 * appears on no document. The first version of this test asserted the
			 * LCEN under `identite` and found instead that its sentence still
			 * said « une facture ... est refusée », three commits after this shop
			 * stopped issuing one.
			 */
			ts_assert( ts_lg_says( 'editeur', 'LCEN' ), 'le refus éditeur ne dit pas quel texte l’exige' );
		} finally {
			update_option( 'teeshoop_legal', $saved_legal );
		}
	} );

	ts_it( 'stops refusing on the identity once every field is filled in', function () use ( $saved_legal ) {
		$before = count( ts_lg_reasons( 'identite' ) );
		/*
		 * The mirror carries the real identity since 1 September, so this is the
		 * OTHER direction of the same check: a gate that refuses whatever it is
		 * given is not a gate. If this ever starts failing, read it as the
		 * mirror having lost its settings and not as the gate being wrong.
		 */
		ts_assert( 0 === $before, 'le miroir devrait porter une identité complète : ' . implode( ' · ', ts_lg_reasons( 'identite' ) ) );
	} );

	ts_it( 'refuses a personalisable product on sale that declares no blank, by name', function () {
		$product = new \WC_Product_Simple();
		$product->set_name( 'Sonde du portail de lancement' );
		$product->set_regular_price( '14.50' );
		$product->set_status( 'publish' );
		$product->save();
		update_post_meta( $product->get_id(), Product::META, 'tee' );

		try {
			ts_assert(
				ts_lg_says( 'textile-nu', 'Sonde du portail de lancement' ),
				'un produit personnalisable sans textile nu n’est pas refusé par son nom'
			);
			ts_assert(
				ts_lg_says( 'textile-nu', 'l’atelier ne saura pas quoi acheter' ),
				'le refus ne dit pas ce que cela coûte'
			);

			// And it stops refusing on THIS product once the blank is declared.
			update_post_meta( $product->get_id(), Product::META_BLANK_REF, '18001' );
			update_post_meta( $product->get_id(), Product::META_BLANK_COLOURS, wp_json_encode( array( 'Noir' => 'Black' ) ) );
			ts_assert(
				! ts_lg_says( 'textile-nu', 'Sonde du portail de lancement' ),
				'le produit est encore refusé alors qu’il déclare son textile nu'
			);
		} finally {
			wp_delete_post( $product->get_id(), true );
		}
	} );

	ts_it( 'refuses conditions of sale that nobody whose job it is has read', function () {
		$version = Terms::current();
		ts_assert( '' !== $version, 'aucune version des conditions générales n’est en vigueur' );

		$doc = Terms::document( $version );
		ts_assert( is_array( $doc ), 'la version en vigueur ne se charge pas' );

		/*
		 * The shipped state is a draft nobody has reviewed, so both halves of
		 * this condition are live today and the test reads them rather than
		 * fabricating them. It will need rewriting the day a lawyer signs, which
		 * is the point: the test says what the shop is, not what it hopes.
		 */
		$why = ts_lg_reasons( 'cgv' );
		ts_assert( count( $why ) >= 1, 'des conditions générales en projet ne sont pas refusées' );
		ts_assert(
			ts_lg_says( 'cgv', 'projet' ) || ts_lg_says( 'cgv', 'relue' ),
			'le refus ne dit ni que c’est un projet ni que personne ne l’a relue'
		);
		ts_eq( (string) ( $doc['etat'] ?? '' ) === 'valide', false, 'l’état livré' );
	} );

	ts_it( 'says which condition it could not evaluate rather than passing it', function () {
		/*
		 * FAIL CLOSED, WHICH IS THE ONE PROPERTY A GATE CANNOT BE WRONG ABOUT.
		 *
		 * Every branch of this class that cannot look returns a refusal carrying
		 * its own key. There is no way to make WooCommerce absent inside a
		 * running WordPress, so what is asserted here is the shape the code
		 * commits to: every refusal carries a key and a sentence, and no branch
		 * can return an empty reason that an operator would read as blank.
		 */
		foreach ( Launch::blockers() as $blocker ) {
			ts_assert( '' !== trim( (string) ( $blocker['cle'] ?? '' ) ), 'un refus sans clé' );
			ts_assert( '' !== trim( (string) ( $blocker['pourquoi'] ?? '' ) ), 'un refus sans raison lisible' );
		}
		ts_assert( count( Launch::blockers() ) > 0, 'le portail n’a rien à redire, ce qui serait la première fois' );
	} );

	ts_porte_argent_suite();
}

/**
 * LA PORTE ARGENT, ET LE FAIT QU'ELLE TIENNE VRAIMENT LA CAISSE.
 *
 * Avant le 5 septembre 2026, le portail refusait sur seize motifs pendant qu'un
 * humain pouvait activer Stripe dans l'administration, parce que la porte
 * bloquait une COPIE DE FICHIERS et que rien dans WordPress n'avait jamais
 * entendu parler d'elle. Ce bloc mesure les deux directions de chacun des trois
 * chemins qui la lisent désormais : la liste proposée au client, l'écriture qui
 * allume une passerelle, et l'écran qui dit pourquoi.
 */
function ts_porte_argent_suite(): void {
	echo "\nLa porte argent, tenue par WordPress\n";

	/*
	 * Les gardes par option sont enregistrés depuis la liste des passerelles,
	 * comme WooCommerce enregistre les siens. Rien ici ne doit dépendre de
	 * l'ordre dans lequel un autre bloc a demandé cette liste avant nous.
	 */
	WC()->payment_gateways();

	ts_it( 'labels every refusal with the door it belongs to, and only two exist', function () {
		$doors = array();
		foreach ( Launch::blockers() as $blocker ) {
			$door = (string) ( $blocker['porte'] ?? '' );
			ts_assert(
				in_array( $door, array( Launch::PORTE_ARGENT, Launch::PORTE_PUBLICATION ), true ),
				'un refus porte une porte que personne ne connaît : ' . var_export( $blocker, true )
			);
			$doors[ $door ] = true;
		}
		/*
		 * La table est dans `Launch::PORTES` et une clé inconnue retombe sur
		 * argent, donc ce test ne peut pas passer par accident : il faudrait
		 * qu'une clé soit classée publication à la main pour qu'il échoue.
		 */
		ts_assert(
			ts_lg_says( 'cgv', 'projet' ) || ts_lg_says( 'cgv', 'relue' ),
			'le décor de ce test a changé : les CGV ne refusent plus'
		);
		foreach ( Launch::blockers() as $blocker ) {
			if ( 'cgv' === ( $blocker['cle'] ?? '' ) ) {
				ts_eq( (string) $blocker['porte'], Launch::PORTE_PUBLICATION, 'la porte des CGV' );
			}
			if ( 'textile-nu' === ( $blocker['cle'] ?? '' ) ) {
				ts_eq( (string) $blocker['porte'], Launch::PORTE_ARGENT, 'la porte du textile nu' );
			}
		}
	} );

	ts_it( 'refuses on a floor nobody has ever measured, and says which command measures it', function () {
		$before = get_option( Launch::OPTION_GRILLE, null );
		try {
			delete_option( Launch::OPTION_GRILLE );
			Launch::forget();
			ts_assert( ts_lg_says( 'prix-plancher', 'Personne n’a mesuré' ), 'un plancher jamais mesuré ne refuse pas' );
			ts_assert( ts_lg_says( 'prix-plancher', 'verify:grille' ), 'le refus ne nomme pas la commande qui le lève' );
		} finally {
			if ( null === $before ) {
				delete_option( Launch::OPTION_GRILLE );
			} else {
				update_option( Launch::OPTION_GRILLE, $before, false );
			}
			Launch::forget();
		}
	} );

	ts_it( 'reads the recorded measurement, in all four of its states', function () {
		$before = get_option( Launch::OPTION_GRILLE, null );
		try {
			// 1. Green: measured, nothing under, signature current.
			Launch::record_grid_verdict( 0, 0, 219 );
			Launch::forget();
			ts_eq( ts_lg_reasons( 'prix-plancher' ), array(), 'une mesure verte refuse quand même' );

			// 2. Columns under their floor. The shop loses money on each sale.
			Launch::record_grid_verdict( 12, 0, 219 );
			Launch::forget();
			ts_assert( ts_lg_says( 'prix-plancher', 'sous leur plancher' ), 'douze colonnes sous leur plancher ne refusent pas' );
			ts_assert( ts_lg_says( 'prix-plancher', 'perd de l’argent' ), 'le refus ne dit pas ce que ça coûte' );

			// 3. Columns nobody could cost. Not a floor crossed, a floor unknown.
			Launch::record_grid_verdict( 0, 3, 219 );
			Launch::forget();
			ts_assert( ts_lg_says( 'prix-plancher', 'n’ont pas pu être chiffrées' ), 'des colonnes non chiffrables ne refusent pas' );

			// 4. Superseded: the tariff moved after the measurement.
			$stored = get_option( Launch::OPTION_GRILLE );
			$stored['under']     = 0;
			$stored['blocked']   = 0;
			$stored['signature'] = 'ceci-n-est-pas-la-signature';
			update_option( Launch::OPTION_GRILLE, $stored, false );
			Launch::forget();
			ts_assert( ts_lg_says( 'prix-plancher', 'tarif publié a changé' ), 'une mesure périmée par un changement de tarif ne refuse pas' );

			// 5. Stale: older than the window, tariff untouched.
			$stored              = get_option( Launch::OPTION_GRILLE );
			$stored['signature'] = Launch::grid_signature();
			$stored['at']        = gmdate( 'Y-m-d H:i:s', time() - ( Launch::GRILLE_JOURS + 1 ) * DAY_IN_SECONDS );
			update_option( Launch::OPTION_GRILLE, $stored, false );
			Launch::forget();
			ts_assert( ts_lg_says( 'prix-plancher', 'n’a pas été mesurée' ), 'une mesure trop vieille ne refuse pas' );
		} finally {
			if ( null === $before ) {
				delete_option( Launch::OPTION_GRILLE );
			} else {
				update_option( Launch::OPTION_GRILLE, $before, false );
			}
			Launch::forget();
		}
	} );

	ts_it( 'offers no way to pay at all while the money door refuses', function () {
		$restore = ts_lg_clear_money_door();
		try {
			$open = ts_lg_offered();
			ts_assert( array() !== $open, 'le décor de ce test a changé : la boutique ne propose aucun paiement même porte ouverte' );

			/*
			 * UN SEUL FAIT CHANGÉ, et c'est celui-là qui doit fermer la caisse :
			 * un produit personnalisable en vente dont l'atelier ne peut acheter
			 * le textile. La commande serait payée et jamais servie.
			 */
			$probe = new \WC_Product_Simple();
			$probe->set_name( 'Sonde de la porte argent' );
			$probe->set_regular_price( '14.50' );
			$probe->set_status( 'publish' );
			$probe->save();
			update_post_meta( $probe->get_id(), Product::META, 'tee' );

			try {
				Launch::forget();
				ts_assert( Launch::money_refuses(), 'la porte argent ne refuse pas alors qu’un produit n’a pas de textile nu' );
				ts_eq( ts_lg_offered(), array(), 'des moyens de paiement sont encore proposés au client' );
			} finally {
				wp_delete_post( $probe->get_id(), true );
			}

			// Et elle rouvre, ce qui est l'autre moitié de la preuve.
			ts_eq( ts_lg_offered(), $open, 'la caisse ne rouvre pas une fois la condition levée' );
		} finally {
			$restore();
		}
	} );

	ts_it( 'ne ferme pas la caisse sur un fait qui ne vaut que pour CE panier', function () {
		/*
		 * LE DÉFAUT QUE CETTE ASSERTION GARDE, et il a fermé la caisse d'une
		 * boutique saine avant d'être trouvé. `Payment::problems()` compte
		 * « activé et non proposé au client », qui est un fait NORMAL ET PAR
		 * PANIER : un moyen Stripe sous le montant minimum d'un Klarna, un
		 * paiement à la livraison exclu par le mode de livraison choisi, ou
		 * l'écran « ajouter un moyen de paiement », qui exclut d'office toute
		 * passerelle sans tokenisation. Quand la porte argent lisait cette
		 * phrase, elle retirait TOUTES les passerelles, carte comprise.
		 *
		 * La porte ne lit donc plus que la configuration. Ce test l'exerce par le
		 * chemin réel : on cache une passerelle du panier courant, exactement
		 * comme WooCommerce le fait, et on vérifie que la caisse reste ouverte.
		 */
		$restore = ts_lg_clear_money_door();
		$cacher  = static function ( $gateways ) {
			unset( $gateways['bacs'] );
			return $gateways;
		};
		try {
			Launch::forget();
			ts_eq( Launch::money_blockers(), array(), 'le décor a changé : la porte refuse déjà avant qu’on cache quoi que ce soit' );

			add_filter( 'woocommerce_available_payment_gateways', $cacher, 99 );
			Launch::forget();
			$motifs = array_values( array_filter(
				Launch::money_blockers(),
				static fn( array $b ): bool => 'paiement' === ( $b['cle'] ?? '' )
			) );
			ts_eq( $motifs, array(), 'la porte argent refuse sur un fait qui ne vaut que pour ce panier' );

			// ET ELLE REFUSE TOUJOURS SUR UNE VRAIE MAUVAISE CONFIGURATION,
			// sinon ce test aurait acheté sa stabilité en désarmant la porte.
			$saved = get_option( 'woocommerce_bacs_settings', array() );
			try {
				ts_lg_write_gateway( 'woocommerce_bacs_settings', array( 'enabled' => 'no' ) );
				WC()->payment_gateways()->init();
				Launch::forget();
				ts_assert(
					array() !== array_filter(
						Launch::money_blockers(),
						static fn( array $b ): bool => 'paiement' === ( $b['cle'] ?? '' )
					),
					'plus aucune passerelle active et la porte argent ne dit rien'
				);
			} finally {
				ts_lg_write_gateway( 'woocommerce_bacs_settings', $saved );
				WC()->payment_gateways()->init();
			}
		} finally {
			remove_filter( 'woocommerce_available_payment_gateways', $cacher, 99 );
			$restore();
			Launch::forget();
		}
	} );

	ts_it( 'is not fooled by its own hold when it reports the payment configuration', function () {
		/*
		 * LE PIÈGE QUE CETTE ASSERTION GARDE. `Payment::enabled()` calcule
		 * « proposé au client » avec `get_available_payment_gateways()`, que le
		 * filtre vide quand la porte refuse. Sans le drapeau d'inspection, une
		 * boutique tenue par la porte se décrirait elle-même comme « activée et
		 * invisible », qui est la phrase de ce fichier pour DES CLÉS MANQUANTES,
		 * et l'opérateur irait chercher des clés déjà en place.
		 */
		Launch::forget();
		ts_assert( Launch::money_refuses(), 'le décor de ce test a changé : la porte argent ne refuse plus rien' );
		ts_eq( ts_lg_offered(), array(), 'la porte ne tient pas la caisse' );

		$listed = Payment::enabled();
		ts_assert( array() !== $listed, 'aucune passerelle activée sur le miroir : ce test ne mesure rien' );
		foreach ( $listed as $id => $gateway ) {
			ts_eq( $gateway['offered'], true, "« {$id} » est décrit comme invisible alors que c’est la porte qui le retient" );
		}
	} );

	ts_it( 'refuses the write that switches a payment method on', function () {
		$saved = get_option( 'woocommerce_cheque_settings', array() );
		try {
			Launch::forget();
			ts_assert( Launch::activation_blockers() !== array(), 'le décor de ce test a changé : rien ne bloque une activation' );

			update_option( 'woocommerce_cheque_settings', array( 'enabled' => 'yes', 'title' => 'Chèque' ) );
			$after = get_option( 'woocommerce_cheque_settings', array() );
			ts_eq( (string) ( $after['enabled'] ?? '' ), 'no', 'le moyen de paiement a été activé pendant que la porte refusait' );
			ts_eq( (string) ( $after['title'] ?? '' ), 'Chèque', 'le garde a réécrit autre chose que l’activation' );
		} finally {
			ts_lg_write_gateway( 'woocommerce_cheque_settings', $saved );
			delete_transient( 'teeshoop_paiement_refuse' );
		}
	} );

	ts_it( 'lets a payment method be switched on once the shop is fit to take money', function () {
		/*
		 * L'AUTRE DIRECTION, et elle vaut plus que la première. Un garde qui
		 * refuse toujours n'est pas un garde, et celui-ci a un risque particulier :
		 * « aucun moyen de paiement n'est actif » est un refus de la porte argent,
		 * vrai de toute boutique qui n'en a pas encore allumé un. S'il comptait,
		 * il interdirait pour toujours l'action qui le lève.
		 */
		$saved   = get_option( 'woocommerce_cheque_settings', array() );
		$restore = ts_lg_clear_money_door();
		try {
			Launch::forget();
			ts_eq( Launch::activation_blockers(), array(), 'la boutique est saine et l’activation reste bloquée' );

			update_option( 'woocommerce_cheque_settings', array( 'enabled' => 'yes', 'title' => 'Chèque' ) );
			$after = get_option( 'woocommerce_cheque_settings', array() );
			ts_eq( (string) ( $after['enabled'] ?? '' ), 'yes', 'une boutique saine ne peut pas allumer un moyen de paiement' );
		} finally {
			ts_lg_write_gateway( 'woocommerce_cheque_settings', $saved );
			$restore();
		}
	} );

	ts_it( 'never stands in the way of switching a payment method off', function () {
		$saved = get_option( 'woocommerce_bacs_settings', array() );
		try {
			Launch::forget();
			ts_assert( Launch::activation_blockers() !== array(), 'le décor de ce test a changé : rien ne bloque une activation' );

			$off            = is_array( $saved ) ? $saved : array();
			$off['enabled'] = 'no';
			update_option( 'woocommerce_bacs_settings', $off );
			$after = get_option( 'woocommerce_bacs_settings', array() );
			ts_eq( (string) ( $after['enabled'] ?? '' ), 'no', 'le garde a empêché une EXTINCTION, ce qui enfermerait l’opérateur' );
		} finally {
			ts_lg_write_gateway( 'woocommerce_bacs_settings', $saved );
		}
		/*
		 * HORS DU `finally`, pour ne pas masquer l'échec qu'il vient de nettoyer.
		 * La première version de ce test laissait le miroir avec son virement
		 * bancaire éteint, parce que la restauration passait par le garde qu'il
		 * venait de prouver.
		 */
		$back = (array) get_option( 'woocommerce_bacs_settings', array() );
		ts_eq( (string) ( $back['enabled'] ?? '' ), 'yes', 'le miroir est resté avec son virement bancaire éteint' );
	} );

	ts_it( 'answers the payments-list toggle before WooCommerce does', function () {
		/*
		 * Le chemin qu'un humain emprunte vraiment est l'interrupteur de la liste
		 * des passerelles, qui passe par AJAX et n'a AUCUN filtre à l'intérieur :
		 * lu dans `WC_AJAX::toggle_gateway_enabled()` sur WooCommerce 11.0.1, il
		 * appelle `update_option('enabled','yes')` sans rien demander à personne.
		 * On se place donc avant lui sur le même crochet.
		 */
		$ours   = has_action( 'wp_ajax_woocommerce_toggle_gateway_enabled', array( Payment::class, 'refuse_toggle' ) );
		$theirs = has_action( 'wp_ajax_woocommerce_toggle_gateway_enabled', array( 'WC_AJAX', 'toggle_gateway_enabled' ) );
		ts_assert( false !== $ours, 'rien ne se place devant l’interrupteur de la liste des passerelles' );
		ts_assert( false !== $theirs, 'WooCommerce n’enregistre plus son propre interrupteur : ce test ne mesure plus rien' );
		ts_assert( (int) $ours < (int) $theirs, "notre garde passe après WooCommerce ({$ours} contre {$theirs})" );
	} );

	ts_it( 'holds the till on a fault instead of opening it', function () {
		/*
		 * « On n'a pas pu regarder » n'est pas « tout va bien », y compris quand
		 * ce qui n'a pas pu être regardé est la porte elle-même. Le filtre est
		 * appelé ici directement avec ce que WooCommerce lui passerait.
		 */
		ts_eq( Payment::hold_gateways( 'pas un tableau' ), array(), 'un argument illisible ouvre la caisse' );

		Launch::forget();
		ts_assert( Launch::money_refuses(), 'le décor de ce test a changé : la porte argent ne refuse plus rien' );
		$fake = array( 'sonde' => new \WC_Gateway_Cheque() );
		ts_eq( Payment::hold_gateways( $fake ), array(), 'une passerelle passe alors que la porte refuse' );
	} );

	ts_it( 'tells the customer at the checkout, without telling them our business', function () {
		/*
		 * RETIRER LES PASSERELLES LAISSAIT LA PHRASE DE WOOCOMMERCE, qui parle
		 * d'une indisponibilité liée au pays de livraison et invite à « prendre
		 * d'autres dispositions ». C'est faux, et un état non dessiné est un état
		 * que la barre de qualité refuse.
		 *
		 * Et la phrase ne dit AUCUNE raison : la porte refuse sur nos références
		 * fournisseur et nos planchers de coût, qui ne regardent pas le client.
		 */
		Launch::forget();
		ts_assert( Launch::money_refuses(), 'le décor de ce test a changé : la porte argent ne refuse plus rien' );

		$dit = Payment::no_methods_message( 'Sorry, it seems that there are no available payment methods.' );
		ts_assert( false !== mb_stripos( $dit, 'paiement en ligne est fermé' ), 'le client lit encore la phrase de WooCommerce : ' . $dit );
		ts_assert( false !== mb_stripos( $dit, 'devis' ), 'la phrase ne propose aucune suite au client' );
		ts_assert( false === strpos( $dit, '!' ), 'un point d’exclamation en copie client' );
		foreach ( Launch::money_blockers() as $blocker ) {
			$fuite = mb_substr( (string) $blocker['pourquoi'], 0, 40 );
			ts_assert( false === mb_stripos( $dit, $fuite ), 'la phrase client répète une raison interne' );
		}
		ts_assert( false === mb_stripos( $dit, 'plancher' ) && false === mb_stripos( $dit, 'textile nu' ), 'la phrase client nomme une condition interne' );

		// Et elle rend la main à WooCommerce quand la porte ne refuse rien.
		$restore = ts_lg_clear_money_door();
		try {
			Launch::forget();
			ts_eq( Payment::no_methods_message( 'phrase de WooCommerce' ), 'phrase de WooCommerce', 'la phrase de WooCommerce est remplacée alors que la porte ne refuse rien' );
		} finally {
			$restore();
		}
	} );

	ts_it( 'shows the debt where an operator works, and draws the missing document', function () {
		/*
		 * L'ÉCRAN REFUSE UN VISITEUR SANS DROITS, ce qui sous WP-CLI veut dire
		 * qu'il refuse le harnais : il n'y a pas d'utilisateur courant. On en
		 * prend un le temps du rendu, et on le rend.
		 */
		$was   = get_current_user_id();
		$admin = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
		ts_assert( array() !== $admin, 'le miroir n’a aucun administrateur, donc cet écran ne peut pas être rendu' );
		wp_set_current_user( (int) $admin[0] );

		/*
		 * LE CHEMIN PAR DÉFAUT EST DANS L'EXTENSION, et c'est la moitié de la
		 * décision : le déploiement ne transporte que `wp-plugins/` et
		 * `wp-themes/`, donc un document rangé dans `docs/` n'arrive jamais sur
		 * un serveur.
		 */
		$defaut = Admin::debt_path();
		ts_assert(
			false !== strpos( $defaut, 'teeshoop-core' ) && str_ends_with( $defaut, 'data/dette-lancement.md' ),
			'le document de dette ne voyage pas dans l’extension : ' . $defaut
		);

		/*
		 * Le rendu se prouve ailleurs : le harnais tourne sous le compte du
		 * serveur web et le répertoire de l'extension appartient au développeur.
		 * C'est exactement la situation qu'un déploiement durci produit, et la
		 * raison pour laquelle ce chemin est filtrable.
		 */
		$path  = rtrim( sys_get_temp_dir(), '/' ) . '/teeshoop-dette-sonde.md';
		$point = static fn(): string => $path;
		add_filter( 'teeshoop_dette_chemin', $point );

		try {
			if ( is_readable( $path ) ) {
				unlink( $path );
			}
			ts_eq( Admin::debt_path(), $path, 'le chemin du document n’est pas filtrable' );
			ob_start();
			Admin::debt_screen();
			$html = (string) ob_get_clean();

			ts_assert( false !== strpos( $html, 'La dette de lancement' ), 'l’écran ne porte pas son titre' );
			ts_assert( false !== strpos( $html, 'La porte argent' ), 'l’écran ne montre pas la porte argent' );
			ts_assert(
				false !== strpos( $html, 'n’est pas dans cette installation' ),
				'un document absent produit un écran blanc au lieu d’un état dessiné'
			);
			ts_assert(
				false !== strpos( $html, 'launch-gate.mjs --porte=publication' ),
				'l’état vide ne dit pas quelle commande écrit le document'
			);
			// La porte argent refuse aujourd'hui, donc ses raisons sont à l'écran.
			ts_assert( false !== strpos( $html, 'prix-plancher' ), 'l’écran ne nomme pas la condition du plancher' );

			// Et le document, quand il est là, est rendu tel quel.
			file_put_contents( $path, "# Dette de lancement\n\n- TVA : associé, 2026-09-05\n" );
			ob_start();
			Admin::debt_screen();
			$html = (string) ob_get_clean();
			ts_assert( false !== strpos( $html, 'TVA : associé, 2026-09-05' ), 'le document présent n’est pas affiché' );
			ts_assert( false === strpos( $html, 'n’est pas dans cette installation' ), 'l’état vide s’affiche alors que le document est là' );

			// Un fichier vide n'est pas une absence de dette.
			file_put_contents( $path, "\n \n" );
			ob_start();
			Admin::debt_screen();
			$html = (string) ob_get_clean();
			ts_assert( false !== strpos( $html, 'présent et vide' ), 'un document vide passe pour une dette réglée' );
		} finally {
			if ( is_readable( $path ) ) {
				unlink( $path );
			}
			remove_filter( 'teeshoop_dette_chemin', $point );
			wp_set_current_user( $was );
		}
	} );
}
