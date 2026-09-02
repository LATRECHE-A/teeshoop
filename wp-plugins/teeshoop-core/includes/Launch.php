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
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Launch {

	/**
	 * Everything this side of the gate refuses on, in the order it is checked.
	 *
	 * @return array<int,array{cle:string,pourquoi:string}>
	 */
	public static function blockers(): array {
		return array_merge(
			self::identity_blockers(),
			self::vat_blockers(),
			self::terms_blockers(),
			self::blank_blockers()
		);
	}

	/**
	 * The legal identity, which question 17's own written default already made a
	 * launch condition: « le site n'est pas mis en ligne tant que la page
	 * mentions légales est incomplète ». It had never been executable.
	 *
	 * @return array<int,array{cle:string,pourquoi:string}>
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
	 * @return array<int,array{cle:string,pourquoi:string}>
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
	 * @return array<int,array{cle:string,pourquoi:string}>
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
	 * @return array<int,array{cle:string,pourquoi:string}>
	 */
	private static function blank_blockers(): array {
		if ( ! function_exists( 'wc_get_products' ) || ! class_exists( __NAMESPACE__ . '\\Product' ) ) {
			return array( self::refuse( 'textile-nu', 'WooCommerce ou le module produit n’a pas pu être chargé, donc les produits personnalisables n’ont pas pu être vérifiés.' ) );
		}

		/*
		 * EVERY PUBLISHED PRODUCT, AND THE CAP IS A REFUSAL.
		 *
		 * This asked for 200 and the shop publishes 462, so it read fewer than
		 * half of them and reported the condition as verified: a gate that says
		 * « nothing found » about a list it did not finish reading is a gate
		 * somebody trusts. Found by the adversarial pass over this session's own
		 * diff, and it is the same confusion between « nothing found » and
		 * « nothing looked » that the shop-side half of this file already refuses.
		 *
		 * -1 asks WooCommerce for all of them, which is a real query on a real
		 * catalogue; this runs when somebody asks whether the shop may open, not
		 * on a page load.
		 *
		 * AND THE COUNT IS COMPARED, which this comment claimed before anything
		 * did it. `paginate` makes WooCommerce report how many published products
		 * it found in total beside the ones it handed back, so a query that stops
		 * short for any reason (a memory cap, a filter another extension added, a
		 * future default this file does not control) is caught instead of being
		 * read as « nothing found ». That is the same confusion this whole file
		 * exists to refuse, and leaving it as a sentence in a comment was the
		 * second time this session it went unnoticed.
		 */
		$query = wc_get_products(
			array(
				'status'   => 'publish',
				'limit'    => -1,
				'return'   => 'objects',
				'paginate' => true,
			)
		);
		$products = is_object( $query ) && isset( $query->products ) && is_array( $query->products )
			? $query->products
			: null;
		if ( null === $products ) {
			return array( self::refuse( 'textile-nu', 'La liste des produits publiés n’a pas pu être lue.' ) );
		}
		$total = is_object( $query ) && isset( $query->total ) ? (int) $query->total : count( $products );
		if ( count( $products ) < $total ) {
			return array(
				self::refuse(
					'textile-nu',
					sprintf(
						/* translators: 1: products actually read, 2: products the shop says it publishes. */
						__( 'La boutique publie %2$d produits et la requête n’en a rendu que %1$d. Ce contrôle refuse plutôt que de conclure sur une liste qu’il n’a pas fini de lire.', 'teeshoop' ),
						count( $products ),
						$total
					)
				),
			);
		}
		if ( array() === $products ) {
			return array( self::refuse( 'textile-nu', 'Aucun produit publié n’a été lu. Une boutique vide ne prouve rien : ce contrôle refuse plutôt que de conclure que tout va bien.' ) );
		}

		$out = array();
		foreach ( $products as $product ) {
			if ( ! $product instanceof \WC_Product ) {
				continue;
			}
			/*
			 * PERSONALISABLE IS A PROPERTY OF THE PRODUCT, and `garment_of()` is
			 * where it is decided: it returns the studio garment key, or '' for
			 * anything the studio cannot dress. Testing the meta directly here
			 * would be a second reading of the same fact, and it would accept a
			 * garment key that was removed from the price config.
			 */
			if ( '' === Product::garment_of( $product->get_id() ) ) {
				continue;
			}
			if ( ! $product->is_purchasable() ) {
				continue;
			}
			if ( '' === Product::blank_ref_of( $product->get_id() ) ) {
				$out[] = self::refuse(
					'textile-nu',
					sprintf(
						/* translators: 1: product name, 2: product id. */
						__( '« %1$s » (#%2$d) est personnalisable et en vente, et ne déclare aucun textile nu : l’atelier ne saura pas quoi acheter et le panier d’achat refusera la ligne par son nom.', 'teeshoop' ),
						$product->get_name(),
						$product->get_id()
					)
				);
			}
		}
		return $out;
	}

	/** @return array{cle:string,pourquoi:string} */
	private static function refuse( string $key, string $why ): array {
		return array(
			'cle'      => $key,
			'pourquoi' => $why,
		);
	}
}
