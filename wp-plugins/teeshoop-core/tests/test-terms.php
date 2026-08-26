<?php
/**
 * The conditions of sale: the register, and the agreement between the published
 * text and the code.
 *
 * THE INTERESTING TEST IS THE LAST ONE. `Terms::checked()` is the only thing
 * standing between a contract that states a twelve-day lead time and a workshop
 * that has been reconfigured to fourteen. It is not enough that it passes on the
 * version we shipped: this file breaks the value on purpose and requires the
 * check to report it, because a comparison that cannot fail is a comparison
 * nobody should trust. `CLAUDE.md` section 1 asks for exactly that.
 *
 * The shipped default is what the pure suite compares against. The LIVE
 * configuration, which an operator can change from the admin, is compared by
 * `Terms::live_values()` on the shop itself; the two callers share one rule.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Terms.php';
require_once __DIR__ . '/../includes/Pricing.php';
require_once __DIR__ . '/../includes/Production.php';
require_once __DIR__ . '/../includes/Shipping.php';
require_once __DIR__ . '/../includes/Bat.php';
require_once __DIR__ . '/../includes/Settlement.php';
require_once __DIR__ . '/../includes/Quote.php';

use Teeshoop\Core\Terms;
use Teeshoop\Core\Pricing;
use Teeshoop\Core\Production;
use Teeshoop\Core\Shipping;
use Teeshoop\Core\Bat;
use Teeshoop\Core\Settlement;
use Teeshoop\Core\Quote;

/**
 * The values as the repository ships them, with no database in sight.
 *
 * The same sixteen keys `Terms::live_values()` builds from the stored
 * configuration. Two builders, one vocabulary: if a key is added to `FORMATS`
 * and not to both, `Terms::checked()` reports « la boutique n'a pas fourni cette
 * valeur » rather than passing.
 */
function ts_terms_defaults(): array {
	$pricing    = Pricing::default_config();
	$production = Production::default_config();
	$shipping   = Shipping::default_config();
	$bat        = Bat::default_config();
	$settlement = Settlement::default_config();

	return array(
		'minimum_pieces'           => (int) $pricing['min_qty'],
		'minimum_ht'               => (int) $pricing['min_ht'],
		'tva'                      => (float) $pricing['vat_rate'],
		'devis_pieces'             => (int) $pricing['quote_from_qty'],
		'devis_ht'                 => (int) $pricing['quote_from_ht'],
		'plafond_pieces'           => (int) $pricing['max_qty'],
		'delai_fabrication'        => (int) $production['lead_days']['standard'],
		'delai_transport'          => (int) $production['ship_days'],
		'franco_ht'                => (int) $shipping['free_from_ht'],
		'bat_corrections'          => (int) $bat['corrections_incluses'],
		'bat_correction_ht'        => (int) $bat['correction_ht'],
		'bat_lien_jours'           => (int) $bat['lien_jours'],
		'tolerance_cm'             => (int) $bat['tolerance_position_cm'],
		'acompte_ht'               => (int) $settlement['deposit_from_ht'],
		'acompte_taux'             => (float) $settlement['deposit_rate'],
		'conservation_devis_jours' => Quote::KEEP_DAYS,
	);
}

describe(
	'Terms: the register of versions',
	function () {
		it(
			'finds at least one version on disk',
			function () {
				truthy( count( Terms::versions() ) > 0, 'aucune version de CGV n’est publiée' );
			}
		);

		it(
			'names every version as a real calendar date',
			function () {
				foreach ( Terms::versions() as $v ) {
					truthy( (bool) preg_match( '/^\d{4}-\d{2}-\d{2}$/', $v ), "version mal nommée : $v" );
					truthy( false !== strtotime( $v ), "version qui n’est pas une date : $v" );
				}
			}
		);

		it(
			'takes the latest version whose date has arrived, and no later one',
			function () {
				$all = Terms::versions();
				$first = $all[0];
				eq( Terms::in_force( $first ), $first, 'une version prend effet le jour même' );
				eq( Terms::in_force( '1999-01-01' ), '', 'aucune version avant la première' );
				eq( Terms::in_force( '2999-12-31' ), end( $all ), 'la dernière version l’emporte plus tard' );
			}
		);

		it(
			'refuses a version that is not on disk, however it is spelled',
			function () {
				truthy( ! Terms::exists( '2026-13-01' ), 'un treizième mois a été accepté' );
				truthy( ! Terms::exists( '../../includes/Legal' ), 'un chemin relatif a été accepté' );
				truthy( ! Terms::exists( '' ), 'la chaîne vide a été acceptée' );
				eq( Terms::document( '../../includes/Legal' ), null, 'un chemin relatif a été chargé' );
			}
		);

		it(
			'loads a version with a title, articles and a draft marker',
			function () {
				$doc = Terms::document( Terms::versions()[0] );
				truthy( is_array( $doc ), 'la première version ne se charge pas' );
				truthy( '' !== (string) $doc['titre'], 'version sans titre' );
				truthy( count( $doc['articles'] ) >= 10, 'moins de dix articles dans des CGV' );
				eq( $doc['etat'], 'projet', 'une version qui ne se déclare pas comme un projet' );
				truthy( '' !== (string) $doc['resume'], 'aucun avertissement de relecture' );
			}
		);
	}
);

describe(
	'Terms: the text and the shop must say the same thing',
	function () {
		it(
			'agrees with the shipped configuration, on every version',
			function () {
				$values = ts_terms_defaults();
				foreach ( Terms::versions() as $version ) {
					$doc  = Terms::document( $version );
					$bad  = Terms::checked( $doc, $values );
					$why  = array_map(
						static fn( array $r ): string => $r['cle'] . ' : ' . $r['raison'] . ' (attendu ' . $r['attendu'] . ', fragment « ' . $r['texte'] . ' »)',
						$bad
					);
					eq( $bad, array(), "la version $version ne dit plus ce que la boutique fait : " . implode( ' | ', $why ) );
				}
			}
		);

		it(
			'pins every figure the format table knows about',
			function () {
				/*
				 * A VERSION MAY LEGITIMATELY NOT MENTION A VALUE, but it may not
				 * mention it WITHOUT pinning it: that is how a figure ends up in
				 * a contract with nothing comparing it. This asserts the reverse
				 * direction of `checked()`, which only looks at what is declared.
				 *
				 * THE NEWEST VERSION, not the one in force. A version published
				 * before a value existed cannot pin it, and demanding that it did
				 * would mean editing history. What must be complete is the text
				 * we publish from now on.
				 */
				$all     = Terms::versions();
				$doc     = Terms::document( (string) end( $all ) );
				$pinned  = array_column( (array) $doc['accords'], 'cle' );
				$missing = array_diff( array_keys( Terms::FORMATS ), $pinned );
				eq( $missing, array(), 'des valeurs connues ne sont épinglées par aucun accord : ' . implode( ', ', $missing ) );
			}
		);

		it(
			'REPORTS a figure the shop no longer applies',
			function () {
				/*
				 * BREAK IT ON PURPOSE. The lead time moves from twelve days to
				 * fourteen, as it would if the workshop were reconfigured, and
				 * the published text is now a promise nobody keeps. If this
				 * comes back empty the whole mechanism is decorative.
				 */
				$doc    = Terms::document( Terms::versions()[0] );
				$values = ts_terms_defaults();
				$values['delai_fabrication'] = $values['delai_fabrication'] + 2;

				$bad = Terms::checked( $doc, $values );
				truthy( count( $bad ) > 0, 'un délai changé n’a pas été signalé' );
				eq( $bad[0]['cle'], 'delai_fabrication', 'la mauvaise valeur a été signalée' );
			}
		);

		it(
			'REPORTS a fragment that has been edited out of the text',
			function () {
				$doc = Terms::document( Terms::versions()[0] );
				// The article that carries the tolerance, emptied.
				foreach ( $doc['articles'] as $i => $article ) {
					if ( str_contains( (string) $article['titre'], 'Tolérances' ) ) {
						$doc['articles'][ $i ]['liste'] = array();
					}
				}
				$bad = Terms::checked( $doc, ts_terms_defaults() );
				$keys = array_column( $bad, 'cle' );
				truthy( in_array( 'tolerance_cm', $keys, true ), 'une phrase supprimée n’a pas été signalée' );
			}
		);

		it(
			'REPORTS a version that pins nothing at all',
			function () {
				$doc = Terms::document( Terms::versions()[0] );
				$doc['accords'] = array();
				$bad = Terms::checked( $doc, ts_terms_defaults() );
				truthy( count( $bad ) > 0, 'une version sans aucun accord est passée pour vérifiée' );
			}
		);

		it(
			'REPORTS a value the caller could not resolve',
			function () {
				$doc    = Terms::document( Terms::versions()[0] );
				$values = ts_terms_defaults();
				unset( $values['tva'] );
				$bad  = Terms::checked( $doc, $values );
				$keys = array_column( $bad, 'cle' );
				truthy( in_array( 'tva', $keys, true ), '« on n’a pas pu regarder » est passé pour « rien à signaler »' );
			}
		);
	}
);

describe(
	'Terms: how a figure is written in French',
	function () {
		it(
			'writes money the way the rest of the shop writes it',
			function () {
				/*
				 * AN EXAMPLE MUST NOT BE A THRESHOLD. The first version of this
				 * case used the order minimum as its sample amount, and the
				 * register caught it: that figure has a home, and a second bare
				 * copy of it anywhere else is exactly what `checkNoSecondCopy`
				 * exists to find. It caught the second version too, because the
				 * digits were still written in this comment. The scan reads the
				 * whole file, comments included, and it is right to.
				 */
				eq( Terms::french( 123456, 'eur' ), \Teeshoop\Core\Money::format( 123456 ), 'deux façons d’écrire un montant' );
			}
		);

		it(
			'writes a rate as a percentage without trailing zeroes',
			function () {
				eq( Terms::french( 0.2, 'pct' ), '20' . "\u{00A0}" . '%', 'un taux mal écrit' );
				eq( Terms::french( 0.5, 'pct' ), '50' . "\u{00A0}" . '%', 'un taux mal écrit' );
			}
		);

		it(
			'groups a large count the French way',
			function () {
				eq( Terms::french( 12345, 'int' ), '12' . "\u{202F}" . '345', 'un nombre mal groupé' );
			}
		);
	}
);
