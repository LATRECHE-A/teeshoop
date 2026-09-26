<?php
/**
 * The price authority.
 *
 * There is exactly ONE implementation of the selling price, it is this file,
 * and it runs on the server. The studio displays what this returns; it never
 * computes a price a customer can pay. Two implementations of the same rules
 * always diverge in the end (on a tier boundary, on a rounding mode, on the
 * VAT basis), and the day they do, the customer sees one number and the
 * invoice says another.
 *
 * The studio used to carry its own src/content/pricing.ts as a *preview*
 * for the editor's UI, in placeholder dollars, and the plan is explicit that it
 * must not be ported as-is. Anything payable comes from here.
 *
 * Pure by construction: no WordPress function is called anywhere in this file,
 * so it can be unit-tested with `php tests/run.php` and no bootstrap. The
 * WordPress-facing wiring (options, REST, cart) lives in the other classes.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Pricing {

	/**
	 * Shipped defaults, in cents HT.
	 *
	 * THE GARMENT TARIFFS ARE DERIVED, and the derivation is above `garments`.
	 *
	 * THIS PARAGRAPH SAID THE OPPOSITE UNTIL 4 SEPTEMBER 2026, and it was right
	 * until then: « THESE NUMBERS ARE PLACEHOLDERS ... the studio's demo figures
	 * converted 1:1 from dollars to euros ». It stayed twenty lines above the
	 * block that now says they are derived, and it is the paragraph a maintainer
	 * reads before deciding whether a number may be changed freely. It may not:
	 * `npm run verify:grille` measures it against the real cost engine.
	 *
	 * WHAT IS STILL ASSUMED IS THE RULE, not the arithmetic. Each value has a row
	 * in `docs/hypotheses.json` naming the question that settles it: the garment
	 * tariffs are question 06 (the margin rates) fed by question 03 (the real
	 * purchase grids), the surcharge and discount ladders are question 08, the
	 * VAT rate is question 17 and the self-serve thresholds are question 02.
	 * This paragraph used to say "question 04", which is the negotiated DTF rate
	 * per linear metre and settles none of them. The real values land in the
	 * `teeshoop_pricing` option, which is why every one of them is configurable
	 * and none is hard-coded at a call site.
	 */
	public static function default_config(): array {
		return array(
			'currency'   => 'EUR',

			// French standard rate. Printed textile is not a reduced-rate good.
			'vat_rate'   => 0.20,

			/*
			 * A garment is priced as: the blank + the marking of each printed
			 * side. The studio's model folded the first side's marking into the
			 * base, which made a BLANK garment cost exactly as much as a printed
			 * one, fine for a demo, wrong for a shop that also resells blanks.
			 *
			 * ── 4 SEPTEMBRE 2026 : CES CHIFFRES SONT DÉRIVÉS, PLUS RECOPIÉS ────
			 *
			 * Ils valaient 14,50 EUR le t-shirt et 32,00 EUR le sweat, et le
			 * registre disait d'où ils venaient : « la figure de démonstration du
			 * studio convertie du dollar à l'euro pour que la plomberie se teste
			 * de bout en bout » (H-Q06-TARIF-TEE). Mesuré par
			 * `tests/integration-grille.php` contre les neuf références de la
			 * gamme, à la surface que la grille promet (625 cm², la borne du
			 * palier standard) et au coloris le plus cher de chaque référence :
			 * **102 des 219 colonnes publiées se vendaient sous leur plancher**,
			 * de 1,71 EUR à 299,01 EUR. Le brief de la nuit 2 citait 1,81 EUR à
			 * cinquante pièces ; c'était mesuré sur 288 cm² et sur un prix
			 * d'achat générique, et la réalité était bien pire.
			 *
			 * LA RÈGLE, écrite pour qu'on puisse la refaire : le tarif est le
			 * plus petit auquel CHAQUE colonne publiée de `Pricing::grid()`
			 * atteint le plancher que `Costing` calcule pour elle, À LA TAILLE
			 * ET AU COLORIS LES PLUS CHERS que l'offre vend, arrondi à l'euro
			 * supérieur. L'arrondi ne fabrique rien : il ne fait que s'éloigner
			 * du plancher. Solution exacte : 33,69 EUR le t-shirt et 72,44 EUR
			 * le sweat ; publiée : 34,00 et 73,00, ce qui laisse au pire 5,08 EUR
			 * et 10,73 EUR de marge au-dessus du plancher.
			 *
			 * ── ET LE PLANCHER EST SA MARGE MINIMALE DEPUIS LE 5 SEPTEMBRE ────
			 *
			 * Le tarif du 4 septembre (23,00 et 49,00) dégageait de 26,1 % à
			 * 41,1 % de marge brute, médiane 32 %, parce que le plancher lisait
			 * notre contribution de 25 % après commission et pas les 50 % qu'il a
			 * répondus. Le plancher est maintenant le maximum des deux jambes
			 * (la configuration de coût, clé `min_margin_rate`), et le tarif suit.
			 *
			 * UNE SEULE FACE SUPPLÉMENTAIRE À 10,00 EUR SUR LES TROIS VÊTEMENTS,
			 * parce que c'est le même travail de marquage. Résolu séparément, le
			 * t-shirt demandait 10,00 et le sweat 8,60 : la plus haute des deux
			 * couvre les deux, et deux prix pour un même geste seraient deux
			 * choses à tenir d'accord. C'est aussi ce que mistertee publie pour
			 * la même opération, à cinquante centimes près.
			 *
			 * ── CE QUE `base_ht` PORTE VRAIMENT ──────────────────────────────
			 *
			 * Pas seulement le textile nu. Il porte tout ce que le prix du
			 * marquage ne porte pas : le port fournisseur, la livraison du film,
			 * l'emballage, la main-d'oeuvre, et surtout les COÛTS PAR COMMANDE
			 * que cinq pièces se partagent à cinq. C'est pourquoi 24,00 EUR de
			 * base sur un textile nu qui coûte 3 à 6 EUR n'est pas une erreur de
			 * frappe : à cinq pièces, 23,00 EUR de frais fixes par commande font
			 * 4,60 EUR la pièce, et à cent pièces 0,23.
			 *
			 * ── LA TAILLE LA PLUS CHÈRE, ET C'EST SA RÈGLE À LUI ───────────────
			 *
			 * La première dérivation mesurait à la taille de tarification, M. La
			 * passe adversariale a montré que le pas de taille (mesuré : 3,37 EUR
			 * en M contre 4,95 en 2XL sur la fiche fournisseur du dépôt, +47 % du
			 * plus gros poste) est plus grand que la marge que le tarif laissait,
			 * donc qu'une série entièrement en grande taille repassait sous son
			 * plancher pendant que le garde restait vert.
			 *
			 * La réponse 37 de l'associé le dit avant nous, et c'est une règle de
			 * développement dans son texte : « Ne jamais utiliser uniquement la
			 * surface du M pour calculer le coût réel d'une commande comportant
			 * plusieurs tailles. » Elle dit aussi que le prix client reste le
			 * MÊME à toutes les tailles (« Un S, un M et un 3XL peuvent être
			 * vendus au même prix »), et que si les grandes tailles font passer
			 * la commande sous le plancher, « un supplément peut être appliqué ou
			 * la commande doit nécessiter une validation interne ».
			 *
			 * Des deux, une boutique en autonomie ne peut pas faire la seconde :
			 * il n'y a personne entre le clic et le paiement. Donc le prix couvre
			 * la taille la plus chère, et un acheteur en S paie ce que coûte un
			 * 3XL. C'est un choix commercial, il est à lui, et le supplément de
			 * taille qu'il évoque est la façon de faire redescendre le prix des
			 * tailles courantes : question 64.
			 *
			 * POURQUOI LE PLANCHER ET PAS LE PRIX CONSEILLÉ. Les trois cibles
			 * dérivables ont été calculées : plancher (contribution 25 %),
			 * zone d'autonomie (conseillé moins 15 %) et prix conseillé (marge
			 * 50 %). Elles donnent 21,00, 25,43 et 30,61 EUR le t-shirt à cinq
			 * pièces. Les prix concurrents MESURÉS pour un t-shirt imprimé à
			 * l'unité (docs/CONCURRENTS.md) sont 15,97 EUR et 23,11 EUR chez
			 * mistertee, dont le moteur publié donne 19,26 EUR. Seule la
			 * première des trois tombe dans cette fourchette. Choisir une des
			 * deux autres serait un arbitrage de positionnement commercial, qui
			 * appartient à l'associé ; refuser de vendre sous le coût est un
			 * arbitrage d'ingénierie, qui est le nôtre.
			 *
			 * CE QUE ÇA LAISSE OUVERT, et c'est une question pour lui : au
			 * plancher la boutique garde 25 % du prix, pas les 50 % de marge
			 * brute minimale qu'il a nommés le 1er septembre. L'écart vaut
			 * 9,61 EUR par t-shirt à cinq pièces. Question 06 bis dans
			 * QUESTIONS-ASSOCIE.md.
			 *
			 * LE MARQUAGE A UN SEUL PRIX, parce que c'est le même travail sur les
			 * deux vêtements : 10,00 EUR la première face (mistertee publie
			 * 10,50 EUR pour le même geste, et le film seul coûte 6,15 EUR la
			 * face sur la plus petite série qu'on vend) et 7,00 EUR chaque face
			 * suivante, qui est ce que le garde exige et qui est le film plus la
			 * pose sans la mise en route. Le reste est la contribution du textile
			 * nu, et elle diffère parce que les vêtements diffèrent.
			 */
			'garments'   => array(
				'tee'    => array(
					'base_ht'       => 2400,
					'first_side_ht' => 1000,
					'extra_side_ht' => 1000,
				),
				'hoodie' => array(
					'base_ht'       => 6300,
					'first_side_ht' => 1000,
					'extra_side_ht' => 1000,
				),
				/*
				 * The customer ships their own garment: decoration only, and the
				 * blank costs us nothing.
				 *
				 * NOT DERIVED, and that is said out loud. There is no product in
				 * the launch range a customer can send their own garment to, so
				 * `tests/integration-grille.php` has nothing to build an order
				 * from and cannot measure this one. `first_side_ht` therefore
				 * stays the assumption it was (H-Q06-TARIF-VETEMENT-CLIENT).
				 * Only `extra_side_ht` moves, to the one price the marking has:
				 * a second face is the same film and the same pose whoever
				 * bought the garment.
				 */
				'custom' => array(
					'base_ht'       => 0,
					'first_side_ht' => 1200,
					'extra_side_ht' => 1000,
				),
			),

			/*
			 * Surcharge by printed area, per side. A4 ≈ 625 cm², A3 ≈ 1250 cm².
			 * The area that counts is the INK, not the layer rectangle. See the
			 * trim work in the DTF module. Passing the rectangle here is what
			 * makes a customer pay for transparent margins.
			 */
			'area_tiers' => array(
				array(
					'max_sq_cm' => 625,
					'add_ht'    => 0,
					'label'     => 'std',
				),
				array(
					'max_sq_cm' => 1250,
					'add_ht'    => 400,
					'label'     => 'large',
				),
				array(
					'max_sq_cm' => null, // no upper bound
					'add_ht'    => 900,
					'label'     => 'xl',
				),
			),

			/*
			 * Quantity breaks, highest reached wins. Applied to the whole unit
			 * price (blank + marking) because both actually get cheaper with
			 * volume: the supplier has its own tiers, and film nests better the
			 * more pieces share a sheet.
			 */
			'qty_breaks' => array(
				array(
					'min_qty' => 10,
					'rate'    => 0.15,
				),
				array(
					'min_qty' => 25,
					'rate'    => 0.25,
				),
				array(
					'min_qty' => 50,
					'rate'    => 0.35,
				),
			),

			/** Hard cap; a "quantity" past this is a data-entry accident or an attack. */
			'max_qty'    => 10000,

			/*
			 * Target margin rate for a BLANK resold undecorated, i.e. the 26 399
			 * catalogue articles the importer writes. NULL, and null means the
			 * importer writes no price at all.
			 *
			 * This is not a placeholder waiting to be filled in badly, it is a
			 * refusal. The Bible gives the formula (prix conseillé = coût /
			 * (1 − taux de marge cible), chapter 1) and then lists "fixer les
			 * premiers taux de marge" among the things still to decide. So the
			 * formula is derived and the rate is not ours to pick: at 40 % a
			 * 3,37 EUR t-shirt sells at 5,62 EUR and at 60 % it sells at
			 * 8,43 EUR, and nothing in this repository can tell you which is
			 * right. Question 42 of QUESTIONS-ASSOCIE.md asks.
			 *
			 * Until it is answered the catalogue is browsable and not
			 * purchasable, which is a true statement about a garment whose price
			 * nobody has set. Set this to a float in [0, 1) and the next import
			 * prices every variation from its own supplier cost.
			 *
			 * It is NOT the same number as `garments[*].base_ht`, which is what
			 * a blank contributes to a PERSONALISED line. Session 05 is where
			 * those two stop being separate; see the note in Catalogue.php.
			 *
			 * ONE THING TO SETTLE BEFORE IT IS SET, and it is not a rounding
			 * detail: the price this produces is HT, and the shop is configured
			 * to display prices excluding tax (`woocommerce_tax_display_shop`,
			 * which is right for the business buyers the personalised pages are
			 * written for). An imported blank has no Teeshoop template around
			 * it, so it would render bare HT and a consumer would meet 20 % more
			 * at checkout. In France a consumer price must be shown TTC. So
			 * question 41 comes first: if these blanks are sold to consumers,
			 * the catalogue needs a TTC display before this rate is set.
			 */
			'blank_margin_rate' => null,

			/*
			 * Where self-serve stops and a devis begins.
			 *
			 * LES DEUX NOMBRES N'ONT PAS LE MÊME AUTEUR, et c'est la seule chose
			 * à retenir ici.
			 *
			 * 2 000 EUR HT EST LA RÈGLE DE L'ASSOCIÉ. Réponse à la question 02,
			 * reçue le 1er septembre 2026 et vendue dans
			 * docs/reponses-associe/ : « Jusqu'à 2 000 EUR HT de commande, le
			 * parcours peut être réalisé en autonomie. Au-delà de 2 000 EUR HT,
			 * passage par un devis et validation par Teeshoop. » Ce commentaire a
			 * dit le contraire jusqu'au 5 septembre 2026, parce qu'il avait été
			 * écrit avant les réponses et jamais relu après.
			 *
			 * IL DIT « DE COMMANDE », donc la portée est le panier. La règle est
			 * appliquée aux DEUX niveaux : ici sur la ligne, parce qu'une ligne
			 * seule qui franchit le seuil ne doit pas afficher de prix payable,
			 * et sur le panier entier dans `Checkout`, parce que deux lignes
			 * chacune sous le seuil font une commande qui le dépasse. Retirer le
			 * second contrôle rendrait la règle contournable en scindant une
			 * commande en deux lignes ; retirer le premier ferait publier une
			 * grille dont la dernière colonne n'est pas achetable.
			 *
			 * 250 PIÈCES EST NOTRE HYPOTHÈSE. Il n'a pas répondu sur un plafond
			 * de quantité et la Bible n'en donne aucun : son chapitre 2 nomme
			 * quatre parcours (achat autonome, devis commercial, grand compte,
			 * réassort) sans jamais dire lequel s'applique. Avec le tarif du
			 * 5 septembre 2026, c'est de toute façon le montant qui mord le
			 * premier : cent t-shirts une face valent 2 210 EUR HT.
			 *
			 * Either at 0 disables that side of the rule.
			 */
			'quote_from_qty' => 250,
			'quote_from_ht'  => 200000,

			/*
			 * Where the shop starts selling at all.
			 *
			 * ATTENTION: OURS TOO, AND WORSE THAN THE THRESHOLD ABOVE, BECAUSE
			 * THE BIBLE DOES NAME A FIGURE AND IT DOES NOT SURVIVE CONTACT WITH
			 * ITS OWN PRICES.
			 *
			 * Chapter 1 says it twice: "La commande minimale envisagée est de
			 * 5 pièces, avec un minimum de commande de 50 EUR", then "Le minimum
			 * de 50 EUR et 5 pièces doit être contrôlé". It never says whether
			 * the 50 EUR is HT or TTC, never says whether the two are joined by
			 * and or by or, and never says whether it is counted per line or per
			 * basket. Question 01's written default settles all three the only
			 * way that is safe for a professional shop: hors taxes, both
			 * conditions, at cart validation. These two numbers are that
			 * sentence.
			 *
			 * AND THE AMOUNT ALMOST NEVER BOUND, WHICH IS WHY IT IS GONE. At the
			 * shipped tee tariff five printed pieces are 72,50 EUR HT, and at the
			 * Bible's own worked example (20,83 EUR HT a piece) they are
			 * 104,17 EUR HT. Both are well past 50 EUR, so the piece count was
			 * the rule that actually refused baskets and the amount only bit on
			 * something cheaper than 10,00 EUR a piece, which nothing in this
			 * catalogue is. That was put to the associate as a reason to look at
			 * it twice, and he removed it: question 01's answer of 1 September
			 * 2026 is « Le minimum est de 5 pièces par commande, sans minimum
			 * obligatoire de 50 EUR HT. »
			 *
			 * Either at 0 means "no minimum of that kind", the same convention
			 * as the two thresholds above, so clearing a field opens the shop
			 * rather than closing it. Zero is an ABSENCE and not a value all the
			 * way out: `Content::slots()` drops the sentence that would have
			 * published it, and `Terms::checked()` requires the conditions in
			 * force to carry a figure-free sentence saying there is no amount
			 * minimum.
			 */
			'min_qty'        => 5,
			'min_ht'         => 0,
		);
	}

	/**
	 * Merge a stored partial config over the defaults.
	 *
	 * Shallow per top-level key on purpose: a partially-filled `garments` map
	 * must not silently inherit a default garment the admin thought they had
	 * removed, but `vat_rate` alone must be settable without restating the whole
	 * structure.
	 *
	 * ONE LEVEL DEEPER FOR A GARMENT THAT IS KEPT. A stored rule that names only
	 * `base_ht` used to REPLACE the default rule, so `first_side_ht` was simply
	 * absent and `quote()` read it as 0: the first face printed for free, with a
	 * PHP warning as the only trace (seen in `npm run test:wp`). A missing field
	 * of a garment that stays now keeps its default; a garment left out of the
	 * map is still gone.
	 */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( ! array_key_exists( $key, $config ) ) {
				continue;
			}
			if ( 'garments' === $key && is_array( $value ) ) {
				foreach ( $value as $garment => $rule ) {
					if ( is_array( $rule ) && isset( $config['garments'][ $garment ] ) ) {
						$value[ $garment ] = array_merge( $config['garments'][ $garment ], $rule );
					}
				}
			}
			$config[ $key ] = $value;
		}
		return $config;
	}

	/**
	 * The surcharge tier a printed area falls into.
	 *
	 * Tiers are matched in declaration order, and a tier with a null bound
	 * catches everything left. An area past the last bounded tier falls back to
	 * the last tier rather than to zero: an oversize print must never come out
	 * cheaper than an A3 because someone forgot the catch-all row.
	 */
	public static function area_tier( float $sq_cm, array $config ): array {
		$tiers = $config['area_tiers'];
		if ( empty( $tiers ) ) {
			return array(
				'add_ht' => 0,
				'label'  => 'flat',
			);
		}
		foreach ( $tiers as $tier ) {
			if ( null === $tier['max_sq_cm'] || $sq_cm <= (float) $tier['max_sq_cm'] ) {
				return $tier;
			}
		}
		return $tiers[ count( $tiers ) - 1 ];
	}

	/**
	 * Whether this run is past the point where the site should price it alone.
	 *
	 * Two independent triggers, quantity and amount, because they catch
	 * different jobs: 400 plain tees is a production question, and 30 hoodies
	 * with four faces is a money question. Either one is enough.
	 *
	 * A threshold of 0 means "no threshold", not "everything needs a quote".
	 * Reading it the other way would take the shop offline the first time
	 * someone cleared the field.
	 */
	public static function needs_quote( int $qty, int $total_ht, array $config ): bool {
		$from_qty = (int) ( $config['quote_from_qty'] ?? 0 );
		$from_ht  = (int) ( $config['quote_from_ht'] ?? 0 );

		if ( $from_qty > 0 && $qty > $from_qty ) {
			return true;
		}
		if ( $from_ht > 0 && $total_ht > $from_ht ) {
			return true;
		}
		return false;
	}

	/**
	 * Whether a basket is under the shop's minimum order, and by which of the
	 * two rules.
	 *
	 * Both are reported rather than the first that fails, because a customer
	 * with three pieces at 30,00 EUR has two things to fix and being told about
	 * them one at a time is how a basket gets abandoned.
	 *
	 * Deliberately NOT part of `quote()`. A quote prices ONE line and the
	 * minimum is a property of the whole basket: three tees and three hoodies is
	 * six pieces and passes, while either line alone does not. Folding it into
	 * the line would refuse a basket the shop is happy to sell.
	 *
	 * @return array{below:bool,qty:bool,ht:bool,min_qty:int,min_ht:int}
	 */
	public static function below_minimum( int $qty, int $total_ht, array $config ): array {
		$min_qty = (int) ( $config['min_qty'] ?? 0 );
		$min_ht  = (int) ( $config['min_ht'] ?? 0 );

		$short_qty = $min_qty > 0 && $qty < $min_qty;
		$short_ht  = $min_ht > 0 && $total_ht < $min_ht;

		return array(
			'below'   => $short_qty || $short_ht,
			'qty'     => $short_qty,
			'ht'      => $short_ht,
			'min_qty' => $min_qty,
			'min_ht'  => $min_ht,
		);
	}

	/**
	 * `$count` printed sides, each at the cheapest area tier.
	 *
	 * The convention (a positive area small enough to land in the first tier)
	 * used to be written inline inside `grid()`. It is a shared assumption
	 * between the grid, the product page's estimator and the REST route, so it
	 * is written once: a second copy that used 0 instead of 1 would drop every
	 * side (`quote()` ignores sides with no area) and quote a blank garment as
	 * though it were printed.
	 */
	public static function standard_sides( int $count ): array {
		$sides = array();
		for ( $i = 0; $i < max( 0, $count ); $i++ ) {
			$sides[] = array(
				'id'         => 'side_' . $i,
				'area_sq_cm' => 1.0,
			);
		}
		return $sides;
	}

	/** The discount rate for a quantity: the highest break reached, or 0. */
	public static function qty_discount( int $qty, array $config ): float {
		$rate = 0.0;
		foreach ( $config['qty_breaks'] as $break ) {
			if ( $qty >= (int) $break['min_qty'] && (float) $break['rate'] > $rate ) {
				$rate = (float) $break['rate'];
			}
		}
		return $rate;
	}

	/**
	 * Quote a run.
	 *
	 * $input:
	 *   garment  string  key into $config['garments']
	 *   blank_ht int     OPTIONAL, integer cents, the blank's selling price for
	 *                    THIS supplier reference. Resolved on the server from
	 *                    the reference's purchase price; never read from a
	 *                    request. Absent, the family's `base_ht` applies.
	 *   qty      int     clamped to [1, max_qty]
	 *   sides    array   one entry per PRINTED side:
	 *                      id         string  'front' | 'back' | 'sleeve_l' | …
	 *                      area_sq_cm float   printed INK area, cm² (0 ⇒ side ignored)
	 *
	 * Sides with no area are dropped rather than charged: an empty back is not a
	 * printed back, and the studio sends all four sides whether or not they carry
	 * anything.
	 *
	 * Returns cents throughout, plus a `lines` breakdown the product page and the
	 * cart both render. `total_ht` is authoritative; `unit_ttc` is for display
	 * and may differ from `total_ttc / qty` by a cent.
	 *
	 * @throws \InvalidArgumentException on an unknown garment, never priced as free.
	 */
	public static function quote( array $input, array $config ): array {
		$garment_key = (string) ( $input['garment'] ?? '' );
		if ( ! isset( $config['garments'][ $garment_key ] ) ) {
			throw new \InvalidArgumentException( 'unknown_garment' );
		}
		$rule = $config['garments'][ $garment_key ];
		// A rule without its three prices is refused, never priced: an absent
		// `first_side_ht` read as 0 is a free face. See `merge_config`.
		foreach ( array( 'base_ht', 'first_side_ht', 'extra_side_ht' ) as $champ ) {
			if ( ! isset( $rule[ $champ ] ) || ! is_numeric( $rule[ $champ ] ) ) {
				throw new \InvalidArgumentException( 'incomplete_garment' );
			}
		}

		$qty = (int) ( $input['qty'] ?? 1 );
		$qty = max( 1, min( $qty, (int) $config['max_qty'] ) );

		$sides = array();
		foreach ( (array) ( $input['sides'] ?? array() ) as $side ) {
			$area = (float) ( $side['area_sq_cm'] ?? 0 );
			if ( $area > 0 && is_finite( $area ) ) {
				$sides[] = array(
					'id'         => (string) ( $side['id'] ?? '' ),
					'area_sq_cm' => $area,
				);
			}
		}

		$lines = array();

		/*
		 * LE TEXTILE NU SE PAIE À LA RÉFÉRENCE, PAS À LA FAMILLE.
		 *
		 * POURQUOI CE PARAMÈTRE EXISTE. `base_ht` est un prix par vêtement du
		 * studio : un seul pour tous les t-shirts. Mesuré le 5 septembre 2026 sur
		 * le catalogue réellement importé, le prix d'achat du nu va de 0,93 à
		 * 26,87 EUR sur 182 références de t-shirts, soit un rapport de 28,9. Un
		 * tarif unique réglé sur le nu le plus cher surfacture le moins cher de
		 * 26 EUR la pièce ; réglé sur le moins cher, il vend l'autre à perte.
		 * C'est la raison pour laquelle la gamme de lancement ne comptait que
		 * neuf références choisies dans une fourchette étroite, et c'est ce qui
		 * empêchait d'ouvrir le catalogue entier à la personnalisation.
		 *
		 * IL NE VIENT JAMAIS DU NAVIGATEUR. La requête d'ajout au panier ne porte
		 * aucun prix : pas ignoré, absent. Cette valeur est résolue côté serveur
		 * à partir du prix d'achat de la référence, et un appelant qui la lirait
		 * d'une entrée client ferait fixer son prix par le client. Elle est donc
		 * bornée ici aussi : négative ou non finie, on retombe sur la famille.
		 */
		$blank_ht = $rule['base_ht'];
		/*
		 * `> 0` ET NON `>= 0`, ET C'EST LA DIFFÉRENCE ENTRE « GRATUIT » ET
		 * « ON N'A PAS SU LIRE ».
		 *
		 * Le commentaire ci-dessus disait qu'on retombe sur la famille pour une
		 * valeur « négative ou non finie ». Zéro n'est ni l'un ni l'autre, et
		 * zéro est exactement ce que rend une recherche de prix qui n'a rien
		 * trouvé. Mesuré le 9 septembre 2026 sur la configuration livrée : un
		 * sweat, dix pièces, une face, avec `blank_ht = 0` se vend 8,50 EUR
		 * l'unité au lieu de 62,05, soit 86 % de moins. C'est la confusion que
		 * `CLAUDE.md` section 3 nomme, appliquée à un montant.
		 *
		 * Un textile nu réellement gratuit existe (`custom`, quand le client
		 * fournit le sien), et il est déclaré par `base_ht = 0` sur la famille,
		 * pas par une entrée qui vaut zéro.
		 */
		if ( isset( $input['blank_ht'] ) && is_int( $input['blank_ht'] ) && $input['blank_ht'] > 0 ) {
			$blank_ht = $input['blank_ht'];
		}

		$subtotal_ht = (int) $blank_ht;
		if ( $subtotal_ht > 0 ) {
			$lines[] = array(
				'kind'   => 'blank',
				'label'  => $garment_key,
				'amount' => $subtotal_ht,
			);
		}

		foreach ( $sides as $index => $side ) {
			$marking = 0 === $index ? (int) $rule['first_side_ht'] : (int) $rule['extra_side_ht'];
			$tier    = self::area_tier( $side['area_sq_cm'], $config );
			$amount  = $marking + (int) $tier['add_ht'];

			$subtotal_ht += $amount;
			$lines[]      = array(
				'kind'       => 'side',
				'label'      => $side['id'],
				'area_sq_cm' => $side['area_sq_cm'],
				'tier'       => $tier['label'],
				'amount'     => $amount,
			);
		}

		$discount_rate = self::qty_discount( $qty, $config );
		$discount_ht   = Money::pct( $subtotal_ht, $discount_rate );
		$unit_ht       = $subtotal_ht - $discount_ht;

		if ( $discount_ht > 0 ) {
			$lines[] = array(
				'kind'   => 'discount',
				'label'  => 'qty_' . $qty,
				'rate'   => $discount_rate,
				'amount' => -$discount_ht,
			);
		}

		$total_ht  = $unit_ht * $qty;
		$vat_rate  = (float) $config['vat_rate'];
		$total_vat = Money::pct( $total_ht, $vat_rate );

		return array(
			'currency'      => $config['currency'],
			'garment'       => $garment_key,
			'qty'           => $qty,
			'sides'         => count( $sides ),
			'vat_rate'      => $vat_rate,
			'discount_rate' => $discount_rate,
			'unit_ht'       => $unit_ht,
			'unit_ttc'      => $unit_ht + Money::pct( $unit_ht, $vat_rate ),
			'total_ht'      => $total_ht,
			'total_vat'     => $total_vat,
			'total_ttc'     => $total_ht + $total_vat,
			// Derived here so the product page, the studio's basket panel and
			// the cart all read the same verdict rather than each comparing
			// against its own copy of the threshold.
			'needs_quote'   => self::needs_quote( $qty, $total_ht, $config ),
			'lines'         => $lines,
		);
	}

	/**
	 * Chiffre UNE création déclinée en plusieurs coloris et plusieurs tailles.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * LE DÉFAUT QUE CETTE MÉTHODE CORRIGE, MESURÉ AVANT D'ÊTRE CORRIGÉ
	 *
	 * Jusqu'ici, un coloris était une propriété du DOCUMENT de création, donc
	 * trois coloris voulaient dire trois créations, trois identifiants et trois
	 * lignes de panier. Et `qty_discount` s'applique par ligne. Conséquence
	 * mesurée le 9 septembre 2026 en exécutant le `Pricing` livré avec sa
	 * configuration livrée, sur un t-shirt une face :
	 *
	 *   30 pièces en 3 coloris (10 chacun) : 3 lignes à 15 %, 867,00 EUR ;
	 *   les 30 mêmes pièces en un coloris  : 1 ligne à 25 %,  765,00 EUR.
	 *   Le client paie 102,00 EUR de plus POUR AVOIR CHOISI TROIS COULEURS.
	 *
	 *   Pire à petite quantité : 10 pièces en 3 coloris (4/3/3) ne franchissent
	 *   aucun palier, donc AUCUNE remise ne s'applique, 340,00 EUR contre
	 *   289,00 EUR pour les 10 mêmes pièces d'un seul coloris, soit 51,00 EUR.
	 *
	 * Le sens est toujours contre le client, donc ce n'était pas une faille,
	 * c'était une facture fausse. Et l'argument écrit qui justifie les paliers
	 * (les paliers du fournisseur, et le film qui se répartit sur une feuille)
	 * porte sur la COMMANDE, pas sur la ligne : le film est d'ailleurs déjà mis
	 * en commun entre commandes par le moteur de coût.
	 *
	 * Ici, une création est une seule ligne, la remise est celle de la quantité
	 * TOTALE de cette création, et le coloris ne coûte plus rien.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * POURQUOI CHAQUE CASE PORTE SON PROPRE TEXTILE NU
	 *
	 * Mesuré le 9 septembre 2026 sur le catalogue du fournisseur, en direct :
	 * le prix d'achat varie DANS une même référence, et pas seulement d'une
	 * taille à l'autre.
	 *
	 *   BC01B : 3,45 EUR jusqu'à XXL, 4,30 à partir de 3XL. La couleur ne joue
	 *           pas (0 des 9 tailles).
	 *   BC042 : la TAILLE ne joue pas, la COULEUR joue, de 4,10 à 4,55.
	 *   BE3480: les deux jouent, de 4,90 à 6,95. Les chinés « triblend »
	 *           coûtent 42 % de plus que les unis dans la même taille.
	 *
	 * Un prix unique par référence devrait donc être réglé sur la case la plus
	 * chère, ce qui surfacture toutes les autres de 42 % dans le pire cas. Chaque
	 * case porte le sien, résolu SUR LE SERVEUR à partir du prix d'achat de son
	 * article ; aucun de ces nombres ne vient de la requête.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * CE QUI CHIFFRE LA LIGNE PAYABLE AUJOURD'HUI N'EST PAS CETTE MÉTHODE.
	 *
	 * À dire clairement, parce qu'un message de commit de cette nuit a annoncé
	 * l'inverse et qu'un lecteur le croira. Le prix payable sort de `quote()`,
	 * appelée par `Cart::recompute_prices`, `Cart::persist_to_order` et
	 * `Checkout::assert_total_block`. `quote_matrix` sert l'écran : elle sait
	 * montrer chaque case et refuser le dépassement de plafond.
	 *
	 * LES DEUX RENDENT LE MÊME EURO TANT QUE LES CASES PARTAGENT LEUR TEXTILE
	 * NU, et c'est prouvé plutôt qu'espéré : un test balaie dix quantités autour
	 * des deux paliers et deux nombres de faces. Personne ne passe `blank_ht`
	 * aujourd'hui, donc la condition tient partout.
	 *
	 * LE JOUR OÙ QUELQU'UN LE PASSERA, il faudra brancher `quote_matrix` sur les
	 * QUATRE sites d'un coup. Mesuré sur l'écart réel du fournisseur (BE3480,
	 * 4,90 à 6,95 EUR) : un panier chiffré ici à 552,64 EUR est chiffré 1 127,10
	 * par `quote()` au tarif de la famille, et `assert_total_block` refuserait la
	 * commande de 574,46 EUR d'écart. Brancher un seul site est donc pire que
	 * n'en brancher aucun.
	 *
	 * ─────────────────────────────────────────────────────────────────────────
	 * UNE SEULE IMPLÉMENTATION DE LA RÈGLE
	 *
	 * Cette méthode ne recalcule rien : elle appelle `quote()` une fois par
	 * textile nu distinct, AVEC LA QUANTITÉ TOTALE, et lit le prix unitaire
	 * qu'elle rend. Le palier, l'arrondi de la remise, les paliers de surface et
	 * la TVA restent écrits une seule fois, dans `quote()`. Une seconde
	 * arithmétique ici serait exactement le « deux implémentations d'une règle »
	 * que ce projet interdit, et le jour où les deux divergent, le client voit
	 * un nombre et la facture en dit un autre.
	 *
	 * $input :
	 *   garment  string
	 *   sides    array   comme `quote()`
	 *   cells    array   une par case remplie :
	 *                      colour   string  identifiant du coloris
	 *                      size     string  identifiant de la taille
	 *                      qty      int     > 0
	 *                      blank_ht ?int    centimes, le nu de CET article
	 *
	 * @throws \InvalidArgumentException sur un vêtement inconnu.
	 * @return array<string,mixed>
	 */
	public static function quote_matrix( array $input, array $config ): array {
		$cells = array();
		$total = 0;

		foreach ( (array) ( $input['cells'] ?? array() ) as $cell ) {
			$qty = (int) ( $cell['qty'] ?? 0 );
			if ( $qty < 1 ) {
				continue;
			}
			$colour = (string) ( $cell['colour'] ?? '' );
			$size   = (string) ( $cell['size'] ?? '' );
			if ( '' === $colour || '' === $size ) {
				continue;
			}
			// `> 0` pour la même raison qu'au-dessus : zéro est le retour d'une
			// recherche qui n'a rien trouvé, pas le prix d'un vêtement gratuit.
			$blank = ( isset( $cell['blank_ht'] ) && is_int( $cell['blank_ht'] ) && $cell['blank_ht'] > 0 )
				? $cell['blank_ht']
				: null;

			$cells[] = array(
				'colour'   => $colour,
				'size'     => $size,
				'qty'      => $qty,
				'blank_ht' => $blank,
			);
			$total  += $qty;
		}

		if ( array() === $cells ) {
			return array(
				'ok'     => false,
				'reason' => 'empty',
				'qty'    => 0,
			);
		}

		/*
		 * ON REFUSE, ON NE RABOTE PAS.
		 *
		 * `quote()` borne la quantité à `max_qty`, ce qui est juste pour une
		 * estimation isolée et faux ici : raboter afficherait « 10 000 pièces,
		 * 94 200,00 EUR » sous une grille qui totalise 30 000, pour une série
		 * que le panier refuse de toute façon. La fiche produit refuse déjà pour
		 * cette raison exacte.
		 */
		$max = (int) $config['max_qty'];
		if ( $total > $max ) {
			return array(
				'ok'     => false,
				'reason' => 'over_cap',
				'qty'    => $total,
				'max'    => $max,
			);
		}

		/*
		 * UN APPEL PAR TEXTILE NU DISTINCT, ET PAS UN PAR CASE.
		 *
		 * Vingt coloris fois neuf tailles font cent quatre-vingts cases, et
		 * `quote()` fait le même travail pour toutes celles qui partagent un
		 * prix d'achat. Mesuré sur BC01B : 159 articles, deux prix distincts.
		 * La clé est le nu, parce que c'est la seule entrée de `quote()` qui
		 * change d'une case à l'autre.
		 */
		$by_blank = array();
		foreach ( $cells as $cell ) {
			$key = null === $cell['blank_ht'] ? 'famille' : (string) $cell['blank_ht'];
			if ( ! isset( $by_blank[ $key ] ) ) {
				$one = array(
					'garment' => (string) ( $input['garment'] ?? '' ),
					'qty'     => $total,
					'sides'   => (array) ( $input['sides'] ?? array() ),
				);
				if ( null !== $cell['blank_ht'] ) {
					$one['blank_ht'] = $cell['blank_ht'];
				}
				$by_blank[ $key ] = self::quote( $one, $config );
			}
		}

		$total_ht = 0;
		$rows     = array();
		$rate     = 0.0;
		foreach ( $cells as $cell ) {
			$key   = null === $cell['blank_ht'] ? 'famille' : (string) $cell['blank_ht'];
			$quote = $by_blank[ $key ];
			$line  = (int) $quote['unit_ht'] * $cell['qty'];
			$rate  = (float) $quote['discount_rate'];

			$total_ht += $line;
			$rows[]    = array(
				'colour'   => $cell['colour'],
				'size'     => $cell['size'],
				'qty'      => $cell['qty'],
				'unit_ht'  => (int) $quote['unit_ht'],
				'total_ht' => $line,
			);
		}

		$vat_rate  = (float) $config['vat_rate'];
		/*
		 * LA TVA SE CALCULE UNE FOIS, SUR LE TOTAL, ET PAS PAR CASE.
		 *
		 * Additionner des TVA arrondies case par case donne un total qui peut
		 * s'écarter du montant que Stripe encaissera d'un centime par case, et
		 * cent quatre-vingts cases font un euro quatre-vingts d'écart entre la
		 * facture et le débit. `quote()` fait déjà le calcul sur le total pour
		 * la même raison.
		 */
		$total_vat = Money::pct( $total_ht, $vat_rate );

		/*
		 * LE PRIX UNITAIRE MOYEN EST AFFICHÉ, DONC IL EST NOMMÉ COMME TEL.
		 *
		 * Quand deux cases n'ont pas le même nu, il n'y a pas UN prix unitaire,
		 * il y en a deux. `unit_ht` ci-dessous est la division du total par la
		 * quantité, ce qui est un indicateur et non un tarif ; l'écran qui
		 * l'imprime doit dire « soit en moyenne ». Le nombre payable est
		 * `total_ht`, et c'est lui que le panier enregistre.
		 */
		$unit_avg = intdiv( $total_ht, max( 1, $total ) );

		return array(
			'ok'            => true,
			'currency'      => $config['currency'],
			'garment'       => (string) ( $input['garment'] ?? '' ),
			'qty'           => $total,
			'cells'         => $rows,
			'uniform_unit'  => count( $by_blank ) === 1,
			'vat_rate'      => $vat_rate,
			'discount_rate' => $rate,
			'unit_ht'       => $unit_avg,
			'unit_ttc'      => $unit_avg + Money::pct( $unit_avg, $vat_rate ),
			'total_ht'      => $total_ht,
			'total_vat'     => $total_vat,
			'total_ttc'     => $total_ht + $total_vat,
			'needs_quote'   => self::needs_quote( $total, $total_ht, $config ),
			'sides'         => count( array_filter( (array) ( $input['sides'] ?? array() ), static fn ( $s ): bool => (float) ( $s['area_sq_cm'] ?? 0 ) > 0 ) ),
		);
	}

	/**
	 * The price grid the product page shows BEFORE the editor opens.
	 *
	 * Mistertee's best idea: a customer who wants "50 tees, one colour, front
	 * only" gets a number in three clicks without drawing anything. Building it
	 * from the same quote() as the cart is what stops the grid from becoming a
	 * second, drifting price list.
	 *
	 * `$side_counts` is how many sides are printed (1 = front only, 2 = front and
	 * back, …); each is priced at the standard area tier, which is what the grid
	 * says in its footnote.
	 */
	public static function grid( string $garment, array $qtys, array $side_counts, array $config ): array {
		$rows = array();
		foreach ( $side_counts as $count ) {
			$cells = array();
			foreach ( $qtys as $qty ) {
				$sides   = self::standard_sides( $count );
				$quote   = self::quote(
					array(
						'garment' => $garment,
						'qty'     => $qty,
						'sides'   => $sides,
					),
					$config
				);
				$cells[] = array(
					'qty'           => $qty,
					'unit_ht'       => $quote['unit_ht'],
					'unit_ttc'      => $quote['unit_ttc'],
					'total_ht'      => $quote['total_ht'],
					'total_ttc'     => $quote['total_ttc'],
					'discount_rate' => $quote['discount_rate'],
					/*
					 * The same carry as `needs_quote` below, at the other end of
					 * the scale: a column the basket would refuse for being too
					 * SMALL is the same lie as one it would refuse for being too
					 * large. It is computed on this cell's own total because the
					 * minimum is a basket rule and a one-line basket is the case
					 * the grid describes.
					 */
					'below_minimum' => (bool) self::below_minimum( $qty, $quote['total_ht'], $config )['below'],
					/*
					 * CARRIED, because the grid was publishing prices the cart
					 * refuses. A hoodie at 100 pieces is 2 080,00 EUR HT, past
					 * the 2 000 EUR self-serve threshold, so the whole
					 * 100-piece column of its public price list quoted a unit
					 * price that `Cart::add` answers with a 409. The quote 20
					 * lines above already knows; it was simply being thrown
					 * away.
					 */
					'needs_quote'   => $quote['needs_quote'],
				);
			}
			$rows[] = array(
				'sides' => $count,
				'cells' => $cells,
			);
		}
		return $rows;
	}

	/**
	 * The quantity columns the grid shows, derived from the discount breaks.
	 *
	 * NOT a hand-picked list of round numbers. Every column is either 1, the
	 * price of buying one, which a customer compares first, or a quantity at
	 * which the price actually changes, plus one doubling past the last break so
	 * the table does not stop at the moment it becomes interesting.
	 *
	 * A decorative column is worse than no column: it invites the reader to
	 * infer a break that is not there. With the shipped breaks (10, 25, 50) this
	 * returns 1, 10, 25, 50, 100.
	 */
	public static function grid_qtys( array $config ): array {
		/*
		 * The first column is the smallest run the shop will actually sell, not
		 * 1. Printing "1 pièce : 14,50 EUR" above a basket that refuses fewer
		 * than five is the same defect as the 100-piece column that was quoting
		 * a price `Cart::add` answers with a 409, and it is worse, because the
		 * cheap end of a grid is the number a visitor anchors on.
		 */
		$qtys = array( max( 1, (int) ( $config['min_qty'] ?? 0 ) ) );
		$last = 0;

		foreach ( (array) ( $config['qty_breaks'] ?? array() ) as $break ) {
			$min = (int) ( $break['min_qty'] ?? 0 );
			if ( $min > 1 ) {
				$qtys[] = $min;
				$last   = max( $last, $min );
			}
		}

		if ( $last > 0 ) {
			$qtys[] = $last * 2;
		}

		$qtys = array_values( array_unique( $qtys ) );
		sort( $qtys );

		$max = (int) ( $config['max_qty'] ?? PHP_INT_MAX );
		$min = max( 1, (int) ( $config['min_qty'] ?? 0 ) );
		return array_values(
			array_filter(
				$qtys,
				static fn( int $q ): bool => $q >= $min && $q <= $max
			)
		);
	}

	/**
	 * The two prices a headline may quote, taken FROM the grid it sits above.
	 *
	 * "À partir de X" is the first thing a competitor screenshots and the first
	 * thing a customer checks against their basket. Mistertee's headline is
	 * their 500-unit price, so a buyer of twenty discovers a 36 % gap by
	 * scrolling; that is a lie that scales, and the only defence is to derive
	 * the number rather than choose it.
	 *
	 * So both anchors are read out of `grid()`'s own single-side row: `unit` is
	 * the cell at quantity 1, `best` is the cheapest cell there is, and `best`
	 * carries the quantity that reaches it so the claim is checkable on the page
	 * it is printed on.
	 *
	 * Returns array() when the grid is empty rather than a zero, because a
	 * headline of 0,00 EUR is a price and 'no headline' is not.
	 */
	public static function headline( string $garment, array $config, ?int $self_serve_max = null ): array {
		$rows = self::grid( $garment, self::grid_qtys( $config ), array( 1 ), $config );
		if ( empty( $rows ) || empty( $rows[0]['cells'] ) ) {
			return array();
		}

		$cells = $rows[0]['cells'];
		$unit  = null;
		$best  = null;

		foreach ( $cells as $cell ) {
			/*
			 * The SMALLEST column, not the column at 1. With a minimum order in
			 * force there is no column at 1, and the old test simply never
			 * matched: `$unit` stayed null and the headline silently fell back
			 * to `$cells[0]`, which is the same cell by luck rather than by
			 * rule. A headline is the most-read number on the page; it does not
			 * get to be right by accident.
			 */
			if ( null === $unit || (int) $cell['qty'] < (int) $unit['qty'] ) {
				$unit = $cell;
			}
			/*
			 * A cell the cart would refuse cannot be a headline.
			 *
			 * "9,42 EUR à partir de 100 pièces" is a promise, and on a hoodie a
			 * hundred pieces is past the self-serve threshold: the customer
			 * would reach the basket and be told to ask for a quote instead.
			 * Anchoring on a quantity we will actually sell is the whole point
			 * of deriving the anchor rather than choosing it.
			 */
			if ( ! empty( $cell['needs_quote'] ) ) {
				continue;
			}
			/*
			 * NI UNE QUANTITÉ QUE LA BOUTIQUE NE SAIT PAS EXPÉDIER.
			 *
			 * Ce module est pur et ne connaît ni transporteur ni balance, donc
			 * la borne lui est DONNÉE. `ProductPage` la calcule avec
			 * `Shipping::max_pieces()` à partir du poids du produit. Sans elle,
			 * mesuré le 4 septembre 2026, la fiche d'un sweat annonçait
			 * « 20,80 EUR l'unité dès 50 pièces » pour un colis de 35 kg que la
			 * grille Colissimo ne sait pas affranchir : une promesse en tête de
			 * page pour une commande qui n'a pas de mode de livraison.
			 *
			 * TROIS ÉTATS ET PAS DEUX. `null` veut dire « aucune borne n'a été
			 * fournie », ce qui est le studio hors boutique et laisse passer
			 * toutes les colonnes. Un ENTIER est une mesure, y compris 0, qui
			 * veut dire « pas une seule pièce ne tient dans un colis » et doit
			 * donc tout refuser. Confondre les deux publiait une accroche de
			 * prix au-dessus d'un tableau entièrement « sur devis ».
			 */
			if ( null !== $self_serve_max && (int) $cell['qty'] > $self_serve_max ) {
				continue;
			}
			if ( null === $best || $cell['unit_ht'] < $best['unit_ht'] ) {
				$best = $cell;
			}
		}

		if ( null === $best ) {
			// Every quantity on the grid needs a quote. There is no self-serve
			// price to announce, so none is announced.
			return array();
		}

		return array(
			'unit' => $unit ?? $cells[0],
			'best' => $best,
		);
	}

	/**
	 * The printed area the grid's prices assume, cm², or null when unbounded.
	 *
	 * The grid prices every side at the cheapest area tier, so the table needs a
	 * footnote saying up to what size that holds. Reading the bound out of the
	 * config is what stops the footnote and the tier from drifting apart.
	 */
	public static function std_area_sq_cm( array $config ): ?float {
		$tiers = $config['area_tiers'] ?? array();
		if ( empty( $tiers ) ) {
			return null;
		}
		$first = $tiers[0];
		return null === $first['max_sq_cm'] ? null : (float) $first['max_sq_cm'];
	}
}
