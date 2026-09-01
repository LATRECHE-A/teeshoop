<?php
/**
 * The other identity a French site must publish: its host's, and the person
 * responsible for what it publishes.
 *
 * WHY THIS IS NOT IN `Legal`. `Legal` answers "who is the seller", and that
 * answer gates an invoice: an incomplete one refuses a document in production.
 * These fields gate nothing fiscal. They are article 6 III of the LCEN, which
 * asks a site to publish the name and address of whoever stores it, and article
 * 6 III 1 a, which asks for a named directeur de la publication. Different law,
 * different consequence, different home. They share the option, because they are
 * typed on the same screen and an operator filling in one will fill in the other.
 *
 * EVERY DEFAULT IS THE EMPTY STRING, for the reason `Legal` gives at length: a
 * plausible placeholder ships. That applies here with a twist worth writing down,
 * because it is the trap this file exists to avoid.
 *
 * THE HOST'S IDENTITY LOOKS DERIVABLE AND IS NOT. The repository knows the
 * server (`ascaphus.o2switch.net`), its IP and the cPanel account. None of those
 * is a company name and none is a postal address. o2switch publishes its own
 * legal identity on its own site, so this is a fact somebody can go and READ, in
 * five minutes, from the hosting contract or from o2switch's own mentions
 * légales. It is not a fact to reconstruct from a hostname, and writing a
 * plausible Clermont-Ferrand address here would be exactly the mistake
 * `Legal.php` was written to prevent. `ACCES-REQUIS.md` asks for it.
 *
 * THE PUBLICATION DIRECTOR IS THE ASSOCIATE'S TO NAME. It is the legal
 * representative by default, and we do not know who that is either: question 17
 * asks for the company and question 56 now asks for this.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Host {

	/**
	 * The host's fields, in the order the page prints them.
	 *
	 * @return array<string,string>
	 */
	public static function fields(): array {
		return array(
			'hebergeur_nom'     => 'Nom ou raison sociale',
			'hebergeur_adresse' => 'Adresse',
			'hebergeur_ville'   => 'Code postal et ville',
			'hebergeur_tel'     => 'Téléphone',
		);
	}

	/** The publisher's own contact fields, which are not the seller's identity. */
	public static function contact_fields(): array {
		return array(
			'directeur_publication' => 'Directeur de la publication',
			'contact_email'         => 'Adresse de contact',
			'contact_tel'           => 'Téléphone',
		);
	}

	/** Everything this file owns, merged over empty defaults. Never a placeholder. */
	public static function all(): array {
		$defaults = array_fill_keys(
			array_merge( array_keys( self::fields() ), array_keys( self::contact_fields() ) ),
			''
		);
		$stored = get_option( OPTION_LEGAL, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}
		$merged = array_merge( $defaults, array_intersect_key( $stored, $defaults ) );
		return array_map( static fn( $v ): string => trim( (string) $v ), $merged );
	}

	/** The host block alone. */
	public static function identity(): array {
		return array_intersect_key( self::all(), self::fields() );
	}

	public static function publication_director(): string {
		return self::all()['directeur_publication'];
	}

	public static function contact_email(): string {
		return self::all()['contact_email'];
	}

	public static function telephone(): string {
		return self::all()['contact_tel'];
	}

	/**
	 * Which of these are still empty.
	 *
	 * SEPARATE FROM `Legal::missing()` and deliberately so: these do not refuse
	 * an invoice. They make the mentions légales incomplete, which is a different
	 * failure with a different remedy, and merging the two lists would mean an
	 * unpublished telephone number blocking a customer's invoice.
	 *
	 * TWO FIELDS SHARE A LABEL, and a list of labels alone cannot tell them
	 * apart: the host's telephone and the publisher's contact telephone are both
	 * « Téléphone ». On the mentions légales page they sit under their own
	 * headings and the context does the work; in a flat list, which is what the
	 * launch gate prints, the same word appeared twice and read as a bug. So a
	 * label that is not unique carries the block it belongs to.
	 *
	 * @return string[] the French labels, in order
	 */
	public static function missing(): array {
		$all    = self::all();
		$host   = self::fields();
		$labels = $host + self::contact_fields();
		$seen   = array_count_values( array_values( $labels ) );
		$out    = array();
		foreach ( $labels as $key => $label ) {
			if ( '' !== ( $all[ $key ] ?? '' ) ) {
				continue;
			}
			$out[] = ( $seen[ $label ] ?? 0 ) > 1
				? sprintf(
					/* translators: 1: which block the field belongs to, 2: the field's own label. */
					__( '%1$s : %2$s', 'teeshoop' ),
					isset( $host[ $key ] ) ? __( 'hébergeur', 'teeshoop' ) : __( 'éditeur', 'teeshoop' ),
					$label
				)
				: $label;
		}
		return $out;
	}
}
