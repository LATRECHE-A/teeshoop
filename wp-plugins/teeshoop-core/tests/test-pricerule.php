<?php
/**
 * The scoped floor: which rule applies, and what it is allowed to change.
 *
 * A price rule is the only thing in this engine that can LOWER a floor, so most
 * of what is asserted here is about the ways it must not: a blank rate is not a
 * zero, a tie is settled towards the stricter rule, an unknown fact matches no
 * rule that selects on it, and a rule never touches the commission.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/* COMMAND LINE ONLY. See run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/PriceRule.php';
require_once __DIR__ . '/../includes/Margin.php';

use Teeshoop\Core\Margin;
use Teeshoop\Core\PriceRule;

/**
 * A rule with everything blank, so a test only says what it means to say.
 *
 * It DOES set a contribution by default, because a rule that sets no rate now
 * decides nothing and is skipped: a fixture without one would test the skip
 * instead of the thing under test. `ts_rule_without_rates()` is the one that
 * asks for the other case.
 */
function ts_rule( array $over = array() ): array {
	return PriceRule::normalise(
		$over + array(
			'id'                    => 'r-' . substr( md5( wp_json_encode_stub( $over ) ), 0, 6 ),
			'label'                 => 'règle',
			'active'                => true,
			'min_contribution_rate' => '25',
		)
	);
}

/** A rule that names a scope and decides nothing. */
function ts_rule_without_rates( array $over = array() ): array {
	return PriceRule::normalise(
		$over + array(
			'id'     => 'r-none',
			'label'  => 'sans taux',
			'active' => true,
		)
	);
}

function wp_json_encode_stub( mixed $v ): string {
	return (string) json_encode( $v );
}

/** The facts of an ordinary order. */
function ts_facts( array $over = array() ): array {
	return $over + array(
		'famille'    => 'tee',
		'technique'  => 'dtf',
		'commercial' => 'Karim B.',
		'client'     => 'pro',
		'urgence'    => 'standard',
		'quantite'   => 30,
	);
}

const TS_TODAY = '2026-09-30';

/** The shop's global rates, as `Costing::rules()` builds them. */
function ts_base( float $commission = 0.40 ): array {
	return array(
		'target_margin_rate'    => 0.55,
		'min_contribution_rate' => 0.25,
		'commission_rate'       => $commission,
		'max_discount_rate'     => 0.15,
	);
}

describe( 'PriceRule: reading a rule off a form', function () {
	it( 'drops a row that names nothing and sets nothing', function () {
		eq( PriceRule::normalise( array() ), null );
		eq( PriceRule::normalise( array( 'label' => '   ' ) ), null );
		eq( PriceRule::normalise( array( 'label' => 'un nom et rien d’autre', 'active' => true ) ), null, 'a name is not a criterion and not a rate' );
		eq( PriceRule::normalise( 'not a rule' ), null );
	} );

	it( 'keeps a blank rate as NULL and never as zero', function () {
		$rule = ts_rule_without_rates( array( 'target_margin_rate' => '60' ) );
		near( (float) $rule['target_margin_rate'], 0.60, 1e-12 );
		eq( $rule['min_contribution_rate'], null, 'a blank contribution is not a floor at the bare cost' );
	} );

	it( 'reads a percentage the way a French admin types it, unit and all', function () {
		$read = static fn( string $typed ): ?float => PriceRule::normalise(
			array( 'label' => 'r', 'active' => true, 'famille' => 'tee', 'min_contribution_rate' => $typed )
		)['min_contribution_rate'];

		eq( $read( '12,5' ), 0.125 );
		eq( $read( '12,5 %' ), 0.125 );
		eq( $read( 'un peu' ), null, 'a field nobody can read is not a rate' );
	} );

	it( 'refuses a rate of 100 % or more rather than storing an insoluble floor', function () {
		$read = static fn( array $rates ): array => PriceRule::normalise(
			array( 'label' => 'r', 'active' => true, 'famille' => 'tee' ) + $rates
		);
		eq( $read( array( 'min_contribution_rate' => '100' ) )['min_contribution_rate'], null );
		eq( $read( array( 'target_margin_rate' => '150' ) )['target_margin_rate'], null );
	} );

	it( 'drops a date that is not a calendar day', function () {
		eq( ts_rule( array( 'from' => '2026-02-30' ) )['from'], '' );
		eq( ts_rule( array( 'from' => 'demain' ) )['from'], '' );
		eq( ts_rule( array( 'from' => '2026-09-01' ) )['from'], '2026-09-01' );
	} );

	it( 'caps the list, because a hundred overlapping floors is not a policy', function () {
		$rows = array();
		for ( $i = 0; $i < PriceRule::MAX_RULES + 20; $i++ ) {
			$rows[] = array( 'label' => 'r' . $i, 'active' => true, 'min_contribution_rate' => '25' );
		}
		eq( count( PriceRule::normalise_all( $rows ) ), PriceRule::MAX_RULES );
	} );
} );

describe( 'PriceRule: when a rule applies', function () {
	it( 'ignores a rule nobody switched on', function () {
		truthy( ! PriceRule::matches( ts_rule( array( 'active' => false ) ), ts_facts(), TS_TODAY ) );
	} );

	it( 'honours both ends of the validity window, inclusively', function () {
		truthy( PriceRule::matches( ts_rule( array( 'from' => TS_TODAY ) ), ts_facts(), TS_TODAY ), 'the first day counts' );
		truthy( PriceRule::matches( ts_rule( array( 'to' => TS_TODAY ) ), ts_facts(), TS_TODAY ), 'and the last' );
		truthy( ! PriceRule::matches( ts_rule( array( 'from' => '2026-10-01' ) ), ts_facts(), TS_TODAY ) );
		truthy( ! PriceRule::matches( ts_rule( array( 'to' => '2026-09-29' ) ), ts_facts(), TS_TODAY ) );
	} );

	it( 'matches a quantity range at both bounds', function () {
		$rule = ts_rule( array( 'qty_min' => 30, 'qty_max' => 30 ) );
		truthy( PriceRule::matches( $rule, ts_facts( array( 'quantite' => 30 ) ), TS_TODAY ) );
		truthy( ! PriceRule::matches( $rule, ts_facts( array( 'quantite' => 29 ) ), TS_TODAY ) );
		truthy( ! PriceRule::matches( $rule, ts_facts( array( 'quantite' => 31 ) ), TS_TODAY ) );
	} );

	it( 'reads a bound of zero as no bound', function () {
		$rule = ts_rule( array( 'qty_min' => 0, 'qty_max' => 0 ) );
		truthy( PriceRule::matches( $rule, ts_facts( array( 'quantite' => 1 ) ), TS_TODAY ) );
		truthy( PriceRule::matches( $rule, ts_facts( array( 'quantite' => 9999 ) ), TS_TODAY ) );
	} );

	it( 'matches every one of the six scopes the chapter asks for', function () {
		foreach ( array( 'famille' => 'tee', 'technique' => 'dtf', 'commercial' => 'Karim B.', 'client' => 'pro', 'urgence' => 'standard' ) as $key => $value ) {
			truthy( PriceRule::matches( ts_rule( array( $key => $value ) ), ts_facts(), TS_TODAY ), "{$key} did not match" );
			truthy( ! PriceRule::matches( ts_rule( array( $key => 'autre chose' ) ), ts_facts(), TS_TODAY ), "{$key} matched the wrong value" );
		}
		// The sixth is the order size, which is a range and is tested above.
		truthy( PriceRule::matches( ts_rule( array( 'qty_min' => 10 ) ), ts_facts(), TS_TODAY ) );
	} );

	it( 'compares a salesperson’s name on its meaning, not on its capitals', function () {
		truthy( PriceRule::matches( ts_rule( array( 'commercial' => ' karim b. ' ) ), ts_facts(), TS_TODAY ) );
	} );

	it( 'lets an empty selector match anything', function () {
		truthy( PriceRule::matches( ts_rule(), ts_facts( array( 'famille' => 'sweat' ) ), TS_TODAY ) );
	} );

	it( 'never matches a rule that selects on a fact the order does not have', function () {
		/*
		 * THE CONSERVATIVE READING, and the reason a mixed basket has no family:
		 * a rule written for t-shirts has not been shown to apply to an order
		 * that is half sweatshirts, and applying it anyway is how a thin floor
		 * meant for one family reaches another.
		 */
		truthy( ! PriceRule::matches( ts_rule( array( 'famille' => 'tee' ) ), ts_facts( array( 'famille' => '' ) ), TS_TODAY ) );
		truthy( PriceRule::matches( ts_rule(), ts_facts( array( 'famille' => '' ) ), TS_TODAY ), 'a rule that does not select on it still applies' );
	} );
} );

describe( 'PriceRule: which of several rules wins', function () {
	it( 'answers null when none of them applies', function () {
		eq( PriceRule::best( array( ts_rule( array( 'famille' => 'sweat' ) ) ), ts_facts(), TS_TODAY, 0.25 ), null );
		eq( PriceRule::best( array(), ts_facts(), TS_TODAY, 0.25 ), null );
	} );

	it( 'takes the priority the operator set', function () {
		$low  = ts_rule( array( 'label' => 'basse', 'priority' => 1, 'min_contribution_rate' => '30' ) );
		$high = ts_rule( array( 'label' => 'haute', 'priority' => 9, 'min_contribution_rate' => '10' ) );
		eq( PriceRule::best( array( $low, $high ), ts_facts(), TS_TODAY, 0.25 )['label'], 'haute' );
		eq( PriceRule::best( array( $high, $low ), ts_facts(), TS_TODAY, 0.25 )['label'], 'haute', 'and not the order they were written in' );
	} );

	it( 'prefers the rule that names more things, at equal priority', function () {
		$broad  = ts_rule( array( 'label' => 'large', 'famille' => 'tee' ) );
		$narrow = ts_rule( array( 'label' => 'étroite', 'famille' => 'tee', 'urgence' => 'standard', 'qty_min' => 10 ) );
		eq( PriceRule::best( array( $broad, $narrow ), ts_facts(), TS_TODAY, 0.25 )['label'], 'étroite' );
	} );

	it( 'settles a remaining tie towards the STRICTER rule, never the first written', function () {
		/*
		 * Two rules, same priority, same specificity, different floors. Picking
		 * whichever was typed first would make an arbitrary choice between two
		 * floor prices; picking the higher minimum contribution makes the safe
		 * one, and the floor depends on that rate alone.
		 */
		$thin  = ts_rule( array( 'label' => 'mince', 'famille' => 'tee', 'min_contribution_rate' => '10' ) );
		$thick = ts_rule( array( 'label' => 'épaisse', 'famille' => 'tee', 'min_contribution_rate' => '30' ) );
		eq( PriceRule::best( array( $thin, $thick ), ts_facts(), TS_TODAY, 0.25 )['label'], 'épaisse' );
		eq( PriceRule::best( array( $thick, $thin ), ts_facts(), TS_TODAY, 0.25 )['label'], 'épaisse' );
	} );

	it( 'reads a rule that sets no contribution as asking for the shop’s own', function () {
		$silent = ts_rule_without_rates( array( 'label' => 'muette', 'famille' => 'tee', 'target_margin_rate' => '60' ) );
		$thin   = ts_rule( array( 'label' => 'mince', 'famille' => 'tee', 'min_contribution_rate' => '10' ) );
		eq( PriceRule::best( array( $silent, $thin ), ts_facts(), TS_TODAY, 0.25 )['label'], 'muette', '25 % beats 10 %' );
		eq( PriceRule::best( array( $silent, $thin ), ts_facts(), TS_TODAY, 0.05 )['label'], 'mince', 'and 10 % beats 5 %' );
	} );

	it( 'is total: the same set of rules always gives the same answer', function () {
		$a = ts_rule( array( 'label' => 'a', 'famille' => 'tee', 'min_contribution_rate' => '20' ) );
		$b = ts_rule( array( 'label' => 'b', 'famille' => 'tee', 'min_contribution_rate' => '20' ) );
		eq( PriceRule::best( array( $a, $b ), ts_facts(), TS_TODAY, 0.25 )['label'], 'a', 'the earlier one, and it says so' );
		eq( PriceRule::best( array( $b, $a ), ts_facts(), TS_TODAY, 0.25 )['label'], 'b' );
	} );
} );

describe( 'PriceRule: what a rule may change, and what it may not', function () {
	it( 'leaves the rates alone when nothing matches', function () {
		$out = PriceRule::apply( ts_base(), array( ts_rule( array( 'famille' => 'sweat', 'min_contribution_rate' => '5' ) ) ), ts_facts(), TS_TODAY );
		eq( $out['rules'], ts_base() );
		eq( $out['rule'], null );
	} );

	it( 'replaces only the rates the rule actually sets', function () {
		$out = PriceRule::apply( ts_base(), array( ts_rule( array( 'famille' => 'tee', 'min_contribution_rate' => '15' ) ) ), ts_facts(), TS_TODAY );
		near( $out['rules']['min_contribution_rate'], 0.15, 1e-12 );
		near( $out['rules']['target_margin_rate'], 0.55, 1e-12, 'the target the rule said nothing about' );
	} );

	it( 'never touches the commission or the discount ceiling', function () {
		// The commission is the salesperson's contract, not a pricing policy,
		// and the chapter's own price_rule carries neither.
		$out = PriceRule::apply( ts_base( 0.40 ), array( ts_rule( array( 'min_contribution_rate' => '15' ) ) ), ts_facts(), TS_TODAY );
		near( $out['rules']['commission_rate'], 0.40, 1e-12 );
		near( $out['rules']['max_discount_rate'], 0.15, 1e-12 );
	} );

	it( 'freezes the rule with its rates, so a deleted rule can still be explained', function () {
		$out = PriceRule::apply( ts_base(), array( ts_rule( array( 'label' => 'Sweats en volume', 'famille' => 'tee', 'min_contribution_rate' => '15' ) ) ), ts_facts(), TS_TODAY );
		eq( $out['rule']['label'], 'Sweats en volume' );
		near( (float) $out['rule']['min_contribution_rate'], 0.15, 1e-12 );
		eq( $out['rule']['target_margin_rate'], null, 'and what it deliberately did not set' );
	} );

	it( 'moves the floor by exactly what the rule asked for', function () {
		// The property the whole file exists for, tied to the formula rather
		// than asserted separately: 250,00 EUR of cost, 40 % commission.
		$base  = Margin::plan( 25000, ts_base() );
		$ruled = Margin::plan( 25000, PriceRule::apply( ts_base(), array( ts_rule( array( 'famille' => 'tee', 'min_contribution_rate' => '15' ) ) ), ts_facts(), TS_TODAY )['rules'] );

		eq( $base['floor_ht'], 42857, '250,00 / (1 − 0,25/0,60)' );
		eq( $ruled['floor_ht'], 33333, '250,00 / (1 − 0,15/0,60)' );
		truthy( $ruled['floor_ht'] < $base['floor_ht'], 'a thinner contribution is a lower floor, which is what a rule is for' );
	} );
} );

describe( 'PriceRule: the combination that has no solution', function () {
	it( 'names the rules that cannot work against the commission the shop pays', function () {
		$fine       = ts_rule( array( 'label' => 'raisonnable', 'min_contribution_rate' => '25' ) );
		$impossible = ts_rule( array( 'label' => 'impossible', 'min_contribution_rate' => '70' ) );

		eq( PriceRule::impossible( array( $fine, $impossible ), ts_base(), 0.40 ), array( 'impossible' ) );
		eq( PriceRule::impossible( array( $fine ), ts_base(), 0.40 ), array() );
	} );

	it( 'catches a rule that is fine at one commission rate and impossible at another', function () {
		// 65 % kept works while nobody is paid; against a first order at 40 % of
		// the margin it has no solution at any price, because only 60 % of the
		// margin is left to keep.
		$rule = ts_rule( array( 'label' => 'limite', 'min_contribution_rate' => '65' ) );
		eq( PriceRule::impossible( array( $rule ), ts_base(), 0.00 ), array() );
		eq( PriceRule::impossible( array( $rule ), ts_base(), 0.40 ), array( 'limite' ) );
	} );

	it( 'catches a rule that inherits an impossible contribution from the shop', function () {
		// The rule sets only a target margin, so it asks for the global
		// contribution, and that is the one that cannot be kept.
		$rule = ts_rule_without_rates( array( 'label' => 'héritée', 'target_margin_rate' => '60' ) );
		$base = ts_base();
		$base['min_contribution_rate'] = 0.70;
		eq( PriceRule::impossible( array( $rule ), $base, 0.40 ), array( 'héritée' ) );
	} );

	it( 'agrees with the formula about where the boundary is', function () {
		truthy( ! PriceRule::insoluble( 0.59, 0.40 ) );
		truthy( PriceRule::insoluble( 0.60, 0.40 ), 'k = 1 − c is already impossible' );
		throws( fn() => Margin::floor_price_rate( 25000, 0.60, 0.40 ) );
	} );
} );

describe( 'PriceRule: the two vocabularies, made one', function () {
	it( 'maps every studio garment onto a family a rule can name', function () {
		/*
		 * THE FINDING THAT KILLED THE FIRST DESIGN, and until now it was
		 * exercised on the one key where the map is the identity. A broken
		 * hoodie mapping makes every sweat rule silently not apply, and nothing
		 * would have failed.
		 */
		eq( PriceRule::family_of_garment( 'tee' ), 'tee' );
		eq( PriceRule::family_of_garment( 'hoodie' ), 'sweat', 'a hoodie is a sweat: the catalogue has one word for both' );
		eq( PriceRule::family_of_garment( 'custom' ), 'custom', 'a shirt the customer sent us was bought from nobody' );
		eq( PriceRule::family_of_garment( 'polo' ), '', 'the studio sells no polo, so there is nothing to map' );
		eq( PriceRule::family_of_garment( '' ), '' );
	} );

	it( 'maps onto words a rule can actually be written against', function () {
		foreach ( array( 'tee', 'hoodie', 'custom' ) as $garment ) {
			$family = PriceRule::family_of_garment( $garment );
			truthy( isset( PriceRule::FAMILIES[ $family ] ), "{$garment} maps to {$family}, which no rule can select" );
		}
	} );
} );

describe( 'PriceRule: a rule that decides nothing must not silence one that does', function () {
	it( 'skips a rule with both rates blank, however specific it is', function () {
		/*
		 * MEASURED BEFORE THE FIX: with facts famille=tee, urgence=express,
		 * client=professionnel, a rule naming all three and setting no rate
		 * outranked one naming the family and asking 40 %, and the floor on the
		 * worked example fell from 750,00 EUR to 428,57 EUR, decided by a rule
		 * that changes no number.
		 */
		$strict = ts_rule( array( 'label' => 'stricte', 'famille' => 'tee', 'min_contribution_rate' => '40' ) );
		$empty  = ts_rule_without_rates( array( 'label' => 'vide', 'famille' => 'tee', 'urgence' => 'standard', 'client' => 'pro' ) );

		truthy( PriceRule::matches( $empty, ts_facts(), TS_TODAY ), 'it does match, it just must not win' );
		truthy( ! PriceRule::decides( $empty ) );
		eq( PriceRule::best( array( $empty, $strict ), ts_facts(), TS_TODAY, 0.25 )['label'], 'stricte' );

		$floor = Margin::plan( 25000, PriceRule::apply( ts_base(), array( $empty, $strict ), ts_facts(), TS_TODAY )['rules'] )['floor_ht'];
		eq( $floor, 75000, '250,00 / (1 − 0,40/0,60), the strict rule’s floor, not the shop’s 428,57' );
	} );

	it( 'applies nothing at all when the only matching rule decides nothing', function () {
		$empty = ts_rule_without_rates( array( 'famille' => 'tee', 'urgence' => 'standard' ) );
		$out   = PriceRule::apply( ts_base(), array( $empty ), ts_facts(), TS_TODAY );
		eq( $out['rule'], null, 'and the report must not name a rule that changed nothing' );
		eq( $out['rules'], ts_base() );
	} );
} );
