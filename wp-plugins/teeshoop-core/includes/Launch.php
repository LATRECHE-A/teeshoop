<?php
/**
 * What still forbids this shop from going live, asked of the shop itself.
 *
 * Sessions 04 to 13 were built on the default hypotheses of
 * `QUESTIONS-ASSOCIE.md`, because the associate was not available and stopping
 * cost more than proceeding on a labelled assumption. The third of the three
 * rules that made that decision reversible was written on 18 August 2026 and was
 * never built:
 *
 *   « La mise en ligne est bloquée automatiquement tant qu'une réponse bloquante
 *     manque sur un nombre qu'un client, un fournisseur ou une imprimante finit
 *     par voir. Ce n'est pas une note dans un document, c'est un contrôle qui
 *     refuse de laisser passer. »
 *
 * This is that check, the half of it that needs a database. The other half reads
 * `docs/hypotheses.json`, which WordPress cannot see, and lives in
 * `scripts/launch-gate.mjs`. Two halves, two languages, each reading its own
 * authority rather than a copy of the other's.
 *
 * ── IT REFUSES, IT NEVER AUTHORISES ─────────────────────────────────────────
 *
 * Every method here returns REASONS TO REFUSE. An empty list means this file
 * found nothing, not that the shop may open: three of the five conditions live
 * in the script and one of them is the register. A caller that read an empty
 * array as permission would be reading one of five checks.
 *
 * And it fails closed on itself. A condition that cannot be evaluated, because a
 * class is missing or an option is unreadable, is a REFUSAL with that reason,
 * never a silent pass. « We could not look » and « there is nothing wrong » are
 * different results, which is the rule the whole cost engine is built on.
 *
 * ── TWO DOORS SINCE 5 SEPTEMBER 2026 ────────────────────────────────────────
 *
 * The developer's instruction of that night is that the shop goes online with
 * its debt written down rather than waiting for thirteen register rows only the
 * associate can settle. So the refusals are now LABELLED with which door they
 * belong to, in one list rather than in two tables that would drift:
 *
 *   PORTE_ARGENT       what costs money the day it is wrong: a published column
 *                      selling under its floor, a personalisable product with no
 *                      blank to buy, a payment rail that is not what it claims.
 *                      No derogation, and it is ENFORCED INSIDE WORDPRESS by
 *                      `Payment`, not only printed by a deploy script.
 *   PORTE_PUBLICATION  the legal identity, the VAT regime, the conditions of
 *                      sale. Real debt, dated and owned in DETTE-LANCEMENT.md,
 *                      and it no longer stops the site from being served.
 *
 * WHY THE MONEY DOOR IS ENFORCED HERE AND NOT ONLY IN THE PIPELINE. Until this
 * date the gate blocked a FILE COPY, which is not where money passes: an
 * operator could switch Stripe on in wp-admin while the gate refused on sixteen
 * counts, and nothing noticed, because nothing in WordPress had ever been told
 * about the gate. `Payment::hold_gateways()` and `Payment::refuse_enabling()`
 * are the two places that now read it.
 *
 * WHAT IT COSTS TO ASK, because the enforcement runs on a cart page. Measured on
 * the mirror on 05/09/2026 with 2 320 published products, same rule and same
 * refusals throughout:
 *
 *   5 594 ms, 208 Mo   every published product hydrated (the version of 02/09)
 *     156 ms           the predicate pushed into the query, 17 rows hydrated
 *      86 ms           the two meta reads done before hydrating, cold caches
 *       2,5 ms         the same call with WooCommerce's caches warm
 *
 * and once per request whatever happens, because `money_hold()` memoises. The
 * last two lines are the ones a customer actually meets.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Launch {

	/** Refusals that cost money the day they are wrong. No derogation. */
	public const PORTE_ARGENT = 'argent';

	/** Refusals that are debt: written down, owned, dated, and not a stop. */
	public const PORTE_PUBLICATION = 'publication';

	/**
	 * Where the floor measurement of the published grid is recorded.
	 *
	 * The measurement itself is `tests/integration-grille.php`, which creates a
	 * real order per published column and runs the real cost engine on it. That
	 * takes minutes and cannot be an answer this class computes on demand, so
	 * the harness records its verdict and this class reads it. One measurement,
	 * one reader: re-deriving a floor here would be the second implementation of
	 * a rule the project already owns, and the two would disagree the first week
	 * a supplier moved a price.
	 *
	 * @var string
	 */
	public const OPTION_GRILLE = 'teeshoop_plancher_grille';

	/**
	 * How long a floor measurement is worth trusting, in days.
	 *
	 * The revenue side of the floor is caught immediately: the recorded verdict
	 * carries a signature of the published tariff, and a tariff edit voids it on
	 * the spot. The COST side moves without us: a supplier grid, a film rate, a
	 * Colissimo bracket. Nothing in WordPress can see those change, so the only
	 * honest instrument left is an age. Thirty days is one supplier month, which
	 * is the slowest of the three, and it is short enough that a shop cannot
	 * spend a quarter selling under a cost nobody re-measured.
	 *
	 * @var int
	 */
	public const GRILLE_JOURS = 30;

	/**
	 * The money door's answer for THIS request, computed at most once.
	 *
	 * @var array<int,array{cle:string,pourquoi:string,porte:string}>|null
	 */
	private static ?array $hold = null;

	/** True while the money door is being computed. See money_hold(). */
	private static bool $computing = false;

	/**
	 * Everything this side of the gate refuses on, in the order it is checked.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	public static function blockers(): array {
		return array_merge(
			self::identity_blockers(),
			self::vat_blockers(),
			self::terms_blockers(),
			self::money_blockers()
		);
	}

	/**
	 * The money door, freshly measured.
	 *
	 * Fresh on purpose, and the memoised twin below is the one the enforcement
	 * uses. A screen that shows the operator what blocks, and a CLI run that a
	 * deploy reads, must both see the shop as it is at that instant, including
	 * the change the operator made ten seconds ago.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	public static function money_blockers(): array {
		return array_values(
			array_merge(
				self::blank_blockers(),
				self::supply_blockers(),
				self::grid_blockers(),
				self::payment_blockers()
			)
		);
	}

	/**
	 * The same answer, computed at most once per request, for the enforcement.
	 *
	 * `Payment::hold_gateways()` runs inside `get_available_payment_gateways()`,
	 * which WooCommerce calls several times on a cart page and again on every
	 * fragment refresh. Measuring the shop once per request rather than once per
	 * call is the difference between 65 ms and half a second on a checkout.
	 *
	 * RE-ENTRY ANSWERS « REFUSE ». The payment leg asks WooCommerce which
	 * gateways it would offer, which re-enters the filter that called us.
	 * `Payment` breaks that cycle at its own end and this is the second lock:
	 * if a path we have not foreseen lands back here mid-computation, the answer
	 * is a refusal carrying that as its reason, never an empty list that a caller
	 * would read as permission.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	public static function money_hold(): array {
		if ( null !== self::$hold ) {
			return self::$hold;
		}
		if ( self::$computing ) {
			return array(
				self::refuse(
					'porte',
					__( 'La porte argent a été interrogée pendant qu’elle se calculait elle-même. Elle refuse plutôt que de répondre sur un état qu’elle n’a pas fini de lire.', 'teeshoop' )
				),
			);
		}

		self::$computing = true;
		try {
			self::$hold = self::money_blockers();
		} catch ( \Throwable $e ) {
			// A fault in a condition is a refusal with the fault as its reason.
			// Letting it escape would take a checkout page down; swallowing it
			// would open the till.
			self::$hold = array(
				self::refuse(
					'porte',
					sprintf(
						/* translators: %s: a technical error message, in English, from PHP. */
						__( 'La porte argent n’a pas pu être évaluée : %s. Elle refuse, parce que « on n’a pas pu regarder » n’est pas « tout va bien ».', 'teeshoop' ),
						$e->getMessage()
					)
				),
			);
		} finally {
			self::$computing = false;
		}
		return self::$hold;
	}

	/** Whether the money door refuses right now. */
	public static function money_refuses(): bool {
		return array() !== self::money_hold();
	}

	/**
	 * Forget the memoised answer, for a process that changes the shop under it.
	 *
	 * WP-CLI, the importer and the integration suite all live for minutes and
	 * edit the very facts this class reads. A web request does not need this.
	 */
	public static function forget(): void {
		self::$hold = null;
	}

	/**
	 * What must be clear before a payment method may be SWITCHED ON.
	 *
	 * THE RAIL'S OWN CONDITIONS ARE DELIBERATELY LEFT OUT, and this is not a
	 * softening: it is the difference between a gate and a deadlock. « Aucun
	 * moyen de paiement n'est actif » is a refusal of the money door, and it is
	 * true of every shop that has not turned one on yet. A guard that read it
	 * would forbid the exact action that clears it, for ever, and the only way
	 * out would be editing the database by hand.
	 *
	 * So the activation guard asks the other question: is the SHOP fit to take
	 * money. A product that cannot be sourced and a column selling under its
	 * floor are true whether or not a gateway exists, and they are what must not
	 * be live the moment a card starts working. The rail's own state is caught
	 * by `Payment::problems()`, said on screen by `Payment::notice()`, and it
	 * still refuses the door for the deploy pipeline.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	public static function activation_blockers(): array {
		return array_values(
			array_filter(
				self::money_blockers(),
				static fn( array $b ): bool => 'paiement' !== ( $b['cle'] ?? '' )
			)
		);
	}

	/**
	 * The legal identity, which question 17's own written default already made a
	 * launch condition: « le site n'est pas mis en ligne tant que la page
	 * mentions légales est incomplète ». It had never been executable.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	private static function identity_blockers(): array {
		if ( ! class_exists( __NAMESPACE__ . '\\Legal' ) || ! class_exists( __NAMESPACE__ . '\\Vat' ) ) {
			return array( self::refuse( 'identite', 'Le module des mentions légales n’a pas pu être chargé, donc l’identité n’a pas pu être vérifiée du tout.' ) );
		}

		$out    = array();
		$regime = (string) ( Settings::vat()['regime'] ?? '' );
		$fields = Legal::fields();
		foreach ( Legal::missing( Legal::identity(), $regime ) as $key ) {
			$out[] = self::refuse(
				'identite',
				sprintf(
					/* translators: %s: the French label of a legal-identity field. */
					__( 'Mention légale obligatoire absente ou invalide : %s. Aucun document ne peut être émis au nom du vendeur sans elle, la page des mentions légales publie la liste de ce qui manque, et le service comptable ne pourra pas établir la facture correspondante (article 242 nonies A de l’annexe II au code général des impôts).', 'teeshoop' ),
					(string) ( $fields[ $key ] ?? $key )
				)
			);
		}

		/*
		 * THE SITE'S OWN IDENTITY IS NOT THE INVOICE'S. Article 6 III of the LCEN
		 * asks for a publication director, a contact address and the host, none
		 * of which appears on a facture; `Legal::missing()` checks the invoice
		 * list and would pass a site that names nobody. Question 56 gives the
		 * three, and this is what makes them a condition rather than a wish.
		 */
		if ( class_exists( __NAMESPACE__ . '\\Host' ) ) {
			// `Host::missing()` already answers in French labels, not in keys, and
			// it disambiguates the two fields that share one.
			foreach ( Host::missing() as $label ) {
				$out[] = self::refuse(
					'editeur',
					sprintf(
						/* translators: %s: the French label of a site-identity field. */
						__( 'Mention obligatoire du site absente : %s (article 6 III de la LCEN).', 'teeshoop' ),
						(string) $label
					)
				);
			}
		} else {
			$out[] = self::refuse( 'editeur', 'Le module de l’identité du site n’a pas pu être chargé.' );
		}

		return $out;
	}

	/**
	 * The VAT regime, which the shop has been assuming since 18 August 2026.
	 *
	 * TWO DIFFERENT FACTS, and both are required. `Vat::problems()` says whether
	 * the TIMELINE is usable, which is a property of what somebody typed in the
	 * admin. It cannot say whether the regime is TRUE, and the answer of
	 * 1 September 2026 is explicitly not a confirmation: « conserver l'hypothèse
	 * de TVA à 20 % ... sous réserve de validation comptable » is the wording of
	 * a maintained assumption. That second fact is recorded in the register and
	 * checked by `scripts/launch-gate.mjs`, which is where the register lives.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	private static function vat_blockers(): array {
		if ( ! class_exists( __NAMESPACE__ . '\\Vat' ) ) {
			return array( self::refuse( 'tva', 'Le module de TVA n’a pas pu être chargé, donc le régime n’a pas pu être vérifié.' ) );
		}
		$out = array();
		foreach ( Vat::problems( Settings::vat_periods(), Settings::today() ) as $problem ) {
			$out[] = self::refuse( 'tva', $problem );
		}
		return $out;
	}

	/**
	 * The conditions of sale in force, and whether anybody whose job it is has
	 * read them.
	 *
	 * The four legal texts were written from the code by the people who wrote the
	 * code and each carries « Projet, non validé par un juriste » in its own
	 * heading. Question 58's answer is « Avocat ou cabinet juridique à désigner
	 * avant le lancement officiel », which is an intention. This turns the banner
	 * into a refusal: a version whose `etat` is not `valide`, or which names no
	 * reviewer and no date, cannot be the contract of a shop that sells.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	private static function terms_blockers(): array {
		if ( ! class_exists( __NAMESPACE__ . '\\Terms' ) ) {
			return array( self::refuse( 'cgv', 'Le module des conditions générales n’a pas pu être chargé.' ) );
		}

		$version = Terms::current();
		if ( '' === $version ) {
			return array( self::refuse( 'cgv', 'Aucune version des conditions générales de vente n’est en vigueur aujourd’hui.' ) );
		}
		$doc = Terms::document( $version );
		if ( null === $doc ) {
			return array( self::refuse( 'cgv', sprintf( 'La version %s des conditions générales est déclarée en vigueur et ne se charge pas.', $version ) ) );
		}

		$out = array();
		if ( 'valide' !== (string) ( $doc['etat'] ?? '' ) ) {
			$out[] = self::refuse(
				'cgv',
				sprintf(
					/* translators: %s: the date naming the version of the terms in force. */
					__( 'Les conditions générales en vigueur (version %s) sont un projet rédigé en interne que personne dont c’est le métier n’a relu. Question 58.', 'teeshoop' ),
					$version
				)
			);
		}
		if ( '' === trim( (string) ( $doc['relu_par'] ?? '' ) ) || '' === trim( (string) ( $doc['relu_le'] ?? '' ) ) ) {
			$out[] = self::refuse(
				'cgv',
				sprintf(
					/* translators: %s: the date naming the version of the terms in force. */
					__( 'La version %s des conditions générales n’enregistre ni le nom du juriste qui l’a relue ni la date de sa relecture. Un état « validé » que personne ne signe ne vaut pas mieux qu’un projet.', 'teeshoop' ),
					$version
				)
			);
		}
		return $out;
	}

	/**
	 * A personalisable product on sale that declares no blank to buy.
	 *
	 * THE CHEAPEST CONDITION HERE AND THE ONE THAT COSTS MOST TO MISS. Session 08
	 * put the blank reference on the product (`Product::META_BLANK_REF` and its
	 * colour map) and the purchase basket refuses, BY NAME, every line it cannot
	 * resolve. A shop that sells a garment it can never buy blanks for is a shop
	 * that takes an order it cannot fill, and the customer has already paid.
	 *
	 * Today every personalisable product is in that state, because nobody has
	 * filled the field in.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	/**
	 * Le textile nu de chaque produit publié existe-t-il encore chez le
	 * fournisseur d'aujourd'hui.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * CE QUE CE CONTRÔLE EMPÊCHE : UNE BOUTIQUE OUVERTE QUI NE PEUT RIEN VENDRE.
	 *
	 * Depuis le 9 septembre 2026, `Cart::add` demande au fournisseur si les
	 * articles existent avant d'accepter une ligne. C'est la bonne règle, et
	 * elle a une conséquence que personne n'avait mesurée : les neuf produits
	 * personnalisables publiés en production nomment des références de l'ANCIEN
	 * fournisseur, et l'espace de noms du nouveau est disjoint. Vérifié sur le
	 * dépôt : aucune des neuf n'y est, et le service prix/stock répond
	 * `products_not_found` sur leurs articles.
	 *
	 * Donc, tel quel, un déploiement rend une boutique que l'on peut parcourir,
	 * où l'éditeur fonctionne, et où le bouton « Ajouter au panier » refuse
	 * chaque commande sans que rien sur le site n'en dise la raison.
	 *
	 * LA VRAIE RÉPARATION EST UN IMPORT COMPLET, qui dure des heures et ne peut
	 * donc pas garder un déploiement. Ce contrôle-ci est ce qui empêche de
	 * partir dans cet état : il nomme les produits fautifs, et `deploiement.sh`
	 * refuse déjà sur la porte de lancement, sans dérogation.
	 *
	 * UNE REQUÊTE, PAS UNE BOUCLE. Le même argument que `blank_blockers()` juste
	 * en dessous : hydrater deux mille produits pour répondre à une question
	 * d'existence coûtait 5,6 s et 208 Mo.
	 *
	 * @return array<int,array<string,string>>
	 */
	private static function supply_blockers(): array {
		global $wpdb;

		if ( ! class_exists( __NAMESPACE__ . '\\Supply' ) ) {
			return array( self::refuse( 'textile-nu-fournisseur', 'Le module fournisseur n’a pas pu être chargé, donc les textiles nus n’ont pas pu être vérifiés.' ) );
		}

		$depot = Supply::table();
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$total = $wpdb->get_var( 'SELECT COUNT(*) FROM `' . $depot . '`' );
		if ( null === $total ) {
			return array( self::refuse( 'textile-nu-fournisseur', 'Le dépôt du catalogue fournisseur n’a pas pu être lu, donc rien n’a été vérifié.' ) );
		}
		if ( (int) $total === 0 ) {
			/*
			 * UN DÉPÔT VIDE NE PROUVE RIEN, et surtout il ne prouve pas que les
			 * références sont mauvaises. Même règle que « une boutique vide ne
			 * prouve rien » juste en dessous : on refuse plutôt que de conclure.
			 */
			return array( self::refuse( 'textile-nu-fournisseur', 'Le dépôt du catalogue fournisseur est vide. Lancez « wp teeshoop catalogue synchroniser » : sans lui, on ne peut pas dire si les textiles nus vendus existent encore.' ) );
		}

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$orphelins = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT p.ID AS id, p.post_title AS titre
				   FROM {$wpdb->posts} p
				   JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s AND m.meta_value <> ''
				  WHERE p.post_type = 'product' AND p.post_status = 'publish'
				    AND NOT EXISTS (
				        SELECT 1 FROM `" . $depot . "` d WHERE d.ref = m.meta_value AND d.gone = 0
				    )
				  ORDER BY p.ID ASC
				  LIMIT 20",
				Product::META_BLANK_REF
			)
		);

		if ( ! is_array( $orphelins ) || array() === $orphelins ) {
			return array();
		}

		$noms = array();
		foreach ( array_slice( $orphelins, 0, 5 ) as $o ) {
			$noms[] = '« ' . (string) $o->titre . ' » (#' . (int) $o->id . ')';
		}
		$suite = count( $orphelins ) > 5 ? sprintf( ' et %d autre(s)', count( $orphelins ) - 5 ) : '';

		return array(
			self::refuse(
				'textile-nu-fournisseur',
				sprintf(
					'%d produit(s) publié(s) sont vendus sur un textile nu que le fournisseur d’aujourd’hui ne connaît plus : %s%s. Le panier les refusera un par un, sans que le client comprenne pourquoi. Relancez un import complet avant d’ouvrir.',
					count( $orphelins ),
					implode( ', ', $noms ),
					$suite
				)
			),
		);
	}

	private static function blank_blockers(): array {
		if ( ! function_exists( 'wc_get_products' ) || ! class_exists( __NAMESPACE__ . '\\Product' ) ) {
			return array( self::refuse( 'textile-nu', 'WooCommerce ou le module produit n’a pas pu être chargé, donc les produits personnalisables n’ont pas pu être vérifiés.' ) );
		}

		/*
		 * A SHOP WITH NOTHING PUBLISHED PROVES NOTHING, and this is asked first
		 * and separately. `wp_count_posts` is one cached query and it answers a
		 * question the narrowed query below cannot: whether there is a catalogue
		 * at all. Without it, an empty database would return an empty refusal
		 * list, which a caller reads as « rien à redire ».
		 */
		$published = function_exists( 'wp_count_posts' ) ? wp_count_posts( 'product' ) : null;
		$published = is_object( $published ) ? (int) ( $published->publish ?? 0 ) : -1;
		if ( $published < 0 ) {
			return array( self::refuse( 'textile-nu', 'Le nombre de produits publiés n’a pas pu être lu, donc rien n’a été vérifié.' ) );
		}
		if ( 0 === $published ) {
			return array( self::refuse( 'textile-nu', 'Aucun produit publié n’a été lu. Une boutique vide ne prouve rien : ce contrôle refuse plutôt que de conclure que tout va bien.' ) );
		}

		/*
		 * THE PREDICATE IS IN THE QUERY, AND THE CAP IS STILL A REFUSAL.
		 *
		 * This used to hydrate every published product, which was honest and
		 * unaffordable: measured on the mirror on 05/09/2026 against 2 320
		 * published products, 5 594 ms and 208 Mo for one answer. It ran from
		 * WP-CLI only, and since 05/09/2026 it also runs on a cart page, where
		 * that is not a cost anybody may pay.
		 *
		 * `meta_compare EXISTS` on `Product::META` is EXACTLY the first test the
		 * loop used to do: `garment_of()` reads that meta and returns '' when it
		 * is absent, so a product without it was skipped either way. Nothing is
		 * trusted that was not trusted before; the same rejection simply happens
		 * in the index instead of in PHP. 17 rows in 5 ms, and the survivors are
		 * still hydrated and still judged by `garment_of()`, which is what
		 * refuses a garment key the price config no longer carries.
		 *
		 * AND THE COUNT IS COMPARED. `paginate` makes WooCommerce report how many
		 * rows matched in total beside the ones it handed back, so a query that
		 * stops short for any reason (a memory cap, a filter another extension
		 * added, a future default this file does not control) is caught instead
		 * of being read as « nothing found ». That is the same confusion this
		 * whole file exists to refuse.
		 */
		$query = wc_get_products(
			array(
				'status'       => 'publish',
				'limit'        => -1,
				'return'       => 'ids',
				'paginate'     => true,
				'meta_key'     => Product::META,
				'meta_compare' => 'EXISTS',
			)
		);
		$ids = is_object( $query ) && isset( $query->products ) && is_array( $query->products )
			? $query->products
			: null;
		if ( null === $ids ) {
			return array( self::refuse( 'textile-nu', 'La liste des produits personnalisables n’a pas pu être lue.' ) );
		}
		/*
		 * UN SECOND COMPTAGE, PAR UN AUTRE CHEMIN, et il ne fait pas doublon avec
		 * celui d'en dessous.
		 *
		 * `paginate` compare ce que la requête a rendu à ce que la MÊME requête
		 * dit avoir trouvé : il attrape une lecture tronquée, pas un prédicat
		 * ignoré. Or le prédicat vient d'être déplacé dans la requête, et
		 * `wc_get_products()` traduit `meta_key`/`meta_compare` par une couche
		 * qui n'est pas la nôtre. Le jour où cette traduction change, une
		 * interprétation plus étroite rendrait MOINS de produits, les deux
		 * compteurs de WooCommerce seraient d'accord entre eux, et un produit
		 * personnalisable sans textile nu cesserait d'être refusé sans que rien
		 * ne bouge : la boutique encaisserait une commande qu'elle ne peut pas
		 * acheter. C'est exactement la classe de défaut que la passe adversariale
		 * cherche, une hypothèse qui tenait et cesse de tenir en silence.
		 *
		 * Un COUNT indexé sur la méta répond à la même question sans passer par
		 * la même couche. 2 320 produits publiés, 17 lignes, mesuré sous la
		 * milliseconde sur le miroir.
		 */
		global $wpdb;
		$counted = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT p.ID) FROM {$wpdb->posts} p"
				. " INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID"
				. " WHERE p.post_type = 'product' AND p.post_status = 'publish' AND m.meta_key = %s",
				Product::META
			)
		);
		if ( null === $counted ) {
			return array( self::refuse( 'textile-nu', 'Le nombre de produits personnalisables n’a pas pu être compté, donc rien ne dit que la liste lue est complète.' ) );
		}
		if ( count( $ids ) < (int) $counted ) {
			return array(
				self::refuse(
					'textile-nu',
					sprintf(
						/* translators: 1: products read, 2: products counted directly in the database. */
						__( 'La base compte %2$d produits personnalisables publiés et la requête n’en a rendu que %1$d. Deux lectures d’un même fait ne sont pas d’accord : ce contrôle refuse plutôt que de conclure.', 'teeshoop' ),
						count( $ids ),
						(int) $counted
					)
				),
			);
		}

		$total = is_object( $query ) && isset( $query->total ) ? (int) $query->total : count( $ids );
		if ( count( $ids ) < $total ) {
			return array(
				self::refuse(
					'textile-nu',
					sprintf(
						/* translators: 1: products actually read, 2: products the shop says are personalisable. */
						__( 'La boutique déclare %2$d produits personnalisables et la requête n’en a rendu que %1$d. Ce contrôle refuse plutôt que de conclure sur une liste qu’il n’a pas fini de lire.', 'teeshoop' ),
						count( $ids ),
						$total
					)
				),
			);
		}

		/*
		 * LES DEUX LECTURES DE MÉTA D'ABORD, LE PRODUIT ENSUITE, et l'ordre est
		 * une mesure et non un goût. Hydrater les 17 produits personnalisables
		 * coûtait 60 ms des 156 ms de la porte, sur un miroir dont le cache objet
		 * est chaud. Or `is_purchasable()` et le nom ne servent QU'À un produit
		 * fautif, c'est-à-dire au cas rare : une boutique en ordre n'hydrate plus
		 * rien du tout. Le prédicat est identique, seul l'ordre d'évaluation
		 * change, et il ne peut pas l'être puisque les trois conditions sont
		 * conjointes.
		 *
		 * `garment_of()` et `blank_ref_of()` lisent la méta par identifiant et
		 * n'ont jamais eu besoin de l'objet.
		 */
		$out = array();
		foreach ( $ids as $id ) {
			$id = (int) $id;
			/*
			 * PERSONALISABLE IS A PROPERTY OF THE PRODUCT, and `garment_of()` is
			 * where it is decided: it returns the studio garment key, or '' for
			 * anything the studio cannot dress. Testing the meta directly here
			 * would be a second reading of the same fact, and it would accept a
			 * garment key that was removed from the price config.
			 */
			if ( '' === Product::garment_of( $id ) ) {
				continue;
			}
			if ( '' !== Product::blank_ref_of( $id ) ) {
				continue;
			}
			$product = wc_get_product( $id );
			if ( ! $product instanceof \WC_Product || ! $product->is_purchasable() ) {
				continue;
			}
			$out[] = self::refuse(
				'textile-nu',
				sprintf(
					/* translators: 1: product name, 2: product id. */
					__( '« %1$s » (#%2$d) est personnalisable et en vente, et ne déclare aucun textile nu : l’atelier ne saura pas quoi acheter et le panier d’achat refusera la ligne par son nom.', 'teeshoop' ),
					$product->get_name(),
					$id
				)
			);
		}
		return $out;
	}

	/**
	 * A published column selling under its floor, as last measured.
	 *
	 * WHY THIS READS A RECORD INSTEAD OF MEASURING. The floor of a column is
	 * `Costing`'s answer on a real order: the blank at its dearest size and
	 * colour, the film, the carriage, the per-order costs shared over the
	 * quantity. `tests/integration-grille.php` builds one order per published
	 * column and asks the real engine, which takes minutes and creates orders.
	 * That is a measurement, not a query, and re-deriving a cheaper version of
	 * it here would be a second implementation of the rule that decides whether
	 * this shop sells at a loss. So the harness records what it found and this
	 * reads it.
	 *
	 * FOUR WAYS TO REFUSE, and three of them are about the record rather than
	 * about the price:
	 *
	 *   absent       nobody has ever measured. That is not « all is well ».
	 *   stale        the last measurement is older than GRILLE_JOURS.
	 *   superseded   the published tariff changed after the measurement, so the
	 *                verdict describes prices the shop no longer charges.
	 *   under        the measurement itself found columns below their floor.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	private static function grid_blockers(): array {
		$raw = get_option( self::OPTION_GRILLE, null );
		if ( ! is_array( $raw ) || ! isset( $raw['at'], $raw['under'], $raw['columns'] ) ) {
			return array(
				self::refuse(
					'prix-plancher',
					__( 'Personne n’a mesuré la grille publiée contre son plancher de coût. Tant que cette mesure n’existe pas, la boutique ne peut pas dire qu’elle vend au-dessus de ce que la commande lui coûte. Lancez « npm run verify:grille ».', 'teeshoop' )
				),
			);
		}

		$at       = (string) $raw['at'];
		$under    = (int) $raw['under'];
		$blocked  = (int) ( $raw['blocked'] ?? 0 );
		$columns  = (int) $raw['columns'];
		$measured = strtotime( $at . ' UTC' );

		$out = array();
		if ( false === $measured ) {
			$out[] = self::refuse( 'prix-plancher', 'La date de la dernière mesure du plancher est illisible, donc son âge ne peut pas être établi.' );
		} elseif ( ( time() - $measured ) > self::GRILLE_JOURS * DAY_IN_SECONDS ) {
			$out[] = self::refuse(
				'prix-plancher',
				sprintf(
					/* translators: 1: a date, 2: a number of days. */
					__( 'La grille n’a pas été mesurée contre son plancher depuis le %1$s, soit plus de %2$d jours. Le prix d’achat du textile nu, le film et le port bougent sans nous : une mesure de cet âge ne dit plus rien. Lancez « npm run verify:grille ».', 'teeshoop' ),
					wp_date( 'j F Y', $measured ) ?: $at,
					self::GRILLE_JOURS
				)
			);
		}

		if ( (string) ( $raw['signature'] ?? '' ) !== self::grid_signature() ) {
			$out[] = self::refuse(
				'prix-plancher',
				__( 'Le tarif publié a changé depuis la dernière mesure du plancher, donc cette mesure porte sur des prix que la boutique ne pratique plus. Relancez « npm run verify:grille ».', 'teeshoop' )
			);
		}

		if ( $columns < 1 ) {
			$out[] = self::refuse( 'prix-plancher', 'La dernière mesure du plancher n’a lu aucune colonne. Un contrôle qui n’a rien regardé ne vaut pas un contrôle vert.' );
		}
		if ( $blocked > 0 ) {
			$out[] = self::refuse(
				'prix-plancher',
				sprintf(
					/* translators: %d: how many published columns could not be costed. */
					__( '%d colonne(s) publiée(s) n’ont pas pu être chiffrées à la dernière mesure. Ce n’est pas un plancher franchi, c’est un plancher inconnu, et les deux se refusent de la même façon.', 'teeshoop' ),
					$blocked
				)
			);
		}
		if ( $under > 0 ) {
			$out[] = self::refuse(
				'prix-plancher',
				sprintf(
					/* translators: 1: columns under their floor, 2: columns measured. */
					__( '%1$d colonne(s) publiée(s) sur %2$d se vendent sous leur plancher : la boutique perd de l’argent à chaque vente de ces lignes.', 'teeshoop' ),
					$under,
					$columns
				)
			);
		}
		return $out;
	}

	/**
	 * What the floor measurement found, recorded where WordPress can read it.
	 *
	 * Called by `tests/integration-grille.php` on every run, green or red, and
	 * BEFORE it exits: a run that refuses must leave a refusing record, or the
	 * next reader would be answered by the last green one.
	 *
	 * @param int $under   Published columns selling below their floor.
	 * @param int $blocked Published columns that could not be costed at all.
	 * @param int $columns Columns actually measured.
	 */
	public static function record_grid_verdict( int $under, int $blocked, int $columns ): void {
		update_option(
			self::OPTION_GRILLE,
			array(
				'at'        => gmdate( 'Y-m-d H:i:s' ),
				'under'     => max( 0, $under ),
				'blocked'   => max( 0, $blocked ),
				'columns'   => max( 0, $columns ),
				'signature' => self::grid_signature(),
			),
			false
		);
		self::forget();
	}

	/**
	 * A short fingerprint of the tariff the shop publishes.
	 *
	 * The point is not secrecy, it is that a floor measured against 34,00 EUR
	 * says nothing about a shop charging 29,00. An operator who edits the price
	 * config is exactly the person who must re-measure, and this is what makes
	 * the record say so by itself instead of relying on them remembering.
	 */
	public static function grid_signature(): string {
		$config = class_exists( __NAMESPACE__ . '\\Settings' ) ? Settings::pricing() : array();
		return substr( sha1( (string) wp_json_encode( $config ) ), 0, 12 );
	}

	/**
	 * The payment rail itself, in the money door's vocabulary.
	 *
	 * `Payment::problems()` is the authority and this only relabels it, so that
	 * one list carries every reason the shop must not take money and a reader
	 * does not have to know there are two classes involved.
	 *
	 * @return array<int,array{cle:string,pourquoi:string,porte:string}>
	 */
	private static function payment_blockers(): array {
		if ( ! class_exists( __NAMESPACE__ . '\\Payment' ) ) {
			return array( self::refuse( 'paiement', 'Le module de paiement n’a pas pu être chargé, donc l’encaissement n’a pas pu être vérifié.' ) );
		}
		// `gate_problems()` ET NON `problems()` : le second décrit la boutique à
		// un exploitant et y compte des faits qui dépendent du PANIER courant.
		// Les lire ici fermait la caisse sur une boutique saine, et figeait ce
		// refus pour toute la requête par la mémoïsation de money_hold(). La
		// porte ne lit plus que la configuration. Voir Payment::gate_problems().
		$out = array();
		foreach ( Payment::gate_problems() as $problem ) {
			$out[] = self::refuse( 'paiement', (string) $problem['texte'] );
		}
		return $out;
	}

	/**
	 * Which door each refusal belongs to.
	 *
	 * ONE TABLE, and every refusal is labelled from it rather than at its call
	 * site. Eighteen call sites each naming their own door is eighteen places to
	 * get it wrong, and the day one of them said `publication` about a price the
	 * money door would stop refusing without anybody editing the money door.
	 *
	 * AN UNKNOWN KEY IS MONEY. A refusal nobody classified is treated as if it
	 * cost money, which stops a launch, rather than as debt, which does not. The
	 * safe direction of that mistake is the strict one.
	 *
	 * @var array<string,string>
	 */
	private const PORTES = array(
		'textile-nu'    => self::PORTE_ARGENT,
		'prix-plancher' => self::PORTE_ARGENT,
		'paiement'      => self::PORTE_ARGENT,
		'porte'         => self::PORTE_ARGENT,
		'identite'      => self::PORTE_PUBLICATION,
		'editeur'       => self::PORTE_PUBLICATION,
		'tva'           => self::PORTE_PUBLICATION,
		'cgv'           => self::PORTE_PUBLICATION,
	);

	/**
	 * The conditions this version of the plugin actually evaluates.
	 *
	 * WHY THE GATE NEEDS IT, and why an empty refusal list cannot replace it.
	 * `wp teeshoop lancement --porcelaine` answers with a list of refusals, and
	 * an empty one means two opposite things: « I looked and found nothing » and
	 * « this build does not know how to look at that ». On the money door that
	 * confusion would authorise taking money, so `scripts/launch-gate.mjs` asks
	 * the shop to enumerate what it examined and refuses (exit 2) for anything
	 * missing from the list.
	 *
	 * WHAT MAKES A STATIC LIST HONEST. Every key below has a method, and every
	 * branch of every one of those methods that cannot look returns a REFUSAL
	 * carrying that same key rather than an empty array. So « the key is in this
	 * list » and « the shop has an answer about this condition » are the same
	 * statement. The day a condition gains a silent early return, this list
	 * becomes a lie, which is why that invariant is written here and not only
	 * in the individual docblocks.
	 *
	 * `porte` is not in the list: it is not a condition, it is how this class
	 * reports a fault in itself.
	 *
	 * @return string[]
	 */
	public static function evaluated(): array {
		return array_values( array_diff( array_keys( self::PORTES ), array( 'porte' ) ) );
	}

	/** @return array{cle:string,pourquoi:string,porte:string} */
	private static function refuse( string $key, string $why ): array {
		return array(
			'cle'      => $key,
			'pourquoi' => $why,
			'porte'    => self::PORTES[ $key ] ?? self::PORTE_ARGENT,
		);
	}
}
