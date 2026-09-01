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
require_once __DIR__ . '/../includes/Invoice.php';

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
		'devis_validite_jours'     => Quote::VALIDITY_DAYS,
		'penalites_contractuelles' => (string) ( \Teeshoop\Core\Invoice::default_config()['penalty_rate'] ?? '' ),
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
				$doc = Terms::document( Terms::newest() );
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
			'agrees with the shipped configuration, on the version that binds',
			function () {
				/*
				 * THE NEWEST VERSION, and no longer every version.
				 *
				 * This asserted « on every version » while there was exactly one,
				 * and it stopped being possible the day there were two: the
				 * conditions of 26 August 2026 promise a 300,00 EUR franco and a
				 * twelve-day lead time, which is what the shop did on 26 August.
				 * A superseded version is a contract somebody accepted, not a
				 * description of today's shop, and demanding that history agree
				 * with the present would mean editing history.
				 *
				 * What replaces the coverage is the test below: a superseded
				 * version must be UNCHANGED, byte for byte, against a recorded
				 * fingerprint.
				 */
				$version = Terms::newest();
				truthy( '' !== $version, 'aucune version de CGV n’est publiée' );
				$doc  = Terms::document( $version );
				$bad  = Terms::checked( $doc, ts_terms_defaults() );
				$why  = array_map(
					static fn( array $r ): string => $r['cle'] . ' : ' . $r['raison'] . ' (attendu ' . $r['attendu'] . ', fragment « ' . $r['texte'] . ' »)',
					$bad
				);
				eq( $bad, array(), "la version $version ne dit plus ce que la boutique fait : " . implode( ' | ', $why ) );
			}
		);

		it(
			'FREEZES every version that is no longer in force, byte for byte',
			function () {
				$frozen = Terms::frozen_fingerprints();
				$olds   = Terms::superseded();
				truthy( count( $olds ) > 0, 'aucune version périmée : ce contrôle ne prouve rien tant qu’il n’y en a pas' );
				foreach ( $olds as $version ) {
					truthy(
						isset( $frozen[ $version ] ),
						"la version $version n’est plus en vigueur et son empreinte n’est pas enregistrée dans data/cgv/figees.php"
					);
					eq(
						Terms::fingerprint( $version ),
						(string) ( $frozen[ $version ] ?? '' ),
						"la version $version a été modifiée après avoir été remplacée : une version acceptée ne se corrige pas, on en publie une nouvelle"
					);
				}
			}
		);

		it(
			'REPORTS a superseded version that has been edited',
			function () {
				// BREAK IT ON PURPOSE: the recorded fingerprint of a real file,
				// against a fingerprint that is not it.
				$olds = Terms::superseded();
				truthy( count( $olds ) > 0 );
				$real = Terms::fingerprint( $olds[0] );
				truthy( 64 === strlen( $real ), 'une empreinte sha256 fait 64 caractères' );
				truthy( $real !== str_repeat( '0', 64 ), 'une empreinte qui ne distingue rien ne gèle rien' );
				eq( Terms::fingerprint( '2999-01-01' ), '', 'une version qui n’existe pas n’a pas d’empreinte' );
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
				$doc    = Terms::document( Terms::newest() );
				$values = ts_terms_defaults();
				$values['delai_fabrication'] = $values['delai_fabrication'] + 2;

				$bad = Terms::checked( $doc, $values );
				truthy( count( $bad ) > 0, 'un délai changé n’a pas été signalé' );
				eq( $bad[0]['cle'], 'delai_fabrication', 'la mauvaise valeur a été signalée' );
			}
		);

		it(
			'REPORTS the free-delivery threshold being cleared, which the substring test missed',
			function () {
				/*
				 * THE ONE THAT COST MONEY, END TO END. An operator clears
				 * « livraison offerte à partir de », `Shipping` reads the zero as
				 * no franco at all and charges carriage on every basket, and the
				 * published conditions still promise it free. `str_contains` said
				 * nothing because the zero amount is a substring of the real one.
				 */
				$doc    = Terms::document( Terms::newest() );
				$values = ts_terms_defaults();
				$values['franco_ht'] = 0;
				$bad = Terms::checked( $doc, $values );
				truthy( count( $bad ) > 0, 'un franco effacé n’a pas été signalé' );
				eq( $bad[0]['cle'], 'franco_ht', 'la mauvaise valeur a été signalée' );
			}
		);

		it(
			'REPORTS the shop moving to the franchise en base while the terms publish a VAT rate',
			function () {
				$doc    = Terms::document( Terms::newest() );
				$values = ts_terms_defaults();
				$values['tva'] = 0.0;
				$bad = Terms::checked( $doc, $values );
				truthy( count( $bad ) > 0, 'un taux tombé à zéro n’a pas été signalé' );
				eq( $bad[0]['cle'], 'tva', 'la mauvaise valeur a été signalée' );
			}
		);

		it(
			'REPORTS a late-payment rate being set, which the terms say does not exist',
			function () {
				/*
				 * The billing screen offers « Taux des pénalités de retard » and
				 * its help text invites a number. Article 14 of the conditions
				 * says « Aucun taux contractuel plus bas n'est prévu », so a rate
				 * typed there makes the invoice and the accepted conditions state
				 * two different rules about the same debt.
				 */
				$doc    = Terms::document( Terms::newest() );
				$values = ts_terms_defaults();
				$values['penalites_contractuelles'] = '12';
				$bad = Terms::checked( $doc, $values );
				truthy( count( $bad ) > 0, 'un taux contractuel posé n’a pas été signalé' );
				eq( $bad[0]['cle'], 'penalites_contractuelles', 'la mauvaise valeur a été signalée' );
			}
		);

		it(
			'REPORTS a fragment that has been edited out of the text',
			function () {
				$doc = Terms::document( Terms::newest() );
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
				$doc = Terms::document( Terms::newest() );
				$doc['accords'] = array();
				$bad = Terms::checked( $doc, ts_terms_defaults() );
				truthy( count( $bad ) > 0, 'une version sans aucun accord est passée pour vérifiée' );
			}
		);

		it(
			'REPORTS a value the caller could not resolve',
			function () {
				$doc    = Terms::document( Terms::newest() );
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
	'Terms: a fragment must state the value, not merely contain it',
	function () {
		it(
			'REFUSES a value that is only the tail of a bigger number',
			function () {
				/*
				 * THE ONE THAT COST MONEY. « 0,00 EUR » is a substring of
				 * « 300,00 EUR ». An operator who cleared the free-delivery
				 * threshold made `Shipping` charge carriage on every basket while
				 * the published conditions still promised it free above the
				 * threshold, and `str_contains` reported nothing at all.
				 *
				 * The amounts here are NOT the shop's own: an example that is
				 * also a threshold is a second copy of a value with a home, and
				 * the register says so. The property is what matters, and it
				 * holds for any amount whose rendering ends in another's.
				 */
				$fragment = 'offerte à partir de ' . Terms::french( 77700, 'eur' ) . ' hors taxes';
				truthy( Terms::states( $fragment, Terms::french( 77700, 'eur' ) ), 'la vraie valeur n’est pas reconnue' );
				truthy( ! Terms::states( $fragment, Terms::french( 70000, 'eur' ) ), 'la fin du montant passe pour le montant' );
				truthy( ! Terms::states( $fragment, Terms::french( 0, 'eur' ) ), 'zéro passe pour le seuil' );
			}
		);

		it(
			'REFUSES a rate that is only the tail of another rate',
			function () {
				/*
				 * And the one that would have made the conditions publish a VAT
				 * rate the invoice contradicts: « 0 % » is the tail of « 20 % »,
				 * and a franchise en base period sets the live rate to exactly
				 * zero.
				 */
				$fragment = 'appliqué est de ' . Terms::french( 0.2, 'pct' );
				truthy( Terms::states( $fragment, Terms::french( 0.2, 'pct' ) ), 'le vrai taux n’est pas reconnu' );
				truthy( ! Terms::states( $fragment, Terms::french( 0.0, 'pct' ) ), 'zéro pour cent passe pour vingt' );
			}
		);

		it(
			'reads a grouped number as one value and not as its parts',
			function () {
				$fragment = 'conservée ' . Terms::french( 6789, 'int' ) . ' jours';
				truthy( Terms::states( $fragment, Terms::french( 6789, 'int' ) ), 'la vraie durée n’est pas reconnue' );
				truthy( ! Terms::states( $fragment, Terms::french( 789, 'int' ) ), 'la fin du nombre passe pour le nombre' );
				truthy( ! Terms::states( $fragment, Terms::french( 6, 'int' ) ), 'le début du nombre passe pour le nombre' );
			}
		);

		it(
			'has no opinion about an empty value',
			function () {
				truthy( ! Terms::states( 'quoi que ce soit', '' ), 'la chaîne vide se trouve partout' );
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
