<?php
/**
 * Cost, floor price and commission.
 *
 * This is the Bible's chapter 1 ("Moteur de prix et commissions") made
 * executable, with one formula corrected, because as written it loses money on
 * every negotiation, and two more things it says that cannot be executed as
 * written at all. All three are held open against the published version in
 * tests/test-margin.php, and all three are questions in QUESTIONS-ASSOCIE.md.
 *
 * ── The correction ────────────────────────────────────────────────────────────
 *
 * The Bible defines commission on the CONTRIBUTIVE MARGIN, and its own worked
 * example agrees: 625 € sold − 250 € cost = 375 € margin, commission 40 % = 150 €.
 * Good. But the floor price is then given as
 *
 *     Prix plancher HT = (C_total + contribution minimale) / (1 − taux commission)
 *
 * which grosses the COST up by the commission rate as well as the target
 * contribution. The salesperson is not paid a commission on the cost, so the
 * cost must not be grossed up. Solving the actual constraint:
 *
 *     margin      M = P − C
 *     commission    = c · M
 *     what we keep  = M · (1 − c)     ≥ K
 *  ⇒               M ≥ K / (1 − c)
 *  ⇒               P ≥ C + K / (1 − c)
 *
 * With C = 250 €, K = 100 €, c = 40 % the Bible's formula gives a floor of
 * 583,33 € where the true floor is 416,67 €: the floor sits 167 € too high, so
 * the shop refuses deals it would have made 100 € on. It errs in the safe
 * direction, but it is still wrong, and on a competitive quote "safe" means
 * "lost to Mistertee".
 *
 * The recommended-price formula is left as written: C / (1 − target margin rate)
 * is the standard margin-on-selling-price form and it is correct.
 *
 * ── The second finding: the formula is right and its NAME is wrong ────────────
 *
 * The Bible calls that rate the "taux de marge". In French commercial usage
 * those two words mean a different ratio:
 *
 *     taux de marge   = marge ÷ coût d'achat        (a mark-up ON the cost)
 *     taux de marque  = marge ÷ prix de vente HT    (a margin ON the price)
 *
 * `C / (1 − t)` is the taux de MARQUE form, and the chapter's own worked example
 * confirms it: 625 = 250 / (1 − 0,60). So the arithmetic is right and the label
 * on it is the other ratio's name.
 *
 * That is not pedantry, it is the largest single number in this file. Question
 * 06 asked the associate for "un taux de marge" and he answered, on 1 September
 * 2026, « un objectif de marge brute minimale d'environ 50 % après coûts
 * directs ». Read as the words normally mean, a 250 EUR cost sells at 375,00
 * EUR; read as the formula intends, at 500,00 EUR. A 125,00 EUR gap on one
 * order, a third of the smaller price, decided by which of two French phrases
 * somebody had in mind. His own wording, « marge brute après coûts directs »,
 * is the formula's reading and that is the one in force. `mark_up_price()` below
 * implements the OTHER one, not because we believe it, but so the admin screen
 * can show both figures side by side and make the question impossible to answer
 * ambiguously.
 *
 * ── The third finding: "contribution minimale" is not the same kind of number
 *    in the Bible as it is in the answer we are building on ──────────────────
 *
 * The published floor takes an ABSOLUTE minimum contribution. Question 06's
 * written default, which is what sessions 04 to 13 are built on, gives a RATE:
 * "contribution minimale 25 % du prix hors taxes". A rate makes the constraint
 * recursive, because the thing being protected is a share of the answer:
 *
 *     keep  = (P − C)(1 − c) ≥ k · P
 *  ⇒  P (1 − c − k) ≥ C (1 − c)
 *  ⇒  P ≥ C / (1 − k / (1 − c))
 *
 * and it has NO SOLUTION when k ≥ 1 − c: a shop cannot keep a quarter of the
 * price after paying away four fifths of the margin, whatever it charges. The
 * absolute form always has one. Both are implemented, both are tested, and
 * `floor_price_rate()` refuses the impossible case instead of returning a
 * negative price, which is what the naive division does.
 *
 * At the shipped figures (C = 250 EUR, k = 25 %, c = 40 %) the rate form floors
 * at 428,57 EUR, against 416,67 EUR for the corrected absolute form at
 * K = 100 EUR and 583,33 EUR for the published one.
 *
 * Pure: no WordPress. Tested in tests/test-margin.php.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Money.php';

final class Margin {

	/**
	 * Total direct cost of a run, in cents HT.
	 *
	 * Every component is a real invoice line, which is the point: the Bible is
	 * explicit that a cost must never be a per-logo guess. Unknown components
	 * are passed as 0 by the caller and reported in `missing`, so a quote built
	 * on half a cost model says so instead of looking complete.
	 *
	 * $costs keys, all cents HT for the WHOLE run:
	 *   blanks     garments bought from the supplier
	 *   film       DTF film actually billed (linear metres × €/lm)
	 *   labour     pressing time, at the workshop's hourly rate
	 *   packaging
	 *   shipping   inbound + outbound
	 *   other
	 */
	public static function cost( array $costs ): array {
		$components = array( 'blanks', 'film', 'labour', 'packaging', 'shipping', 'other' );

		$total   = 0;
		$missing = array();
		foreach ( $components as $key ) {
			$value = (int) ( $costs[ $key ] ?? 0 );
			$total += $value;
			if ( ! array_key_exists( $key, $costs ) ) {
				$missing[] = $key;
			}
		}

		return array(
			'total_ht' => $total,
			'missing'  => $missing,
		);
	}

	/**
	 * Recommended selling price for a target margin RATE (margin ÷ price).
	 *
	 * A rate of 1.0 or more has no solution (you cannot keep 100 % of a price
	 * that has to cover a cost), so it is refused rather than returned as a
	 * division by zero.
	 *
	 * @throws \InvalidArgumentException when the target rate is not in [0, 1).
	 */
	public static function recommended_price( int $cost_ht, float $target_margin_rate ): int {
		if ( $target_margin_rate < 0 || $target_margin_rate >= 1 ) {
			throw new \InvalidArgumentException( 'target_margin_rate must be in [0, 1)' );
		}
		return Money::round( $cost_ht / ( 1 - $target_margin_rate ) );
	}

	/**
	 * Floor price: the lowest price that still leaves `min_contribution_ht`
	 * AFTER the salesperson's commission.
	 *
	 * See the correction at the top of this file. Selling at exactly this price
	 * leaves the shop exactly its minimum contribution and not a cent more.
	 *
	 * @throws \InvalidArgumentException when the commission rate is not in [0, 1).
	 */
	public static function floor_price( int $cost_ht, int $min_contribution_ht, float $commission_rate ): int {
		if ( $commission_rate < 0 || $commission_rate >= 1 ) {
			throw new \InvalidArgumentException( 'commission_rate must be in [0, 1)' );
		}
		return $cost_ht + Money::round( $min_contribution_ht / ( 1 - $commission_rate ) );
	}

	/**
	 * The OTHER reading of "taux de marge": a mark-up applied to the cost.
	 *
	 * `C × (1 + t)`. This is not the formula the Bible publishes and it is not
	 * what this shop prices on; it exists so the admin screen can print both
	 * answers to question 06 next to each other. See the second finding in the
	 * header for why a screen that showed only one of them would be inviting an
	 * answer nobody could interpret.
	 *
	 * @throws \InvalidArgumentException on a negative rate.
	 */
	public static function mark_up_price( int $cost_ht, float $mark_up_rate ): int {
		if ( $mark_up_rate < 0 ) {
			throw new \InvalidArgumentException( 'mark_up_rate must not be negative' );
		}
		return $cost_ht + Money::pct( $cost_ht, $mark_up_rate );
	}

	/**
	 * Floor price when the minimum contribution is a SHARE of the price rather
	 * than a fixed amount.
	 *
	 * See the third finding in the header for the derivation. The guard is the
	 * whole value of the function: `k / (1 − c) ≥ 1` has no solution, and the
	 * unguarded division returns a negative price, which compares as "below the
	 * floor is false" for every price on earth.
	 *
	 * @throws \InvalidArgumentException when either rate is out of range, or
	 *                                   when the two together are impossible.
	 */
	public static function floor_price_rate( int $cost_ht, float $min_contribution_rate, float $commission_rate ): int {
		if ( $commission_rate < 0 || $commission_rate >= 1 ) {
			throw new \InvalidArgumentException( 'commission_rate must be in [0, 1)' );
		}
		if ( $min_contribution_rate < 0 || $min_contribution_rate >= 1 ) {
			throw new \InvalidArgumentException( 'min_contribution_rate must be in [0, 1)' );
		}
		$share = $min_contribution_rate / ( 1 - $commission_rate );
		if ( $share >= 1 ) {
			throw new \InvalidArgumentException( 'impossible_floor: min_contribution_rate must be below 1 − commission_rate' );
		}
		return Money::round( $cost_ht / ( 1 - $share ) );
	}

	/**
	 * The four numbers the Bible says a salesperson must see, from one cost.
	 *
	 * "Il doit voir quatre informations : prix conseillé, remise disponible,
	 * prix plancher et commission en temps réel."
	 *
	 * `recommended_ht` is the MAXIMUM of the target-margin price and the floor,
	 * which is the chapter's own rule ("le prix final conseillé doit être le
	 * maximum entre le prix économique nécessaire et la stratégie commerciale
	 * retenue").
	 *
	 * SINCE 5 SEPTEMBER 2026 THE FLOOR CONTAINS THE TARGET, because the
	 * associate's own words make his 50 % a MINIMUM and not only an objective
	 * (see the block in `plan()`). So `recommended_ht === floor_ht` whenever the
	 * gross-margin arm binds, which is every commission rate this shop uses, and
	 * `raised_to_floor` is then false because the two are equal rather than in
	 * conflict. It still fires the day the contribution arm takes over, which is
	 * what it was written to surface: two settings that contradict each other
	 * and somebody should look.
	 *
	 * $rules:
	 *   target_margin_rate     margin ÷ price, the taux de marque. Required.
	 *   min_margin_rate        the gross margin the shop refuses to go under,
	 *                          margin ÷ price. Question 06's answer of
	 *                          1 September 2026. Absent or 0 means no such floor.
	 *   commission_rate        share of the contributive margin. Required.
	 *   min_contribution_ht    absolute minimum kept, cents. Wins when present.
	 *   min_contribution_rate  share of the price kept. Used when the above is null.
	 *   max_discount_rate      how far below the recommended price a salesperson
	 *                          may go with nobody's approval (question 06: 15 %).
	 */
	public static function plan( int $direct_ht, array $rules ): array {
		$target     = (float) ( $rules['target_margin_rate'] ?? 0 );
		$commission = (float) ( $rules['commission_rate'] ?? 0 );
		$max_disc   = (float) ( $rules['max_discount_rate'] ?? 0 );
		$abs        = $rules['min_contribution_ht'] ?? null;

		if ( null !== $abs ) {
			$contribution = self::floor_price( $direct_ht, (int) $abs, $commission );
			$basis        = 'absolute';
		} else {
			$contribution = self::floor_price_rate( $direct_ht, (float) ( $rules['min_contribution_rate'] ?? 0 ), $commission );
			$basis        = 'rate';
		}

		$by_target = self::recommended_price( $direct_ht, $target );

		/*
		 * ── LE PLANCHER EST SA MARGE BRUTE MINIMALE, QUAND ELLE EST DONNÉE ───
		 *
		 * Sa réponse à la question 06, le 1er septembre 2026 : « Nous retenons
		 * comme base un objectif de marge brute MINIMALE d'environ 50 % après
		 * coûts directs », et deux lignes plus bas « Seul le dirigeant peut
		 * autoriser exceptionnellement une vente sous le prix plancher ». Les
		 * deux phrases parlent du même seuil : ce qu'il appelle minimal est ce
		 * que ce fichier appelle plancher.
		 *
		 * Jusqu'au 5 septembre 2026 ce 50 % n'était lu QUE comme la cible, et le
		 * plancher restait notre contribution minimale de 25 % après commission
		 * (H-Q06-CONTRIBUTION-MINIMALE, notre hypothèse par défaut, jamais
		 * confirmée). Le plancher valait donc la moitié de ce qu'il a demandé, et
		 * le tarif publié en héritait : mesuré sur les 111 colonnes de la grille,
		 * la marge brute allait de 26,1 % à 41,1 %, médiane 32 %.
		 *
		 * ── C'EST UNE RÈGLE À PART, ET PAS LA CIBLE RENOMMÉE ─────────────────
		 *
		 * `min_margin_rate` est distinct de `target_margin_rate` parce que ce
		 * sont deux nombres différents : le premier est le minimum sous lequel on
		 * ne descend pas, le second est le prix qu'on affiche et depuis lequel un
		 * commercial négocie. L'associé a donné le premier et pas le second.
		 * Les confondre a une conséquence visible et voulue : quand ils sont
		 * égaux, le conseillé tombe sur le plancher, `zone_ht` vaut zéro et
		 * `binding` dit « plancher », c'est-à-dire qu'il n'y a rien à négocier.
		 * Ce n'est pas un bug, c'est ce que deux nombres égaux veulent dire, et
		 * c'est visible sur l'écran des marges plutôt que caché.
		 *
		 * Absent (zéro), cette contrainte ne s'applique pas et le plancher reste
		 * la contribution seule : c'est la forme d'avant, et les périmètres de
		 * `PriceRule` qui ne posent qu'une contribution la gardent.
		 *
		 * LES DEUX CONTRAINTES SONT GARDÉES, et le plancher est leur maximum.
		 * Elles ne mesurent pas la même chose : la sienne est une marge brute sur
		 * le prix, la nôtre est ce qui RESTE après la commission du commercial.
		 * La sienne domine à tous les taux que la boutique pratique (0, 12, 25 et
		 * 40 %, question 29) : la nôtre ne reprend la main qu'au-delà de 50 % de
		 * commission, parce que 1 - 0,25/(1-c) < 0,5 exige c > 0,5. Supprimer la
		 * nôtre serait donc sans effet aujourd'hui et faux le jour où un taux
		 * monte.
		 */
		$min_margin = (float) ( $rules['min_margin_rate'] ?? 0 );
		$by_margin  = $min_margin > 0 ? self::recommended_price( $direct_ht, $min_margin ) : 0;
		$floor      = max( $contribution, $by_margin );
		if ( $by_margin > $contribution ) {
			$basis = 'marge_brute';
		}

		$recommended = max( $by_target, $floor );

		/*
		 * The discount cap is a share of the RECOMMENDED price, not of the price
		 * the salesperson is proposing. Read the other way ("15 % off whatever we
		 * end up at") the cap is satisfied by every price, because every price is
		 * within 15 % of itself.
		 */
		$after_cap = $recommended - Money::pct( $recommended, $max_disc );

		return array(
			'direct_ht'          => $direct_ht,
			'by_target_ht'       => $by_target,
			'recommended_ht'     => $recommended,
			'raised_to_floor'    => $recommended > $by_target,
			'floor_ht'           => $floor,
			'floor_basis'        => $basis,
			'commission_rate'    => $commission,
			'max_discount_rate'  => $max_disc,
			/*
			 * The lowest price nobody has to authorise: the discount cap and the
			 * floor, whichever bites first. Which one it is is worth naming,
			 * because they are two different conversations: one is "ask the
			 * associate", the other is "this sale destroys value".
			 */
			'free_from_ht'       => max( $floor, $after_cap ),
			'binding'            => $after_cap >= $floor ? 'remise' : 'plancher',
			'zone_ht'            => max( 0, $recommended - $floor ),
		);
	}

	/**
	 * What a proposed price actually is, against a plan.
	 *
	 * Three verdicts, and they are three different authorisations:
	 *   ok               sell it.
	 *   needs_approval   past the discount cap, still above the floor. Question
	 *                    06's default says that needs the associate's yes.
	 *   below_floor      an exception under the chapter's own rule, with a
	 *                    motive, an approver, a validity window and a displayed
	 *                    impact. See Derogation.php.
	 */
	public static function verdict( int $price_ht, array $plan ): array {
		$out = self::outcome( $price_ht, (int) $plan['direct_ht'], (float) $plan['commission_rate'], (int) $plan['floor_ht'] );

		$recommended   = (int) $plan['recommended_ht'];
		$discount      = $recommended - $price_ht;
		$below_floor   = $price_ht < (int) $plan['floor_ht'];
		$past_cap      = $price_ht < (int) $plan['free_from_ht'];

		return $out + array(
			'recommended_ht'  => $recommended,
			'discount_ht'     => max( 0, $discount ),
			'discount_rate'   => $recommended > 0 ? max( 0, $discount ) / $recommended : 0.0,
			'below_floor'     => $below_floor,
			'needs_approval'  => $past_cap && ! $below_floor,
			'ok'              => ! $past_cap,
		);
	}

	/**
	 * What a given selling price actually produces.
	 *
	 * This is the four-number panel the Bible asks the salesperson to see, and
	 * the reason it exists is the alignment it creates: `commission` falls faster
	 * than `price` does, so discounting costs the salesperson more than it costs
	 * the shop.
	 *
	 * A price below cost yields a negative margin and a zero commission (you do
	 * not pay someone a share of a loss), and `below_floor` is set so the UI can
	 * demand an exception rather than quietly booking it.
	 */
	public static function outcome( int $price_ht, int $cost_ht, float $commission_rate, int $floor_ht ): array {
		$margin     = $price_ht - $cost_ht;
		$commission = $margin > 0 ? Money::pct( $margin, $commission_rate ) : 0;

		return array(
			'price_ht'     => $price_ht,
			'cost_ht'      => $cost_ht,
			'margin_ht'    => $margin,
			'margin_rate'  => $price_ht > 0 ? $margin / $price_ht : 0.0,
			'commission'   => $commission,
			'teeshoop_ht'  => $margin - $commission,
			'below_floor'  => $price_ht < $floor_ht,
			'below_cost'   => $price_ht < $cost_ht,
		);
	}
}
