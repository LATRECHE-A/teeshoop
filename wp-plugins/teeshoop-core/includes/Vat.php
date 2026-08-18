<?php
/**
 * The VAT regime, as a dated timeline rather than a constant.
 *
 * WHY A TIMELINE AND NOT A NUMBER. A French company in franchise en base de TVA
 * charges no VAT at all and must print "TVA non applicable, article 293 B du
 * CGI" on every document. The day it crosses the threshold it starts charging,
 * and from that day its invoices are a different document: they carry a rate, a
 * VAT line and an intracommunity number. An invoice issued before the switch
 * stays what it was. A single `vat_rate` constant cannot express any of that,
 * and the one thing this shop must never do is reprint an old invoice under a
 * new regime.
 *
 * WHY IT MATTERS HERE AND NOT IN THEORY. Question 17 of QUESTIONS-ASSOCIE.md is
 * unanswered, and constat 6 of that document records what was measured on the
 * live shop on 14/08/2026: `woocommerce_calc_taxes` is `no`, and 15 orders
 * totalling 465,79 EUR were taken between 21/11/2024 and 18/04/2025 with tax
 * calculation switched off. Either the company is in franchise, in which case
 * the mandatory mention is missing from those invoices, or it is assujettie, in
 * which case there is a regularisation to make. Nobody here gets to guess which,
 * so the code holds a shape that can express both and holds no threshold at all.
 *
 * WHAT IS DELIBERATELY ABSENT: any franchise threshold, and any switch date.
 * Those are the accountant's answer, not ours. What is here is the SHAPE: a list
 * of periods, each with the date it starts and the regime it carries. The
 * associate fills the dates.
 *
 * THE DEFAULT COVERS TODAY AND NOTHING BEFORE IT, on purpose. The shipped
 * timeline opens on the day this was written, so an order dated before it
 * resolves to "we do not know", which is the true statement about the 15
 * historical orders. It is not a bug that an invoice for one of them refuses to
 * render: it is the question, made visible where somebody has to act on it.
 *
 * ONE RATE, ONE HOME. A standard period carries no rate of its own: it uses the
 * shop's standard rate, which lives in `Pricing::default_config()['vat_rate']`
 * and is registered there as H-Q17-TVA. A franchise period has no rate to write
 * down, because there is none. So the number 20 % is still written in exactly
 * one place in this plugin, and this file adds no second copy of it.
 *
 * Pure by construction: no WordPress function is called here, so it is tested by
 * `php tests/run.php` with no bootstrap. The stored periods are read by
 * `Settings::vat_periods()`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

require_once __DIR__ . '/Pricing.php';

final class Vat {

	/** No VAT is charged and none is deductible. Article 293 B du CGI. */
	public const FRANCHISE = 'franchise';

	/** VAT is charged at the shop's standard rate. */
	public const STANDARD = 'standard';

	/**
	 * The mention French law makes mandatory on every invoice and every quote
	 * issued under the franchise.
	 *
	 * Verbatim, and a constant rather than a translated string: it is a legal
	 * formula, not copy. Article 293 B du CGI is what exempts the company;
	 * article 293 E is what obliges it to say so on the document. A shop that
	 * prints nothing there has issued a non-conforming invoice.
	 */
	public const MENTION_FRANCHISE = 'TVA non applicable, article 293 B du CGI';

	/**
	 * The day the shipped timeline opens.
	 *
	 * The date the decision to proceed on default hypotheses was taken and
	 * written into QUESTIONS-ASSOCIE.md. Nothing before it is claimed.
	 */
	public const ASSUMED_FROM = '2026-08-18';

	/**
	 * The regime the shop assumes it is under, absent an answer.
	 *
	 * Question 17's written default: "Le régime en vigueur par défaut est la TVA
	 * à 20 %, affiché comme une hypothèse à côté du fait que la boutique en ligne
	 * est aujourd'hui configurée taxes désactivées."
	 */
	public static function default_periods(): array {
		return array(
			array(
				'from'   => self::ASSUMED_FROM,
				'regime' => self::STANDARD,
			),
		);
	}

	/**
	 * Normalise a stored timeline: drop what cannot be read, sort by start date.
	 *
	 * An ABSENT option falls back to the shipped default; an option holding an
	 * EMPTY list does not. Those are different statements: one is "nobody has
	 * touched this", the other is "somebody removed every period", and quietly
	 * restoring 20 % over the second would charge VAT the operator had just
	 * deleted. An empty timeline covers no date at all, and every caller below
	 * treats an uncovered date as unknown rather than as zero.
	 *
	 * Dates are ISO, so they sort as strings and compare as strings. A period
	 * runs from its own `from` until the next period's `from`, which is why
	 * there is no end date: a shape with two ends can express a gap or an
	 * overlap, and neither is a thing a fiscal timeline is allowed to have.
	 */
	public static function merge_periods( mixed $stored ): array {
		if ( null === $stored || ! is_array( $stored ) ) {
			return self::default_periods();
		}

		$out = array();
		foreach ( $stored as $raw ) {
			if ( ! is_array( $raw ) ) {
				continue;
			}
			$from = self::iso_date( (string) ( $raw['from'] ?? '' ) );
			if ( '' === $from ) {
				continue;
			}
			$regime = (string) ( $raw['regime'] ?? '' );
			if ( self::FRANCHISE !== $regime && self::STANDARD !== $regime ) {
				continue;
			}
			$period = array(
				'from'   => $from,
				'regime' => $regime,
			);
			/*
			 * An explicit rate is accepted only on a standard period, and only
			 * when it is a real rate. It exists for the day a period is not at
			 * the shop's current standard rate; it is absent from everything
			 * shipped, so the standard rate still has exactly one home.
			 */
			if ( self::STANDARD === $regime && isset( $raw['rate'] ) && is_numeric( $raw['rate'] ) ) {
				$rate = (float) $raw['rate'];
				if ( $rate >= 0 && $rate < 1 ) {
					$period['rate'] = $rate;
				}
			}
			$out[ $from ] = $period;
		}

		ksort( $out );
		return array_values( $out );
	}

	/**
	 * The period in force on a date, or null when the timeline does not cover it.
	 *
	 * Null is a real answer and is never collapsed into "no VAT". A date before
	 * the first period is a date whose regime nobody has recorded, and charging
	 * or not charging on that basis is exactly the mistake constat 6 describes.
	 */
	public static function at( string $date, array $periods ): ?array {
		$date = self::iso_date( $date );
		if ( '' === $date ) {
			return null;
		}
		/*
		 * The LATEST period that has already started, scanned in full rather
		 * than stopped at the first miss. `merge_periods` sorts, but this is
		 * also called on lists that came straight from a test or a filter, and
		 * an early `break` would silently pick the wrong regime for an unsorted
		 * timeline instead of failing.
		 */
		$found = null;
		foreach ( $periods as $period ) {
			if ( ! isset( $period['from'] ) || $period['from'] > $date ) {
				continue;
			}
			if ( null === $found || $period['from'] > $found['from'] ) {
				$found = $period;
			}
		}
		return $found;
	}

	/**
	 * Everything a document needs to state about VAT on a given date.
	 *
	 * Returns `known => false` when the timeline does not reach that far, with a
	 * zero rate that no caller is allowed to charge on: `Cart` refuses the
	 * checkout and `Invoice` refuses the document rather than quietly issuing a
	 * VAT-free sale.
	 *
	 * @param array $pricing The price config, whose `vat_rate` is the shop's
	 *                       standard rate. Passed in rather than read, so this
	 *                       file adds no second copy of the rate.
	 */
	public static function regime( string $date, array $periods, array $pricing ): array {
		$period = self::at( $date, $periods );

		if ( null === $period ) {
			return array(
				'known'    => false,
				'regime'   => '',
				'rate'     => 0.0,
				'from'     => '',
				'mention'  => '',
			);
		}

		$franchise = self::FRANCHISE === $period['regime'];

		/*
		 * NO VAT NUMBER HERE, and that is a correction rather than an omission.
		 * A period used to carry one, and `Legal::fields()` carries one too, so
		 * the same fact had two homes on one settings screen: the invoice
		 * printed the identity's copy while `problems()` policed the period's,
		 * and an operator filling one saw the other still empty. The company's
		 * number belongs to the company, not to a fiscal period, so the identity
		 * owns it and this only says which regime is in force.
		 */
		return array(
			'known'    => true,
			'regime'   => $period['regime'],
			// A franchise period charges nothing, and that zero is the regime
			// itself rather than a rate somebody typed.
			'rate'     => $franchise ? 0.0 : (float) ( $period['rate'] ?? $pricing['vat_rate'] ),
			'from'     => $period['from'],
			'mention'  => $franchise ? self::MENTION_FRANCHISE : '',
		);
	}

	/**
	 * What is wrong with a timeline, in French, for the operator who can fix it.
	 *
	 * Reported rather than repaired. A timeline that does not cover today is a
	 * decision somebody made in the admin, and silently extending it backwards
	 * would be this plugin deciding the company's fiscal regime.
	 *
	 * @param string $today ISO date, passed in because this file calls no clock.
	 */
	public static function problems( array $periods, string $today ): array {
		$problems = array();

		if ( empty( $periods ) ) {
			$problems[] = 'Aucune période de TVA n’est enregistrée : la boutique ne peut donc pas dire sous quel régime elle vend, et le paiement est refusé tant que c’est le cas.';
			return $problems;
		}

		if ( null === self::at( $today, $periods ) ) {
			$problems[] = sprintf(
				'La première période de TVA commence le %s, après aujourd’hui. Aucune commande ne peut être facturée tant qu’aucune période ne couvre la date du jour.',
				self::fr_date( (string) min( array_column( $periods, 'from' ) ) )
			);
		}

		/*
		 * A SWITCH THAT HAS NOT HAPPENED YET IS WORTH SAYING OUT LOUD. For a
		 * supply of goods the tax becomes due at the DELIVERY, not at the
		 * invoice, so an order paid before a regime change and delivered after
		 * it needs a rectificative invoice (BOI-TVA-DECLA-40-10-20). Nothing
		 * here can decide that; what it can do is warn while there is still time
		 * to ask an accountant.
		 */
		foreach ( $periods as $period ) {
			if ( $period['from'] > $today ) {
				$problems[] = sprintf(
					'Un changement de régime est programmé au %s. Une commande payée avant et livrée après relève du régime de la livraison : ces commandes-là demandent une facture rectificative, et le site ne la produit pas.',
					self::fr_date( (string) $period['from'] )
				);
			}
		}

		return $problems;
	}

	/** "2026-08-18" or '' if it is not a real calendar date. */
	public static function iso_date( string $raw ): string {
		$raw = trim( $raw );
		if ( 1 !== preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $raw, $m ) ) {
			return '';
		}
		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ? $raw : '';
	}

	/** "18/08/2026", which is how a French document writes a date. */
	public static function fr_date( string $iso ): string {
		$iso = self::iso_date( $iso );
		return '' === $iso ? '' : substr( $iso, 8, 2 ) . '/' . substr( $iso, 5, 2 ) . '/' . substr( $iso, 0, 4 );
	}

	/**
	 * A VAT number, uppercased and stripped of the spaces a human types.
	 *
	 * NOT validated against VIES and not checked for a country's own key: this
	 * is OUR number, typed by the operator from a document, and refusing to
	 * store a number because our pattern is narrower than the EU's would be
	 * worse than storing what was typed. What must never happen is granting a
	 * customer an exemption on an unverified number, and that path does not
	 * exist here; see the note in Invoice.php.
	 */
	public static function vat_number( string $raw ): string {
		$clean = strtoupper( preg_replace( '/[^A-Za-z0-9]/', '', $raw ) ?? '' );
		return strlen( $clean ) > 20 ? substr( $clean, 0, 20 ) : $clean;
	}
}
