<?php
/**
 * What an order actually costs us, itemised, with the provenance of every line.
 *
 * This is the Bible's chapter 1 "Modèle de coût détaillé" made executable. The
 * chapter's own instruction is the design of this file: a cost is never a
 * constant buried in code and never a per-logo guess, it is a component with an
 * amount, a source, a date and a confidence, and the report says which of them
 * nobody has filled in yet.
 *
 * ── WHY CONFIDENCE HAS FOUR VALUES AND NOT TWO ───────────────────────────────
 *
 * `REAL` and `ESTIMATED` are the chapter's own distinction ("lorsque le seul
 * prix disponible est un prix catalogue à diviser par 2 à 2,5, le système doit
 * marquer le coût comme estimé et utiliser le scénario prudent"). The other two
 * exist because this project has already paid for conflating them:
 *
 *   NONE     this component is genuinely zero on this order. No subcontracting
 *            was used; the customer shipped their own garment.
 *   UNKNOWN  we could not compute it. The Worker did not answer, the garment is
 *            not joined to a supplier reference, nobody has timed the operation.
 *
 * A zero and a failure add up to the same total and mean opposite things. An
 * order whose film cost is UNKNOWN has no floor price, because a floor derived
 * from a cost that is missing a component is a floor that is too low, and a
 * floor that is too low is worse than no floor: it authorises the sale.
 * `total()` refuses to call itself complete, and `Margin` refuses to state a
 * floor on an incomplete cost.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
 *
 * No selling price. `Pricing.php` is the price authority and this file never
 * touches it: they meet in `Costing.php`, which reads what an order was sold
 * for and asks this what it cost. Two files that both computed a price would
 * eventually disagree, and the customer would see one number and the invoice
 * another.
 *
 * No supplier identity and no per-supplier tariff table. The film tariff here is
 * one price for one format, because `scripts/php-guard.mjs` keeps supplier names
 * and film economics out of this plugin entirely: the surveyed supplier profiles
 * live in the studio's admin-only module, behind the bundle split, and they are
 * not what we pay.
 *
 * ── WHAT THE CHAPTER ASKS FOR AND THIS FILE DOES NOT COST ────────────────────
 *
 * Two parts of "Modèle de coût détaillé" are not built. Both wait on a number
 * nobody has given us rather than on work, and both have a row in
 * `docs/hypotheses.json` so that a late answer finds them:
 * H-Q12-COUT-PAR-TECHNIQUE and H-Q14-AUCUN-SUPPLEMENT-URGENCE. The rest of the
 * chapter's unbuilt surface, the part that awaits nobody's answer, is in
 * `docs/ROADMAP.md` under "Les exceptions assumées".
 *
 * ONLY DTF HAS A COST MODEL. The chapter costs embroidery by stitch count,
 * machine time, hooping, thread changes, digitising, support complexity and the
 * incident rate of a machine it calls unreliable, and wants a price per stitch
 * bracket, a setup fee, a subcontracting mode and a larger risk provision; it
 * wants flocking, vinyl and sublimation to each carry material, cutting or
 * printing time, weeding, press time, loss, preparation and a billing minimum.
 * None of that is here. Every one of those drivers is a number nobody has
 * measured or quoted: question 12 has not said which techniques open at launch,
 * and question 13 has not said whether embroidery is even ours. A plausible rate
 * per thousand stitches would produce a floor price, a margin and a commission
 * that look computed, on a cost we invented, which is the one thing this file
 * exists to prevent.
 *
 * What would receive it, when the answers come: `marquage` and `sous_traite` are
 * the components, `OPERATIONS` is where weeding and press time would join, and
 * the TECHNIQUES vocabulary in the scoped-floor rules is where the name goes.
 * Read `facts()` in the order-facing report before adding a key there: the
 * technique is DERIVED and not stored, so today every order with something to
 * press is called DTF and costed on film, and a second technique is mis-costed
 * by that one line before it ever reaches a cost model.
 *
 * NO EXPRESS OR URGENCY SUPPLEMENT. The chapter wants one covering dearer film
 * in France, production priority, a possible journey, higher risk and
 * coordination time, computed in percent or at real cost plus margin, and wants
 * urgency accepted only once stock, proof and capacity are confirmed. Nothing
 * here adds a centime for it. Urgency reaches the FLOOR and nothing else,
 * through `PriceRule`'s urgence selector.
 *
 * ── THE FILM IS BOUGHT BY THE SHEET, AND THERE IS ONE SUPPLIER ───────────────
 *
 * Question 04's answer of 1 September 2026: « 3 EUR par feuille A3+ de 33 x 46 cm »
 * from a French supplier, and « le moteur de coût doit pouvoir fonctionner à
 * partir du coût réel par feuille/surface utilisée, plutôt que de figer
 * arbitrairement un tarif au mètre ». `film()` therefore has two branches and the
 * config says which is in force; the roll branch, with its two origins, is kept
 * and tested because he has not yet confirmed whether the 3 EUR is HT or TTC and
 * a supplier who bills sheets today can bill metres in six months.
 *
 * WHAT THAT DELETED. Sessions 05 and 07 spent real effort on choosing between a
 * dear French roll and a Spanish one half the price, and on never letting a
 * ticked box make that choice: a run's origin had to be a purchase, with a date
 * and an operator against it. There is one supplier now, so `origins()` offers
 * one origin, `Production::origin_for` can no longer return 'es', and the
 * question the guard existed for stopped being askable. The machinery stays with
 * the roll branch it belongs to.
 *
 * IT IS ALSO DOWNSTREAM OF A PROMISE THE SHOP DOES NOT MAKE. No lead time is
 * announced anywhere (H-Q14-UN-COLIS-MAXIMUM), so express cannot be sold at all
 * before the associate answers question 14. Session 07 gave the workshop the
 * date and the capacity to schedule against, and measured that two of the three
 * promised lead times are shorter than the work they contain.
 *
 * Pure by construction: no WordPress function is called anywhere in this file,
 * so it runs under `php tests/run.php` with no bootstrap. Everything is integer
 * cents HT unless the name says otherwise.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Cost {

	// ── Confidence ───────────────────────────────────────────────────────────

	/** A real tariff, a real invoice, a real measurement. */
	public const REAL = 'reel';

	/** Derived from a catalogue price or an unconfirmed rate. Prudent scenario. */
	public const ESTIMATED = 'estime';

	/** Genuinely zero on this order. Answered, not forgotten. */
	public const NONE = 'neant';

	/** We could not compute it. NOT zero. See the header. */
	public const UNKNOWN = 'inconnu';

	// ── The components the chapter names ─────────────────────────────────────

	/**
	 * The ten direct-cost components of "Coût direct", in the chapter's own
	 * order, each with the French label an operator reads.
	 *
	 * The list is CLOSED. A cost that does not fit one of these rows belongs in
	 * `autres` with a source that says what it was, not in a new key nobody
	 * totals. The chapter's own sentence is the test of membership: "tout ce qui
	 * disparaît si la commande n'existe pas".
	 */
	public const COMPONENTS = array(
		'textile'      => 'Textile',
		'marquage'     => 'Marquage',
		'transport_in' => 'Transport fournisseur',
		'emballage'    => 'Emballage',
		'livraison'    => 'Livraison client',
		'paiement'     => 'Frais de paiement',
		'consommables' => 'Consommables',
		'sous_traite'  => 'Sous-traitance',
		'main_oeuvre'  => 'Main-d’œuvre',
		'defaut'       => 'Provision de défaut',
	);

	/**
	 * The standard operations of a run, in the chapter's own order.
	 *
	 * "Les temps standards sont à mesurer sur des séries réelles : réception,
	 * tri, préparation, pressage, pelage, second pressage, contrôle, pliage et
	 * emballage." Every one of them is here so the admin screen can show the
	 * operator which ones have never been timed, which is most of them.
	 *
	 * `per` says what the time is multiplied by:
	 *   order     once per order, whatever its size
	 *   piece     once per garment
	 *   transfer  once per transfer pressed (a garment with a chest logo and a
	 *             back print is two presses, and the split into visuals means a
	 *             single side can be more than one)
	 */
	public const OPERATIONS = array(
		'reception'      => array( 'label' => 'Réception et tri', 'per' => 'order' ),
		'preparation'    => array( 'label' => 'Préparation', 'per' => 'order' ),
		'pressage'       => array( 'label' => 'Pressage', 'per' => 'transfer' ),
		'pelage'         => array( 'label' => 'Pelage', 'per' => 'transfer' ),
		'second_pressage' => array( 'label' => 'Second pressage', 'per' => 'transfer' ),
		'controle'       => array( 'label' => 'Contrôle', 'per' => 'piece' ),
		'pliage'         => array( 'label' => 'Pliage et emballage', 'per' => 'piece' ),
	);

	/**
	 * Shipped defaults.
	 *
	 * ⚠ EVERY FIGURE HERE IS AN ASSUMPTION AND NOT THE BUSINESS'S NUMBER. Each
	 * one has a row in `docs/hypotheses.json` naming the question of
	 * `QUESTIONS-ASSOCIE.md` that settles it, and `scripts/hypotheses-guard.mjs`
	 * fails when this file and that register stop agreeing.
	 *
	 * The values that are ZERO are zero on purpose and they are not oversights:
	 * they are operations nobody has timed and provisions nobody has costed.
	 * Question 05 gives exactly two standard times and question 27 gives no
	 * defect rate at all. Putting a plausible figure in an untimed row would
	 * make a floor price out of an invention, so the row stays at zero, the
	 * report counts it as UNKNOWN rather than as answered, and the admin screen
	 * says so where the person who can measure it will see it.
	 */
	public static function default_config(): array {
		return array(
			/*
			 * Question 05's written default: "20 EUR de l'heure chargé".
			 *
			 * The chapter is emphatic that this is not optional: "La main-d'oeuvre
			 * ne doit pas être considérée comme gratuite parce que le dirigeant ou
			 * les proches produisent." A shop that costs its own time at zero
			 * concludes that every small order is profitable, and then discovers
			 * at scale that none of them were.
			 */
			'hourly_ht'     => 2000,

			/*
			 * Standard times, SECONDS, per the unit named in OPERATIONS.
			 *
			 * Question 05's answer of 1 September 2026: « En production à bon
			 * rythme, nous sommes capables de faire environ un T-shirt avec
			 * marquage devant + derrière en 30 secondes sur la phase de pose. »
			 * Two transfers in thirty seconds is FIFTEEN seconds a pose, where
			 * the written default assumed forty-five.
			 *
			 * ⚠ THIS ANSWER LOWERS THE FLOOR PRICE, AND IT IS THE ONLY ONE THAT
			 * DOES. Labour is a direct cost, so a third of the time is a third of
			 * the cost and a lower floor, on a cost that still counts five of the
			 * seven operations at zero and carries no defect provision at all. The
			 * associate asks for the missing chronometry himself, in the same
			 * paragraph: « Il faudra néanmoins chronométrer séparément un cycle
			 * complet incluant préparation, contrôle, pliage et emballage. » Until
			 * that arrives this figure makes the labour line more accurate and the
			 * TOTAL less so, which is worth knowing before reading a floor.
			 *
			 * The other five have never been timed on a real series and are
			 * therefore 0, which `labour()` reports as UNTIMED rather than as free.
			 */
			'times_s'       => array(
				'reception'       => 0,
				'preparation'     => 60,
				'pressage'        => 15,
				'pelage'          => 0,
				'second_pressage' => 0,
				'controle'        => 0,
				'pliage'          => 0,
			),

			/*
			 * The film.
			 *
			 * ── HE ANSWERED, AND HE CHANGED THE UNIT ─────────────────────────
			 *
			 * Question 04 asked for a ROLL tariff per linear metre and the answer
			 * of 1 September 2026 gives a SHEET: « Tarif actuel : 3 EUR par feuille
			 * A3+ de 33 x 46 cm », from a French supplier « qui nous pratique un
			 * tarif comparable aux prix espagnols », with the instruction that the
			 * engine must work « à partir du coût réel par feuille/surface
			 * utilisée, plutôt que de figer arbitrairement un tarif au mètre ».
			 *
			 * That is not the same number in another currency, it is another
			 * shape, and converting one to the other by hand is exactly what
			 * CLAUDE.md forbids. Per square metre the three tariffs are 19,76 EUR
			 * (this sheet), 30,36 EUR (the assumed French roll) and 16,07 EUR (the
			 * assumed Spanish roll), so his "comparable to Spanish prices" is
			 * right to within the HT/TTC question he has not answered: at 3 EUR
			 * TTC the sheet is 16,47 EUR the square metre, which is the Spanish
			 * roll almost exactly.
			 *
			 * ── WHAT A SHEET IS, TO THE PACKER ───────────────────────────────
			 *
			 * Nothing new. A stack of 33 x 46 cm sheets IS a 33 cm roll cut every
			 * 46 cm, which is what `nestRoll` already does with `width_cm` and
			 * `max_length_cm`, and it already returns the sheet count. So there is
			 * no second packer and no second geometry: `width_cm` and
			 * `max_length_cm` are simply what the workshop actually prints on, and
			 * `billing` says how the invoice is written on top of it.
			 *
			 * `billing_step_cm` equals the sheet height ON PURPOSE in this mode.
			 * A whole sheet is bought whatever is on it, so a length billed in
			 * tenths of a metre would be a second, disagreeing account of the same
			 * invoice; at 46 every sheet bills whole and `billed_m` stays exactly
			 * `sheets x 0,46`.
			 *
			 * ── WHAT IS STILL UNANSWERED, AND KEPT PRUDENT ───────────────────
			 *
			 * He classes four things as « à confirmer sur la facture fournisseur »:
			 * whether the 3 EUR is HT or TTC, the delivery charge, the order
			 * minimum and the lead time. So `delivery_ht` keeps the 15,00 EUR of
			 * question 04's written default rather than dropping to zero: an
			 * unknown cost taken as zero LOWERS the floor price, which is the one
			 * direction a floor may never move by accident. `min_sheets` is 1
			 * because you cannot buy a third of a sheet, which is a fact about
			 * paper and not an assumption about his supplier's order minimum.
			 *
			 * ── THE ROLL IS KEPT, AND IT IS NOT DEAD CODE ────────────────────
			 *
			 * `billing => 'roll'` still costs a roll per linear metre with the two
			 * origins, and tests/test-cost.php still exercises it. Two reasons it
			 * stays: the HT/TTC question can still move this tariff by twenty per
			 * cent, and a supplier who bills sheets today can bill metres in six
			 * months. It is one branch, not a second engine.
			 */
			'film'          => array(
				/** 'sheet' | 'roll'. What the supplier's invoice counts. */
				'billing'        => 'sheet',
				/*
				 * The sheet, and its price. 33 x 46 cm is the A3+ he names, and
				 * it must stay equal to `width_cm` x `max_length_cm`: they are one
				 * sheet described once as geometry for the packer and once as a
				 * line on an invoice. `tests/test-cost.php` pins the three of them
				 * together, because a shop nesting on one sheet and invoiced for
				 * another would look right on both screens.
				 */
				'sheet_ht'       => 300,
				'min_sheets'     => 1,
				/*
				 * The roll, kept for the mode above. Question 04's written
				 * default, which was the Bible's own order of magnitude, and which
				 * the answer of 1 September contradicts: nothing costs on these
				 * today.
				 */
				'rate_fr_ht'     => 1700,
				'rate_es_ht'     => 900,
				/*
				 * What the workshop PRINTS ON, whichever mode is in force, and
				 * what the nesting engine packs into. In sheet mode these are the
				 * sheet; in roll mode they are the roll (56 cm wide, files capped
				 * at 100 cm).
				 */
				'width_cm'       => 33.0,
				'delivery_ht'    => 1500,
				'min_m'          => 1.0,
				'waste_rate'     => 0.05,
				/*
				 * Space between two transfers on the sheet, cm. Not question 04's:
				 * it is the studio's own nesting default, and it is here so the
				 * cost is computed on the same geometry the workshop will print.
				 */
				'gap_cm'         => 0.5,
				/*
				 * Billing granularity, cm. It is here rather than only in the
				 * nesting request because the prudent bound has to round the same
				 * way: a bound that ignored the rounding came out BELOW the packed
				 * length on a small order, which is the one direction a bound may
				 * never take. Found by scripts/nest-verify.mjs.
				 *
				 * 10 (0,1 mètre linéaire) is what a roll supplier invoices. In
				 * sheet mode it is the sheet height, so a length and a sheet count
				 * can never say two different things about the same invoice.
				 */
				'billing_step_cm' => 46.0,
				/*
				 * The longest single file the supplier's printer accepts, cm.
				 *
				 * Nobody has told us, so this is the PRUDENT end of what is known
				 * rather than a round number. It shipped at 3 000 cm and that was
				 * wrong in the dangerous direction: every roll supplier surveyed
				 * for the studio's own DTF module caps a print file between 100
				 * and 250 cm, so a 30 m virtual sheet lets an order be billed as
				 * one long file when the supplier will cut it into a dozen, each
				 * rounded up to its own billing step. Fewer roundings is a lower
				 * cost, a lower floor, and a sale nobody would have authorised.
				 *
				 * 100 cm is the smallest of those, which is the safe one: too
				 * small only ever adds roundings. It is far above any transfer a
				 * garment can carry (a print area is around 40 cm), so nothing
				 * legitimate becomes unplaceable. Question 04 asks for the real
				 * figure.
				 *
				 * ANSWERED FOR SHEET MODE, and it stopped being a guess: a sheet
				 * IS the longest file, so this is 46, the height he gave. It also
				 * stopped being generous. A back print measures around 40 cm tall
				 * and now has 6 cm of headroom instead of 60, so a transfer taller
				 * than 46 cm is unplaceable and the order is refused instead of
				 * being costed on a sheet nobody can print. That is the correct
				 * answer and it is new: `scripts/nest-verify.mjs` covers it.
				 */
				'max_length_cm'  => 46.0,
				/*
				 * How long the film takes to arrive, WORKING DAYS, per origin.
				 *
				 * They live beside the rates because they are the same sentence.
				 * Question 04's written default is « 17 EUR hors taxes le mètre
				 * linéaire en 56 cm en France (48 h), 9 EUR hors taxes en Espagne
				 * (5 jours) »: a rate and a delay quoted together, and taking one
				 * without the other is how a run gets scheduled on the cheap
				 * origin's price and the dear origin's calendar.
				 *
				 * They are what decides which origin a print run may be bought
				 * from (`Production::origin_for`), which is the first thing in
				 * this project that ever lets an order be costed at the Spanish
				 * rate. Nothing else in the plugin reads them.
				 */
				'days_fr'        => 2,
				'days_es'        => 5,
			),

			/*
			 * Inbound freight from the textile supplier. Question 03's written
			 * default: "plus 8 EUR hors taxes de port en dessous de 200 EUR de
			 * commande".
			 */
			'freight_ht'    => 800,
			'freight_free_from_ht' => 20000,

			/*
			 * Card processing. Stripe's published rate for European cards, which
			 * is 1,5 % + 0,25 EUR, and question 15's written default is Stripe.
			 *
			 * It is charged on the amount actually taken, which is TTC: the
			 * processor does not know what part of a payment is our VAT, and it
			 * bills on the whole of it. Reading it as a percentage of the HT would
			 * understate the fee by the VAT rate, which is a fifth of it.
			 */
			'payment'       => array(
				'rate'         => 0.015,
				'fixed_ht'     => 25,
				/*
				 * Methods that cost nothing to receive. A transfer and a cheque
				 * carry no platform fee, and charging one against them would
				 * overstate the cost of exactly the orders a business customer
				 * places. WooCommerce's own gateway ids.
				 */
				'free_methods' => array( 'bacs', 'cheque', 'cod' ),
			),

			/*
			 * Provision for defects, as a share of the direct cost.
			 *
			 * ZERO, AND THE ZERO IS A REFUSAL. The chapter lists "provision de
			 * défaut" among the direct costs and gives no rate. Its worked example
			 * bills "paiement et provision SAV : 16 EUR" as ONE line, so the two
			 * cannot be separated from it either. Question 27 asks the associate
			 * for his real non-conformity rate.
			 *
			 * A zero here errs in the UNSAFE direction (a floor that is too low),
			 * which is exactly why `total()` reports it as an unanswered component
			 * rather than swallowing it: an incomplete cost is visible, and an
			 * invented one is not.
			 */
			'defect_rate'   => 0.0,

			/*
			 * Consumables per garment: transfer sheets, tape, cleaning. Never
			 * measured, same rule as the untimed operations.
			 */
			'consumables_piece_ht' => 0,

			/*
			 * Turning a supplier's CATALOGUE price into a purchase price.
			 *
			 * The chapter: "Lorsque le seul prix disponible est un prix catalogue à
			 * diviser par 2 à 2,5, le système doit marquer le coût comme estimé et
			 * utiliser le scénario prudent." Dividing by the SMALLER number gives
			 * the LARGER cost, so the prudent divisor is 2 and 2,5 is the
			 * optimistic one. Getting that backwards would flag the cost as
			 * estimated and then use the flattering figure, which is worse than
			 * not flagging it at all.
			 */
			'catalogue_divisor_prudent'    => 2.0,
			'catalogue_divisor_optimistic' => 2.5,

			/*
			 * The margin rules. Question 06's written default was "Marge cible 55 %
			 * sur textile et marquage, contribution minimale 25 % du prix hors
			 * taxes, remise maximale de 15 % sans validation de votre part", and
			 * the answer of 1 September 2026 moves the first of the three:
			 * « Nous retenons comme base un objectif de marge brute minimale
			 * d'environ 50 % après coûts directs, avec paramètres adaptables selon
			 * la technique. »
			 *
			 * READ AS THE TARGET AND NOT AS THE FLOOR, and the reading is worth
			 * stating because his sentence contains both words. « Marge brute après
			 * coûts directs », as a share of the selling price, is exactly what
			 * `target_margin_rate` is: prix = coût / (1 − taux) gives a gross
			 * margin equal to the rate. `min_contribution_rate` is a different
			 * quantity, what is left AFTER commission, so it cannot be what
			 * « marge brute » names. The other two are untouched: he confirms the
			 * floor exists (« Seul le dirigeant peut autoriser exceptionnellement
			 * une vente sous le prix plancher ») without giving either figure.
			 *
			 * `target_margin_rate` IS THE TAUX DE MARQUE, margin over selling
			 * price, which is the ratio the Bible's formula and its worked
			 * example use whatever the chapter calls it. See the second finding
			 * at the top of Margin.php: read as the words normally mean, the same
			 * 50 % prices a 250 EUR cost 125,00 EUR lower.
			 *
			 * `min_contribution_rate` is a share of the price, which is question
			 * 06's own wording and NOT the Bible's absolute contribution. The two
			 * are different formulas with different failure modes; both are in
			 * Margin.php and this is the one in force.
			 */
			'target_margin_rate'    => 0.50,
			'min_contribution_rate' => 0.25,
			'max_discount_rate'     => 0.15,

			/*
			 * What a blank costs us, per studio garment, when the order line is
			 * not a catalogue article that carries its own supplier price.
			 *
			 * EMPTY, and empty is a refusal rather than an oversight. `tee`,
			 * `hoodie` and `custom` are the studio's demonstration garments; they
			 * are joined to no supplier reference, so nothing in this repository
			 * knows what one costs. An invented figure here would produce a floor
			 * price, a margin and a commission that all look computed, on a
			 * purchase price nobody ever paid.
			 *
			 * Fill a row from the admin screen and every order costed after it
			 * uses it. The shape is `garment => ['ht' => int, 'source' => string,
			 * 'on' => 'YYYY-MM-DD']`, because a purchase price with no source and
			 * no date cannot be defended six months later, which is the whole
			 * point of the chapter's cost model.
			 */
			'garment_supply' => array(),
		);
	}

	/**
	 * The keys that are a FIXED SET OF NAMED PARAMETERS, and therefore merge
	 * key by key rather than replacing wholesale.
	 *
	 * ── WHY THIS DISTINCTION EXISTS, AND WHAT IT COST TO LEARN ───────────────
	 *
	 * `Pricing::merge_config` replaces per top-level key, and it is right to:
	 * `garments` is a COLLECTION, and an admin who removes a garment must not
	 * silently get it back. Copying that rule here was wrong, because `film` is
	 * not a collection. The settings screen owned eight of its nine fields at the
	 * time, so the first press of Enregistrer stored an eight-key `film` array
	 * that REPLACED the nine-key default, and `billing_step_cm` stopped existing.
	 *
	 * The map has ELEVEN fields now: session 07 added the two transit delays,
	 * `days_fr` and `days_es`, which no screen writes either. That is why this
	 * merge is key by key and not a replacement, and it is the reason a new field
	 * can be added here without a screen at all: the ones nobody edits keep their
	 * shipped value instead of vanishing.
	 *
	 * `prudent_length_cm()` then read a billing step of 0 and refused, so
	 * the film became UNKNOWN on every order costed on a shop where the nesting
	 * service is not configured, which is the state this ships in. Measured on
	 * thirty tees with one 28,4 × 34,1 cm chest transfer: the direct cost fell
	 * from 333,62 EUR to 163,32 EUR and the floor price from 571,92 EUR to
	 * 279,98 EUR. 291,94 EUR of floor, on one order, destroyed by pressing a
	 * save button once. Found by the adversarial pass, reproduced, then fixed.
	 *
	 * `garment_supply` is deliberately NOT here: clearing a purchase price must
	 * remove the row, and a deep merge would resurrect it.
	 */
	private const PARAMETER_MAPS = array( 'film', 'times_s', 'payment' );

	/**
	 * Merge a stored partial over the defaults.
	 *
	 * Per top-level key, except for the parameter maps above, which merge key by
	 * key so a form that owns some of their fields cannot delete the others.
	 */
	public static function merge_config( array $stored ): array {
		$config = self::default_config();
		foreach ( $stored as $key => $value ) {
			if ( ! array_key_exists( $key, $config ) ) {
				continue;
			}
			$config[ $key ] = in_array( $key, self::PARAMETER_MAPS, true ) && is_array( $value ) && is_array( $config[ $key ] )
				? array_merge( $config[ $key ], $value )
				: $value;
		}
		return $config;
	}

	// ── Components ───────────────────────────────────────────────────────────

	/**
	 * One line of the cost model.
	 *
	 * `source` and `on` are not decoration. The chapter requires a cost to carry
	 * where it came from and when it was valid, because the whole point of the
	 * engine is that a floor price can be defended six months later: "prix
	 * d'achat HT ; date de validité ; coefficient de risque en cas de prix
	 * estimé". A component with an empty source is a number somebody typed.
	 *
	 * @param string $type    one of COMPONENTS.
	 * @param int    $amount  cents HT, the PRUDENT figure when estimated.
	 * @param string $conf    one of REAL, ESTIMATED, NONE, UNKNOWN.
	 * @param string $source  where it came from, in French, for an operator.
	 * @param string $on      the date it was valid, YYYY-MM-DD, or ''.
	 * @param ?int   $best    the optimistic figure when estimated, else null.
	 *
	 * @throws \InvalidArgumentException on an unknown type or confidence.
	 */
	public static function component( string $type, int $amount, string $conf, string $source, string $on = '', ?int $best = null ): array {
		if ( ! isset( self::COMPONENTS[ $type ] ) ) {
			throw new \InvalidArgumentException( 'unknown_component:' . $type );
		}
		if ( ! in_array( $conf, array( self::REAL, self::ESTIMATED, self::NONE, self::UNKNOWN ), true ) ) {
			throw new \InvalidArgumentException( 'unknown_confidence:' . $conf );
		}
		/*
		 * An UNKNOWN component carries no amount at all. Letting a caller pass
		 * one would produce a total that both counts a figure and declares it
		 * unavailable, and whichever of the two a reader believed would be wrong
		 * half the time.
		 */
		return array(
			'type'       => $type,
			'label'      => self::COMPONENTS[ $type ],
			'amount_ht'  => self::UNKNOWN === $conf ? 0 : $amount,
			'best_ht'    => self::ESTIMATED === $conf && null !== $best ? $best : null,
			'confidence' => $conf,
			'source'     => $source,
			'on'         => $on,
		);
	}

	/**
	 * Total a set of components, and say what the total is worth.
	 *
	 * Returns:
	 *   total_ht    the prudent total, cents. UNKNOWN components add nothing.
	 *   best_ht     the same total with every estimate at its optimistic figure.
	 *   complete    false when any component is UNKNOWN or absent entirely.
	 *   estimated   true when any component is ESTIMATED.
	 *   unknown     the types we could not compute.
	 *   absent      the types nobody supplied a component for at all.
	 *   lines       the components, in the chapter's order.
	 *
	 * `complete` is the one the floor price gates on. It is deliberately NOT
	 * "estimated is fine": an estimate is a number with a stated risk, and an
	 * unknown is no number at all.
	 */
	public static function total( array $components ): array {
		$by_type = array();
		foreach ( $components as $line ) {
			if ( ! is_array( $line ) || ! isset( $line['type'] ) ) {
				continue;
			}
			$type = (string) $line['type'];
			if ( ! isset( self::COMPONENTS[ $type ] ) ) {
				continue;
			}
			/*
			 * Several lines of the same type ADD UP rather than replace: an order
			 * with two garment references has two textile costs, each with its own
			 * supplier and its own date, and flattening them would throw away the
			 * provenance that is the point of the model.
			 */
			$by_type[ $type ][] = $line;
		}

		$total     = 0;
		$best      = 0;
		$unknown   = array();
		$absent    = array();
		$estimated = false;
		$lines     = array();

		foreach ( self::COMPONENTS as $type => $label ) {
			if ( ! isset( $by_type[ $type ] ) ) {
				$absent[] = $type;
				continue;
			}
			foreach ( $by_type[ $type ] as $line ) {
				$lines[] = $line;
				if ( self::UNKNOWN === $line['confidence'] ) {
					$unknown[] = $type;
					continue;
				}
				$amount = (int) $line['amount_ht'];
				$total += $amount;
				$best  += null === $line['best_ht'] ? $amount : (int) $line['best_ht'];
				if ( self::ESTIMATED === $line['confidence'] ) {
					$estimated = true;
				}
			}
		}

		return array(
			'total_ht'  => $total,
			'best_ht'   => $best,
			'complete'  => empty( $unknown ) && empty( $absent ),
			'estimated' => $estimated,
			'unknown'   => array_values( array_unique( $unknown ) ),
			'absent'    => $absent,
			'lines'     => $lines,
		);
	}

	// ── The formulas the chapter gives ───────────────────────────────────────

	/**
	 * Labour: `temps standard × taux horaire chargé`, the chapter's own formula.
	 *
	 * $work counts the units the OPERATIONS are multiplied by:
	 *   orders     usually 1
	 *   pieces     garments
	 *   transfers  presses (one per transfer, not one per garment)
	 *
	 * Returns the seconds, the money, and the operations that have never been
	 * timed. That last list is why this returns an array rather than an int: a
	 * labour cost built from two timed operations out of seven is not a labour
	 * cost, and the caller has to be able to say so.
	 */
	public static function labour( array $work, array $config ): array {
		$hourly  = (int) ( $config['hourly_ht'] ?? 0 );
		$times   = (array) ( $config['times_s'] ?? array() );
		$counts  = array(
			'order'    => max( 0, (int) ( $work['orders'] ?? 0 ) ),
			'piece'    => max( 0, (int) ( $work['pieces'] ?? 0 ) ),
			'transfer' => max( 0, (int) ( $work['transfers'] ?? 0 ) ),
		);

		$seconds = 0;
		$untimed = array();
		$detail  = array();

		foreach ( self::OPERATIONS as $key => $op ) {
			$each  = max( 0, (int) ( $times[ $key ] ?? 0 ) );
			$count = $counts[ $op['per'] ];
			if ( 0 === $each ) {
				/*
				 * Only an operation this order actually PERFORMS counts as
				 * untimed. A run with no transfers to press is not missing a
				 * pressing time, and reporting it as missing would make every
				 * blank-only order look incomplete for ever.
				 */
				if ( $count > 0 ) {
					$untimed[] = $key;
				}
				continue;
			}
			$seconds += $each * $count;
			$detail[] = array(
				'op'      => $key,
				'label'   => $op['label'],
				'each_s'  => $each,
				'count'   => $count,
				'total_s' => $each * $count,
			);
		}

		return array(
			'seconds'   => $seconds,
			'amount_ht' => Money::round( $seconds / 3600 * $hourly ),
			'hourly_ht' => $hourly,
			'untimed'   => $untimed,
			'detail'    => $detail,
		);
	}

	/**
	 * The film, from the length the nesting engine actually measured.
	 *
	 * The chapter's formula, term for term:
	 *
	 *     Coût DTF commande = mètres linéaires nécessaires x tarif au mètre
	 *                        + livraison DTF
	 *                        + provision de perte
	 *
	 * The provision is a share of the METRES and not of the money, because what
	 * is lost is film: a misprint costs a length of roll, and it costs it at the
	 * same tariff. Applying the same 5 % to the delivery charge instead would be
	 * charging a provision on a courier.
	 *
	 * `$nested_m` is what `nestRoll` billed for this order and nothing else. It
	 * is never derived from an area here: a length inferred by dividing an area
	 * by the roll width would be a second, worse packer, and the number the
	 * supplier bills is a packing, not a quotient.
	 *
	 * @param float  $nested_m billed linear metres from the nesting engine.
	 * @param string $origin   'fr' or 'es'.
	 */
	public static function film( float $nested_m, array $config, string $origin = 'fr' ): array {
		$film = (array) ( $config['film'] ?? array() );

		if ( 'sheet' === (string) ( $film['billing'] ?? 'roll' ) ) {
			return self::film_sheets( $nested_m, $film );
		}

		$rate = (int) ( 'es' === $origin ? ( $film['rate_es_ht'] ?? 0 ) : ( $film['rate_fr_ht'] ?? 0 ) );

		$min     = (float) ( $film['min_m'] ?? 0 );
		$billed  = max( $min, max( 0.0, $nested_m ) );
		$waste_m = $billed * (float) ( $film['waste_rate'] ?? 0 );

		$metres_ht   = Money::round( $billed * $rate );
		$waste_ht    = Money::round( $waste_m * $rate );
		$delivery_ht = (int) ( $film['delivery_ht'] ?? 0 );

		/*
		 * The roll refuses on the same principle: a rate of zero is not free film,
		 * it is a tariff nobody has filled in, and a billing step of zero makes
		 * the prudent bound divide by nothing. See the sheet branch above.
		 */
		$roll_why = '';
		if ( $rate <= 0 ) {
			$roll_why = 'le tarif au mètre linéaire n’est pas renseigné pour cette origine';
		} elseif ( (float) ( $film['billing_step_cm'] ?? 0 ) <= 0 || (float) ( $film['width_cm'] ?? 0 ) <= 0 ) {
			$roll_why = 'la laize ou le pas de facturation du rouleau n’est pas renseigné';
		}

		// A REFUSAL CARRIES NO MONEY, in either branch. Leaving the delivery
		// charge on it made a refused tariff cost 15,00 EUR, which is a number a
		// caller could add up and a floor price could be built on.
		$refused = '' !== $roll_why;

		return array(
			'ok'          => ! $refused,
			'why'         => $roll_why,
			'origin'      => $origin,
			'billing'     => 'roll',
			'unit_fr'     => 'mètre linéaire',
			'rate_ht'     => $rate,
			'nested_m'    => $nested_m,
			'billed_m'    => $refused ? 0.0 : $billed,
			'billed_units' => $refused ? 0.0 : $billed,
			'waste_m'     => $refused ? 0.0 : $waste_m,
			'metres_ht'   => $refused ? 0 : $metres_ht,
			'waste_ht'    => $refused ? 0 : $waste_ht,
			'delivery_ht' => $refused ? 0 : $delivery_ht,
			'amount_ht'   => $refused ? 0 : $metres_ht + $waste_ht + $delivery_ht,
			/*
			 * True when the order was too small to reach the supplier's minimum,
			 * so the shop is paying for film it did not use. The admin panel says
			 * so, because it is the single most useful thing to know about a small
			 * order's economics: it is why two small runs pressed together cost
			 * less than the same two runs a week apart.
			 */
			'at_minimum'  => ! $refused && $nested_m < $min,
		);
	}

	/**
	 * The same bill when the supplier sells SHEETS, question 04's answer.
	 *
	 * ── WHY THE SHEET COUNT IS DERIVED AND NOT PASSED IN ─────────────────────
	 *
	 * `billing_step_cm` is the sheet height in this mode, so the packer bills
	 * every sheet whole and the length it returns is exactly `sheets x hauteur`.
	 * Deriving the count here therefore reads the same fact the packer wrote,
	 * rather than adding a second quantity that could travel out of step with
	 * the first through `Production`'s stored layouts, through `attribute()` and
	 * through the bench. One number crosses the wire; one number is invoiced.
	 *
	 * `ceil` and not `round`, with the epsilon on the safe side: a layout that
	 * arrives a hair short of a whole sheet still cost a whole sheet, and a cost
	 * rounded DOWN is a floor price rounded down, which authorises a sale.
	 *
	 * ── THE ORIGIN IS GONE, AND THAT IS THE ANSWER TALKING ───────────────────
	 *
	 * He names ONE supplier, in France. There is no second origin to be cheaper,
	 * so this branch takes no origin and `Production::origin_for` must not offer
	 * one: see `origins()` below. Charging an order at a Spanish rate that no
	 * longer exists would be the same defect as letting a tick box choose it.
	 *
	 * ── THE PROVISION IS MONEY, NOT PAPER ────────────────────────────────────
	 *
	 * The 5 % is applied to the value of the sheets and left fractional, exactly
	 * as the roll branch applies it to metres. Rounding it up to a whole sheet
	 * would charge a two-sheet order a third sheet, which is a 50 % provision on
	 * the smallest orders and a 5 % one on the largest: a provision is an
	 * expected loss carried in cents, not a sheet anybody buys.
	 */
	private static function film_sheets( float $nested_m, array $film ): array {
		$sheet_ht = (int) ( $film['sheet_ht'] ?? 0 );
		$height   = (float) ( $film['max_length_cm'] ?? 0 );
		$width    = (float) ( $film['width_cm'] ?? 0 );
		$step     = (float) ( $film['billing_step_cm'] ?? 0 );
		$min      = max( 0, (int) ( $film['min_sheets'] ?? 0 ) );

		/*
		 * ── AN INCOHERENT TARIFF REFUSES, IT DOES NOT COMPUTE ────────────────
		 *
		 * Found by the adversarial pass, and it was the worst thing in this
		 * session after the sheet being narrower than the garment.
		 *
		 * `merge_config` merges the film block PER KEY, which is deliberate: the
		 * settings screen owns eight of its fields and a whole-block replace once
		 * deleted the ninth and destroyed 291,94 EUR of floor price. The
		 * consequence here is that a film block SAVED BEFORE 1 September 2026
		 * carries `width_cm => 56` and `max_length_cm => 100` and no `billing`
		 * key at all, so it inherits `sheet` from the defaults and the engine
		 * bills 56 x 100 cm « sheets » at 3,00 EUR each. Measured: four nested
		 * metres cost 27,60 EUR instead of 86,40, a 68 % under-cost, straight
		 * into a floor price that authorises sales nobody would have signed.
		 *
		 * Three things have to hold together for a sheet count to mean anything:
		 * a sheet must have a price, it must have two dimensions, and the packer
		 * must bill whole sheets, which is `billing_step_cm == max_length_cm`.
		 * When they do not, this refuses, `Costing` marks the marking cost
		 * UNKNOWN and `Margin` withholds the floor. That is the same rule the
		 * whole cost engine runs on: a zero and a failure add up to the same
		 * total and mean opposite things.
		 */
		$why = '';
		if ( $sheet_ht <= 0 ) {
			$why = 'le prix d’une feuille n’est pas renseigné';
		} elseif ( $height <= 0 || $width <= 0 ) {
			$why = 'les dimensions de la feuille ne sont pas renseignées';
		} elseif ( abs( $step - $height ) > 0.01 ) {
			$why = 'le pas de facturation ne vaut pas la hauteur de la feuille, donc une longueur et un nombre de feuilles diraient deux choses différentes de la même facture';
		}
		if ( '' !== $why ) {
			return array(
				'ok'           => false,
				'why'          => $why,
				'origin'       => 'fr',
				'billing'      => 'sheet',
				'unit_fr'      => 'feuille',
				'rate_ht'      => $sheet_ht,
				'nested_m'     => $nested_m,
				'needed_sheets' => 0,
				'billed_sheets' => 0,
				'billed_units' => 0.0,
				'billed_m'     => 0.0,
				'waste_m'      => 0.0,
				'metres_ht'    => 0,
				'waste_ht'     => 0,
				'delivery_ht'  => 0,
				'amount_ht'    => 0,
				'at_minimum'   => false,
			);
		}

		$needed = (int) ceil( max( 0.0, $nested_m ) * 100 / $height - 1e-9 );
		$billed = max( $min, $needed );

		$sheets_ht = $billed * $sheet_ht;
		$waste_ht  = Money::round( $billed * $sheet_ht * (float) ( $film['waste_rate'] ?? 0 ) );
		$delivery_ht = (int) ( $film['delivery_ht'] ?? 0 );

		return array(
			'ok'           => true,
			'why'          => '',
			'origin'       => 'fr',
			'billing'      => 'sheet',
			'unit_fr'      => 'feuille',
			'rate_ht'      => $sheet_ht,
			'nested_m'     => $nested_m,
			'needed_sheets' => $needed,
			'billed_sheets' => $billed,
			'billed_units' => (float) $billed,
			'billed_m'     => $billed * $height / 100,
			'waste_m'      => 0.0,
			'metres_ht'    => $sheets_ht,
			'waste_ht'     => $waste_ht,
			'delivery_ht'  => $delivery_ht,
			'amount_ht'    => $sheets_ht + $waste_ht + $delivery_ht,
			'at_minimum'   => $needed < $min,
		);
	}

	/**
	 * The origins the tariff in force can actually be bought from.
	 *
	 * `Production::origin_for` prefers the cheaper origin whenever the calendar
	 * allows it, and that only means anything while two suppliers exist. Question
	 * 04's answer names one, in France, so in sheet mode this returns one origin
	 * and the schedule stops offering a choice that would be a fiction.
	 *
	 * Takes the FILM array and not the whole cost config, because that is the
	 * shape `Production` already carries around: the schedule reads `days_fr`
	 * and `days_es` out of it and never holds the rest.
	 *
	 * @param array<string,mixed> $film `$config['film']`.
	 * @return array<int,string>
	 */
	public static function origins( array $film ): array {
		return 'sheet' === (string) ( $film['billing'] ?? 'roll' ) ? array( 'fr' ) : array( 'es', 'fr' );
	}

	/**
	 * Split a POOLED film bill across the orders that shared the roll.
	 *
	 * Session 07 stopped nesting one order at a time. A run is whatever was
	 * ready to print, ganged onto the same film, and the supplier sends one
	 * invoice. Every order in it still needs to know what its own share was, or
	 * the margin report is a work of fiction and the floor price under it is a
	 * guess.
	 *
	 * ── THE RULE, AND WHY IT IS NOT THE OBVIOUS ONE ──────────────────────────
	 *
	 * Each order pays the share of the bill that its own FILM REQUIREMENT is of
	 * the total. Formally share_i = bill x metres_i / Sum(metres_j), where
	 * metres_i is what that order alone was packed into by the same packer at the
	 * same settings, allocated to whole cents so the shares add up exactly.
	 *
	 * THE WEIGHT IS METRES AND NOT EUROS, and that correction came out of the
	 * bench rather than out of a discussion. Weighting by each order's stand-alone
	 * BILL is the textbook proportional rule and it collapses here, because a
	 * stand-alone bill is dominated by two charges the pool pays once: the
	 * supplier's one-metre minimum and the delivery. Measured on the bench's week
	 * of six orders, five of them fell under the minimum, so five stand-alone
	 * bills were the identical 32,85 EUR and the rule charged an eighty-pose order
	 * and a sixteen-pose order the same 12,80 EUR. That is not an attribution, it
	 * is an average wearing one's clothes. Spreading a shared fixed cost in
	 * proportion to the usage that caused the run is the standard answer and it is
	 * the one taken here.
	 *
	 * The obvious answer is proportional to nested AREA, and it is defensible
	 * until you notice what it charges for. Area charges an order for the ink it
	 * carries; the run is bought for the film that ink FORCES. One 55 x 40 cm back
	 * print on a 56 cm roll leaves a ribbon down the side that nothing else can
	 * use; forty 6 x 6 cm chest marks fill whatever they are given. Under the area
	 * rule the second subsidises the first, and the margin report then says the
	 * awkward order was the cheap one, which is the exact fact the report exists
	 * to surface. Both numbers are computed; only the solo one is charged, and
	 * `scripts/dtf-bench.mjs` prints the gap between them on a real week.
	 *
	 * Three properties this rule has and the area rule does not:
	 *   - an order that would have cost more alone always pays more here;
	 *   - it is scale-free, so re-running a pool with the same orders in a
	 *     different sequence cannot move a single cent;
	 *   - it needs no notion of "who caused the waste", which nobody can measure
	 *     and everybody would argue about.
	 *
	 * ── POOLING CAN COST MORE, AND THIS FUNCTION SAYS SO ─────────────────────
	 *
	 * Measured, not feared: two 30 x 20 cm transfers pool into 50 cm of roll and
	 * nest apart into 20 + 20 = 40 cm, because they cannot share a row on a 58 cm
	 * laize and the pool then pays an inter-shelf gap and one rounding up
	 * (src/lib/dtf/run.test.ts holds the case). `saved` therefore goes NEGATIVE
	 * rather than being clamped, and the workshop screen refuses to send a run
	 * that is worth less than its parts. In euros that particular pool still wins
	 * by a distance, because two orders are two supplier minimums and two
	 * delivery charges, which is the whole reason the comparison is made in
	 * money and not in centimetres.
	 *
	 * @param array<string,float> $solo_m   order id => metres that order alone was billed.
	 * @param float               $pooled_m metres the run was billed.
	 * @param array<string,float> $ink_cm2  order id => ink area, for the published area rule.
	 *
	 * @return array{origin:string,total_ht:int,solo_total_ht:int,saved_ht:int,worse:bool,shares:array<string,array{solo_ht:int,share_ht:int,saved_ht:int,area_share_ht:int,solo_m:float}>}
	 */
	public static function attribute( array $solo_m, float $pooled_m, array $config, string $origin = 'fr', array $ink_cm2 = array() ): array {
		$run   = self::film( $pooled_m, $config, $origin );
		$total = (int) $run['amount_ht'];

		$solo   = array();
		$weight = array();
		foreach ( $solo_m as $id => $metres ) {
			$one                  = self::film( (float) $metres, $config, $origin );
			$solo[ (string) $id ] = (int) $one['amount_ht'];
			/*
			 * MILLIMETRES, because the allocator below is integer arithmetic and
			 * a float weight would make the largest-remainder step depend on a
			 * rounding nobody chose. The UNCLAMPED length is what is weighed:
			 * `film()` would have raised anything under the supplier's minimum to
			 * one metre, which is exactly the fixed charge this rule exists to
			 * spread rather than to inherit.
			 */
			$weight[ (string) $id ] = (int) round( max( 0.0, (float) $metres ) * 1000 );
		}

		/*
		 * A run in which no order needs any film at all is not a run, but a
		 * caller can produce one (every length zero, or a corrupt report), and
		 * dividing by that sum would hand every order a NaN share that reads on
		 * screen as a missing cost rather than as a zero. Equal weights are the
		 * only defensible answer when nothing distinguishes the orders.
		 */
		if ( 0 === array_sum( $weight ) ) {
			foreach ( $weight as $id => $_ ) {
				$weight[ $id ] = 1;
			}
		}

		$share = self::allocate( $total, $weight );
		$area  = self::allocate( $total, self::area_weights( array_keys( $solo ), $ink_cm2 ) );

		$shares = array();
		foreach ( $solo as $id => $alone ) {
			$shares[ $id ] = array(
				'solo_m'        => (float) ( $solo_m[ $id ] ?? 0.0 ),
				'solo_ht'       => $alone,
				'share_ht'      => $share[ $id ],
				'saved_ht'      => $alone - $share[ $id ],
				'area_share_ht' => $area[ $id ],
			);
		}

		$solo_total = array_sum( $solo );

		return array(
			'origin'        => $run['origin'],
			'total_ht'      => $total,
			'solo_total_ht' => $solo_total,
			'saved_ht'      => $solo_total - $total,
			// The one thing an operator must not have to work out for themselves.
			'worse'         => $total > $solo_total,
			'shares'        => $shares,
		);
	}

	/**
	 * Ink areas as integer weights, falling back to equal shares.
	 *
	 * The area rule is PUBLISHED and never charged, so an order whose ink could
	 * not be measured must not make the whole comparison disappear: it gets an
	 * equal weight and the number stays printable beside the one that is charged.
	 */
	private static function area_weights( array $ids, array $ink_cm2 ): array {
		$out = array();
		$sum = 0.0;
		foreach ( $ids as $id ) {
			$v          = (float) ( $ink_cm2[ $id ] ?? 0.0 );
			$out[ $id ] = $v > 0 && is_finite( $v ) ? (int) round( $v * 100 ) : 0;
			$sum       += $out[ $id ];
		}
		if ( $sum <= 0 ) {
			foreach ( $out as $id => $_ ) {
				$out[ $id ] = 1;
			}
		}
		return $out;
	}

	/**
	 * Split `$amount` cents by `$weights`, largest remainder, total preserved.
	 *
	 * THE POINT IS THE LAST LINE OF THE FUNCTION. Rounding each share on its own
	 * loses or invents cents: three equal shares of 100 cents rounded
	 * independently make 99 or 102, and a supplier invoice of 145,00 EUR would
	 * then reconcile against 144,99 EUR of order costs forever. The remainders
	 * are ranked instead, and the leftover cents are handed out one at a time.
	 *
	 * Ties are broken by order id, numerically where both ids are numbers, so
	 * two runs of the same pool cannot allocate the same cent differently. That
	 * ordering is the same one `compareOrderIds` uses in src/lib/dtf/run.ts, for
	 * the same reason.
	 *
	 * PUBLIC SINCE SESSION 08, and for the reason the rule exists at all. The
	 * blanks of several orders are bought in one supplier order, so their
	 * inbound freight is one charge to be split exactly as the film's is. A
	 * second largest-remainder allocator beside this one would be a second
	 * answer to « qui paie ce centime », and the two would disagree on the day
	 * a supplier invoice had to reconcile against the sum of the orders.
	 *
	 * @param array<string,int> $weights
	 * @return array<string,int>
	 */
	public static function allocate( int $amount, array $weights ): array {
		$total = 0;
		foreach ( $weights as $w ) {
			$total += max( 0, (int) $w );
		}
		$out = array();
		if ( $total <= 0 || array() === $weights ) {
			foreach ( $weights as $id => $_ ) {
				$out[ $id ] = 0;
			}
			return $out;
		}

		$rest = array();
		$sum  = 0;
		foreach ( $weights as $id => $w ) {
			$exact       = $amount * max( 0, (int) $w );
			$out[ $id ]  = intdiv( $exact, $total );
			$rest[ $id ] = $exact % $total;
			$sum        += $out[ $id ];
		}

		$ids = array_keys( $weights );
		usort(
			$ids,
			static function ( $a, $b ) use ( $rest ) {
				if ( $rest[ $a ] !== $rest[ $b ] ) {
					return $rest[ $b ] <=> $rest[ $a ];
				}
				if ( is_numeric( $a ) && is_numeric( $b ) && (float) $a !== (float) $b ) {
					return (float) $a <=> (float) $b;
				}
				return strcmp( (string) $a, (string) $b );
			}
		);

		$left = $amount - $sum;
		for ( $i = 0; $left > 0 && $i < count( $ids ); $i++, $left-- ) {
			++$out[ $ids[ $i ] ];
		}
		return $out;
	}

	/**
	 * The longest the packer can possibly make this set of pieces, cm billed.
	 *
	 * THIS IS NOT A NESTING. It is the length a nesting is guaranteed not to
	 * exceed, and it exists for one case: `src/lib/dtf/nesting.ts` could not be
	 * reached, so the choice is between no cost at all and a cost that is
	 * certainly not too low.
	 *
	 * ── WHY IT IS A BOUND, term by term ──────────────────────────────────────
	 *
	 * The packer lays pieces in shelves and a shelf is as tall as its tallest
	 * member. For a run of identical pieces it picks the orientation with the
	 * smaller total, so its cost per run never exceeds the cost of giving every
	 * copy its own shelf in the FLATTER orientation. That flatter orientation is
	 * available only when the piece's long side fits across the roll; a 5 × 60 cm
	 * banner on a 56 cm roll has to stand up, and then the row it costs is 60 cm,
	 * not 5. Getting that backwards is what an earlier version of this function
	 * did, and it under-bounded that banner elevenfold.
	 *
	 * Then two roundings the packer applies and a bound must apply too: each
	 * sheet's length is rounded UP to the billing step, and a long order is split
	 * across sheets. Σ⌈xₛ⌉ ≤ ⌈Σxₛ⌉ + (N−1), so one rounding of the whole plus one
	 * step per extra sheet covers it. The sheet count is bounded by the packer's
	 * own rule for closing a sheet: it only opens a new one when the next shelf
	 * would overflow, so every sheet but the last is full to within one shelf.
	 *
	 * `scripts/nest-verify.mjs` re-proves the whole thing on every run, in both
	 * languages, against the real packer over a corpus of real orders. It is what
	 * found the missing rounding.
	 *
	 * ── IT CAN REFUSE ────────────────────────────────────────────────────────
	 *
	 * A transfer whose SHORTER side is wider than the roll fits on no sheet in
	 * any orientation. The packer reports it as unplaceable and so does this: an
	 * order containing one has no bound and no cost, because it also has no way
	 * of being printed.
	 *
	 * A caller that uses this MUST mark the resulting component ESTIMATED. It
	 * overstates a real order badly (measured on scripts/nest-verify.mjs's own
	 * corpus: 0 % on a single piece both roundings land on, and up to +850 % on a
	 * sheet of small transfers that interlock), so it is a stopgap for a broken
	 * link and never a substitute for asking.
	 *
	 * @return array{ok:bool,length_cm:float,impossible:array<int,string>}
	 */
	/**
	 * Whether ONE transfer can be printed at all, in either orientation.
	 *
	 * ── WHY THIS IS A FUNCTION AND NOT THREE COMPARISONS ─────────────────────
	 *
	 * It was three comparisons, inside `prudent_length_cm`, and that was fine
	 * while the film was a 56 cm roll cut at 100 cm: nothing a garment can carry
	 * came close. Question 04's answer put the shop on a 33 x 46 cm sheet, and
	 * the published print zones did not move with it. Measured on
	 * `data/garments.json` on 1 September 2026, against a 33 x 46 sheet:
	 *
	 *   tee front and back      S, M, L fit · XL, 2XL, 3XL DO NOT
	 *   hoodie front and back   S, M, L fit · XL, 2XL, 3XL DO NOT
	 *   both sleeves            every size fits
	 *
	 * A full front at 3XL is 37,5 x 50 cm and no A3+ sheet holds it either way
	 * up. Half the size range of the two garments this shop sells, and the cost
	 * engine could not see it, because it measures every line at the PRICED size
	 * (M) whatever sizes were ordered. That is question 37, and it stopped being
	 * a question about the price the moment the sheet became narrower than the
	 * garment.
	 *
	 * So the rule has one home and two callers: the bound below, which withholds
	 * a floor price, and `Cart::add`, which refuses the sale. The second is the
	 * one that matters: an order taken for a print the workshop cannot press is
	 * money in and a customer to disappoint.
	 */
	public static function fits_sheet( float $w_cm, float $h_cm, array $config ): bool {
		$film  = (array) ( $config['film'] ?? array() );
		$width = (float) ( $film['width_cm'] ?? 0 );
		$max   = (float) ( $film['max_length_cm'] ?? 0 );
		if ( $width <= 0 || $max <= 0 || ! is_finite( $w_cm ) || ! is_finite( $h_cm ) || $w_cm <= 0 || $h_cm <= 0 ) {
			return false;
		}
		$short = min( $w_cm, $h_cm );
		$long  = max( $w_cm, $h_cm );
		// Upright on the sheet, or lying across it. Nothing else is a placement.
		return ( $long <= $max && $short <= $width ) || ( $long <= $width && $short <= $max );
	}

	/**
	 * The transfers of a set that fit no sheet, by id.
	 *
	 * Empty means every one of them can be printed. It does NOT mean the set can
	 * be printed cheaply, or that it has been nested: that is the packer's
	 * answer and this is only the question of whether each piece exists on a
	 * sheet at all.
	 *
	 * @param array<int,array{id?:string,w_cm?:float,h_cm?:float,qty?:int}> $pieces
	 * @return array<int,string>
	 */
	public static function unplaceable( array $pieces, array $config ): array {
		$out = array();
		foreach ( $pieces as $piece ) {
			$qty = (int) ( $piece['qty'] ?? 1 );
			if ( $qty <= 0 ) {
				continue;
			}
			$w = (float) ( $piece['w_cm'] ?? 0 );
			$h = (float) ( $piece['h_cm'] ?? 0 );
			if ( ! self::fits_sheet( $w, $h, $config ) ) {
				$out[] = (string) ( $piece['id'] ?? '?' );
			}
		}
		return $out;
	}

	public static function prudent_length_cm( array $pieces, array $config ): array {
		$film  = (array) ( $config['film'] ?? array() );
		$gap   = (float) ( $film['gap_cm'] ?? 0 );
		$width = (float) ( $film['width_cm'] ?? 0 );
		$step  = (float) ( $film['billing_step_cm'] ?? 0 );
		$max   = (float) ( $film['max_length_cm'] ?? 0 );

		$refuse = static function ( array $impossible ): array {
			return array(
				'ok'         => false,
				'length_cm'  => 0.0,
				'impossible' => $impossible,
			);
		};

		if ( $width <= 0 || $step <= 0 || $max <= 0 ) {
			return $refuse( array() );
		}

		$raw        = 0.0;
		$tallest    = 0.0;
		$count      = 0;
		$impossible = array();

		foreach ( $pieces as $piece ) {
			$w   = (float) ( $piece['w_cm'] ?? 0 );
			$h   = (float) ( $piece['h_cm'] ?? 0 );
			$qty = (int) ( $piece['qty'] ?? 0 );
			$id  = (string) ( $piece['id'] ?? '?' );
			if ( ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0 || $qty <= 0 ) {
				continue;
			}

			$short = min( $w, $h );
			$long  = max( $w, $h );

			// ONE FIT RULE, and it is `fits_sheet()`. It was written out here and
			// nowhere else, which was survivable while nothing a garment carries
			// came near a 56 cm roll; on a 33 cm sheet the same question has to
			// be askable from the cart, before the money.
			if ( ! self::fits_sheet( $w, $h, $config ) ) {
				$impossible[] = $id;
				continue;
			}

			// Lying flat is only allowed when the long side fits the laize.
			$row = $long <= $width ? $short : $long;

			$raw    += $qty * ( $row + $gap );
			$tallest = max( $tallest, $row );
			$count  += $qty;
		}

		if ( array() !== $impossible ) {
			return $refuse( $impossible );
		}
		if ( $raw <= 0 ) {
			return $refuse( array() );
		}

		/*
		 * The packer only opens a new sheet when the next shelf would overflow,
		 * so every sheet but the last carries more than `room` of artwork. Hence
		 * (N − 1) × room < raw, hence N ≤ ⌈raw / room⌉ for any positive raw.
		 *
		 * `room` IS NOT CLAMPED TO THE BILLING STEP, and it was: clamping it UP
		 * made the divisor larger than the real per-sheet minimum, so the sheet
		 * count came out too low and the bound with it. It only bites when the
		 * file limit is close to the tallest transfer, which is a setting an
		 * operator can type. When there is no room at all, every piece needs its
		 * own sheet, which is what the fallback counts.
		 */
		$room   = $max - $tallest - $gap;
		/*
		 * TWO BOUNDS, AND THE SMALLER OF THE TWO IS STILL A BOUND.
		 *
		 * `ceil(raw / room)` is the one derived above. The other is simply that
		 * every sheet carries AT LEAST ONE row, so there are never more sheets
		 * than rows. Both hold, so their minimum holds.
		 *
		 * The second was missing and it did not matter while a print file was
		 * 100 cm long: room was wide and the first bound was the tight one. On a
		 * 46 cm sheet a 38 cm back print leaves 7,5 cm of room, and four such
		 * transfers came out as TWENTY-ONE sheets instead of four, which is
		 * 63,00 EUR of film on a 12,00 EUR order. Prudent, in the sense that it
		 * only ever refuses a sale that was fine: the floor price it produces is
		 * five times the truth.
		 */
		$sheets = $room > 0 ? max( 1, min( $count, (int) ceil( $raw / $room ) ) ) : max( 1, $count );

		/*
		 * IN SHEET MODE THE BOUND IS THE SHEET COUNT, WHOLE.
		 *
		 * The roll formula below adds one billing step per extra sheet on top of
		 * the rounded rows, because a roll bills a continuous length with a
		 * rounding at each cut. A sheet supplier bills sheets: N sheets cost N
		 * sheets whatever is on them, so the honest bound is N x the sheet
		 * height, and `film()` divides it back to exactly N.
		 *
		 * Keeping the roll formula here with the step equal to the sheet height
		 * would have counted the rows once as a strip AND once as sheets, roughly
		 * doubling the bound. Prudent, but a bound twice the truth is a floor
		 * price twice the truth, and that refuses sales rather than authorising
		 * them: safe in direction and useless in practice.
		 */
		if ( 'sheet' === (string) ( $film['billing'] ?? 'roll' ) ) {
			return array(
				'ok'         => true,
				'length_cm'  => $sheets * $max,
				'impossible' => array(),
			);
		}

		return array(
			'ok'         => true,
			'length_cm'  => ceil( $raw / $step ) * $step + ( $sheets - 1 ) * $step,
			'impossible' => array(),
		);
	}

	/**
	 * Card processing on the amount actually taken.
	 *
	 * TTC in, because that is what the processor bills on. The result is a direct
	 * cost of the order and therefore HT for our purposes: payment fees carry
	 * their own VAT treatment, which is exemption, so the fee we pay IS the fee
	 * that enters the cost.
	 */
	public static function payment_fee( int $paid_ttc, array $config ): int {
		$p = (array) ( $config['payment'] ?? array() );
		if ( $paid_ttc <= 0 ) {
			return 0;
		}
		return Money::pct( $paid_ttc, (float) ( $p['rate'] ?? 0 ) ) + (int) ( $p['fixed_ht'] ?? 0 );
	}

	/**
	 * Inbound freight from the textile supplier: a flat charge under a threshold.
	 *
	 * 0 disables the charge and 0 as the threshold means "always free", the same
	 * convention every other threshold in this plugin uses, so clearing a field
	 * never turns a cost on by accident.
	 */
	public static function freight( int $supplier_order_ht, array $config ): int {
		$free_from = (int) ( $config['freight_free_from_ht'] ?? 0 );
		if ( $free_from > 0 && $supplier_order_ht >= $free_from ) {
			return 0;
		}
		return (int) ( $config['freight_ht'] ?? 0 );
	}

	/**
	 * A supplier catalogue price turned into a purchase price, both scenarios.
	 *
	 * The chapter's rule, and the reason the prudent figure is the one that
	 * drives the floor: until the real tariff arrives, the number we can defend
	 * is the one that assumes the worse discount.
	 *
	 * @return array{prudent:int,optimistic:int}
	 */
	public static function from_catalogue( int $catalogue_ht, array $config ): array {
		$prudent    = (float) ( $config['catalogue_divisor_prudent'] ?? 1 );
		$optimistic = (float) ( $config['catalogue_divisor_optimistic'] ?? 1 );
		return array(
			'prudent'    => $prudent > 0 ? Money::round( $catalogue_ht / $prudent ) : $catalogue_ht,
			'optimistic' => $optimistic > 0 ? Money::round( $catalogue_ht / $optimistic ) : $catalogue_ht,
		);
	}
}
