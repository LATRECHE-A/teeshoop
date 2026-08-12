<?php
/**
 * Cost, floor price and commission.
 *
 * This is the Bible's chapter 1 ("Moteur de prix et commissions") made
 * executable — with one formula corrected, because as written it loses money on
 * every negotiation.
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
 * 583,33 € where the true floor is 416,67 € — the floor sits 167 € too high, so
 * the shop refuses deals it would have made 100 € on. It errs in the safe
 * direction, but it is still wrong, and on a competitive quote "safe" means
 * "lost to Mistertee".
 *
 * The recommended-price formula is left as written: C / (1 − target margin rate)
 * is the standard margin-on-selling-price form and it is correct.
 *
 * Pure — no WordPress. Tested in tests/test-margin.php.
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
	 * A rate of 1.0 or more has no solution — you cannot keep 100 % of a price
	 * that has to cover a cost — so it is refused rather than returned as a
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
	 * What a given selling price actually produces.
	 *
	 * This is the four-number panel the Bible asks the salesperson to see, and
	 * the reason it exists is the alignment it creates: `commission` falls faster
	 * than `price` does, so discounting costs the salesperson more than it costs
	 * the shop.
	 *
	 * A price below cost yields a negative margin and a zero commission — you do
	 * not pay someone a share of a loss — and `below_floor` is set so the UI can
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
