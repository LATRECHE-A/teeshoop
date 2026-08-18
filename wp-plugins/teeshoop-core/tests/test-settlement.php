<?php
/**
 * What an order has been paid, and what that lets it do.
 *
 * The case this file exists for is the one the Bible contradicts itself about,
 * so both of its readings are asserted side by side rather than one of them
 * being quietly chosen: an order with no authorised deposit must be paid in
 * full before production (chapter 2, line 330), and an order with one may start
 * on the deposit and still not be dispatched (line 139). Whichever way the
 * associate answers question 16, one of these two cases is already right.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

/*
 * COMMAND LINE ONLY. `wp-content/plugins/` is served by URL and this directory
 * is inside it: before the guards, GET on any of these files ran the suite to
 * the public internet and printed the figures of every failing assertion.
 */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Settlement.php';

use Teeshoop\Core\Settlement;

function ts_settle_config(): array {
	return Settlement::default_config();
}

describe( 'Settlement: when a deposit is possible at all', function () {
	it( 'opens at the threshold and not below it', function () {
		$config = ts_settle_config();
		$from   = (int) $config['deposit_from_ht'];

		truthy( ! Settlement::deposit_possible( $from - 1, $config ), 'one cent short was offered a deposit' );
		truthy( Settlement::deposit_possible( $from, $config ), 'exactly the threshold was refused' );
		truthy( Settlement::deposit_possible( $from * 3, $config ) );
	} );

	it( 'treats a threshold of 0 as no deposit at all, not as always', function () {
		$config                    = ts_settle_config();
		$config['deposit_from_ht'] = 0;
		truthy( ! Settlement::deposit_possible( 999999999, $config ), 'clearing the field opened deposits to everyone' );
	} );

	/*
	 * THE TWO ASSUMPTIONS DO NOT MEET, and that is a fact about the shop rather
	 * than about this class. Question 02 stops self-serve at 2 000 EUR HT and
	 * question 16 opens deposits at 3 000, so no basket a customer fills alone
	 * can ever qualify. Asserted here so that if either figure is answered the
	 * day this stops being true, somebody is told.
	 */
	it( 'cannot be reached by any basket the site prices on its own', function () {
		require_once __DIR__ . '/../includes/Pricing.php';
		$self_serve = (int) \Teeshoop\Core\Pricing::default_config()['quote_from_ht'];
		$deposit    = (int) ts_settle_config()['deposit_from_ht'];

		truthy(
			$self_serve < $deposit,
			'a self-serve order can now qualify for a deposit; question 16 assumed it could not'
		);
	} );
} );

describe( 'Settlement: how much a deposit is', function () {
	it( 'is half the amount the customer actually settles', function () {
		$config = ts_settle_config();
		eq( Settlement::deposit_due( 600000, $config ), 300000 );
		eq( Settlement::deposit_due( 1, $config ), 1, 'a one-cent order rounds up, not to zero' );
	} );

	it( 'adds up to the total with the balance, exactly, at every odd cent', function () {
		$config = ts_settle_config();
		foreach ( range( 1, 60 ) as $cents ) {
			$total   = 360000 + $cents;
			$deposit = Settlement::deposit_due( $total, $config );
			eq( $deposit + Settlement::remaining( $total, $deposit ), $total, "total {$total}" );
		}
	} );

	it( 'never asks for more than the order', function () {
		$config                 = ts_settle_config();
		$config['deposit_rate'] = 1.5;
		eq( Settlement::deposit_due( 100000, $config ), 100000, 'a rate past 1 asked for more than the order' );
		$config['deposit_rate'] = 0.0;
		eq( Settlement::deposit_due( 100000, $config ), 100000, 'a rate of 0 asked for nothing' );
	} );
} );

describe( 'Settlement: where an order stands', function () {
	it( 'tells nothing, short, deposit and paid apart', function () {
		$config = ts_settle_config();
		$total  = 600000;

		$deposit = Settlement::deposit_due( $total, $config );

		eq( Settlement::state( $total, 0, $deposit, $config ), Settlement::NOTHING );
		eq( Settlement::state( $total, 299999, $deposit, $config ), Settlement::SHORT, 'a cent under the deposit' );
		eq( Settlement::state( $total, 300000, $deposit, $config ), Settlement::DEPOSIT );
		eq( Settlement::state( $total, 599999, $deposit, $config ), Settlement::DEPOSIT );
		eq( Settlement::state( $total, 600000, $deposit, $config ), Settlement::PAID );
		eq( Settlement::state( $total, 700000, $deposit, $config ), Settlement::PAID, 'an overpayment is still paid' );
	} );

	it( 'never calls a part payment a deposit when nobody authorised one', function () {
		// Half the money on an order nobody approved a deposit for is not a
		// deposit, it is a short payment, and somebody has to chase it.
		$config = ts_settle_config();
		eq( Settlement::state( 600000, 300000, null, $config ), Settlement::SHORT );
		eq( Settlement::state( 600000, 600000, null, $config ), Settlement::PAID );
	} );

	it( 'reports money that arrived and should not have', function () {
		eq( Settlement::overpaid( 600000, 650000 ), 50000 );
		eq( Settlement::overpaid( 600000, 600000 ), 0 );
		eq( Settlement::remaining( 600000, 650000 ), 0, 'an overpayment left a negative balance' );
	} );
} );

describe( 'Settlement: the gate the Bible contradicts itself about', function () {
	/*
	 * "une commande non payée ne peut pas passer en production" (line 330).
	 */
	it( 'holds the strict reading for an order nobody authorised a deposit for', function () {
		$config = ts_settle_config();
		$total  = 600000;

		eq( Settlement::required_for( Settlement::STAGE_PRODUCTION, $total, null, $config ), $total );
		truthy( ! Settlement::stage_allows( Settlement::STAGE_PRODUCTION, $total, 599999, null, $config ), 'a cent short went to production' );
		truthy( Settlement::stage_allows( Settlement::STAGE_PRODUCTION, $total, $total, null, $config ) );
	} );

	/*
	 * "commande importante : acompte possible, solde avant expédition ou avant
	 * production selon le risque" (line 139).
	 */
	it( 'holds the permissive reading for an order somebody did', function () {
		$config = ts_settle_config();
		$total  = 600000;

		eq( Settlement::required_for( Settlement::STAGE_PRODUCTION, $total, 300000, $config ), 300000 );
		truthy( Settlement::stage_allows( Settlement::STAGE_PRODUCTION, $total, 300000, 300000, $config ) );
		truthy( ! Settlement::stage_allows( Settlement::STAGE_PRODUCTION, $total, 299999, 300000, $config ), 'a cent under the deposit started production' );

		/*
		 * AND IT IS THE AMOUNT THAT WAS AUTHORISED, not today's setting. An
		 * order approved at 50 % and half paid must not stop being allowed to
		 * produce because somebody moved the rate to 60 % afterwards.
		 */
		$later                    = $config;
		$later['deposit_rate']    = 0.6;
		truthy(
			Settlement::stage_allows( Settlement::STAGE_PRODUCTION, $total, 300000, 300000, $later ),
			'raising the rate re-decided an order that was already approved'
		);
	} );

	it( 'lets nothing leave the workshop against a promise, either way', function () {
		$config = ts_settle_config();
		$total  = 600000;

		foreach ( array( 300000, null ) as $authorised ) {
			eq( Settlement::required_for( Settlement::STAGE_DISPATCH, $total, $authorised, $config ), $total );
			truthy( ! Settlement::stage_allows( Settlement::STAGE_DISPATCH, $total, $total - 1, $authorised, $config ) );
			truthy( Settlement::stage_allows( Settlement::STAGE_DISPATCH, $total, $total, $authorised, $config ) );
		}
	} );

	it( 'charges everything for a stage nobody has defined', function () {
		// "We do not know what this one needs" and "this one needs nothing" are
		// different answers, and only one of them is safe to give a workshop.
		$config = ts_settle_config();
		eq( Settlement::required_for( 'broderie', 600000, 300000, $config ), 600000 );
		truthy( ! Settlement::stage_allows( 'broderie', 600000, 300000, 300000, $config ) );
	} );
} );

describe( 'Settlement: the ledger', function () {
	it( 'sums what arrived', function () {
		$ledger = Settlement::record( array(), 300000, 'virement', 'VIR-1', '2026-09-01' );
		$ledger = Settlement::record( $ledger, 300000, 'virement', 'VIR-2', '2026-09-01' );
		eq( Settlement::received( $ledger ), 600000 );
		eq( count( $ledger ), 2 );
	} );

	it( 'refuses the same encashment twice', function () {
		// A gateway retries, a status transition fires again, an operator
		// double-clicks. The Bible: "un même événement reçu deux fois ne doit
		// pas doubler une facture, une commande ou une commission".
		$ledger = Settlement::record( array(), 300000, 'carte', 'pi_abc123', '2026-09-01' );
		$ledger = Settlement::record( $ledger, 300000, 'carte', 'pi_abc123', '2026-09-01' );
		eq( count( $ledger ), 1, 'the same reference was recorded twice' );
		eq( Settlement::received( $ledger ), 300000 );
	} );

	it( 'still records two genuine receipts of the same amount', function () {
		$ledger = Settlement::record( array(), 300000, 'virement', 'VIR-1', '2026-09-01' );
		$ledger = Settlement::record( $ledger, 300000, 'virement', 'VIR-2', '2026-09-01' );
		eq( count( $ledger ), 2, 'two different transfers were read as one' );
	} );

	/*
	 * THE REFERENCE IS THE IDEMPOTENCE, so a receipt without one is refused
	 * rather than accepted unprotected. Measured before the fix: two calls of
	 * 1 000,00 EUR with no reference gave 2 000,00 EUR received, the order read
	 * as fully paid and the parcel was free to leave.
	 */
	it( 'refuses a receipt it could not tell apart from a repeat', function () {
		$ledger = Settlement::record( array(), 100000, 'Virement bancaire', '', '2026-09-01' );
		eq( $ledger, array(), 'a receipt with no reference was recorded' );
		eq( Settlement::record( array(), 100000, 'Virement bancaire', '   ', '2026-09-01' ), array() );
	} );

	it( 'refuses an amount that is not money coming in', function () {
		$ledger = Settlement::record( array(), 0, 'carte', 'a', '2026-09-01' );
		eq( $ledger, array() );
		// A refund is not a negative encashment; it is a document this plugin
		// does not issue.
		$ledger = Settlement::record( array(), -1234, 'carte', 'b', '2026-09-01' );
		eq( $ledger, array() );
	} );

	it( 'drops a stored entry it cannot read rather than counting it as zero', function () {
		$ledger = Settlement::normalise(
			array(
				array( 'cents' => 300000, 'date' => '2026-09-01', 'method' => 'virement', 'reference' => 'A' ),
				array( 'cents' => 0 ),
				'not an entry',
				array( 'date' => '2026-09-01' ),
			)
		);
		eq( count( $ledger ), 1 );
		eq( Settlement::received( $ledger ), 300000 );
		eq( Settlement::normalise( 'rien' ), array() );
	} );
} );
