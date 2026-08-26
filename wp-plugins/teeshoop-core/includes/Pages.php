<?php
/**
 * The four pages a French shop must publish, and the one slug each of them has.
 *
 * WHY A CLASS FOR FOUR STRINGS. Because before this file there were three
 * places looking for a privacy notice and none of them agreed: the theme footer
 * looked up the slug `confidentialite`, `Consent::render()` looked up the same
 * slug independently, and WordPress's own `wp_page_for_privacy_policy` option
 * pointed at post 3, an English draft called « Privacy Policy » that WordPress
 * ships and nobody had touched. Three answers to one question, which is the
 * failure `CLAUDE.md` section 1 names. The slugs live here now and everything
 * asks.
 *
 * THE SLUGS ARE FRENCH AND THEY ARE NOT NEGOTIABLE ONCE PUBLISHED. A legal page
 * is linked from invoices, from e-mails and from the acknowledgement a customer
 * gave: changing `mentions-legales` to `mentions` later breaks every one of
 * those, silently, because a 404 does not report itself. They are treated as
 * frozen from the first publication.
 *
 * WHAT IS DELIBERATELY ABSENT. There is no `contact` slug. The footer already
 * looks for one and degrades by omitting the link, which is correct: a contact
 * page needs an address and a telephone number, both of which are question 17's
 * and neither of which anybody has. Inventing a page that says « contactez-nous »
 * with no way to do it would be worse than the gap.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Pages {

	public const MENTIONS       = 'mentions-legales';
	public const CGV            = 'cgv';
	public const CONFIDENTIALITE = 'confidentialite';
	public const ACCESSIBILITE  = 'accessibilite';

	/**
	 * Slug to title, in the order they belong in a footer.
	 *
	 * @return array<string,string>
	 */
	public static function all(): array {
		return array(
			self::MENTIONS        => 'Mentions légales',
			self::CGV             => 'Conditions générales de vente',
			self::CONFIDENTIALITE => 'Données personnelles',
			self::ACCESSIBILITE   => 'Accessibilité',
		);
	}

	/**
	 * Which of them are published right now, slug to permalink.
	 *
	 * PUBLISHED ONLY, like `Theme\page_url()`, and for the reason recorded
	 * there: a draft page linked from every page of the site is a 404 for every
	 * visitor and a working link for the logged-in editor who wrote it.
	 *
	 * @return array<string,string>
	 */
	public static function live(): array {
		$out = array();
		foreach ( array_keys( self::all() ) as $slug ) {
			$page = get_page_by_path( $slug );
			if ( $page instanceof \WP_Post && 'publish' === $page->post_status ) {
				$out[ $slug ] = (string) get_permalink( $page );
			}
		}
		return $out;
	}

	/** The ones that are missing, so a screen can name them. */
	public static function missing(): array {
		return array_values( array_diff( array_keys( self::all() ), array_keys( self::live() ) ) );
	}
}
