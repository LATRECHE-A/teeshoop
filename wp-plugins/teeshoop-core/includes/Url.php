<?php
/**
 * L'origine d'une URL, écrite une seule fois.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * Il y en avait TROIS copies, mot pour mot, et la passe adversariale du
 * 5 septembre 2026 a nommé ce qu'elles coûtaient :
 *
 *   `Settings::studio_origin()`   avec une liste blanche http/https
 *   `Csp::origin_of()`            SANS cette liste
 *   `Editeur::origine_worker()`   avec
 *
 * Les trois répondent aujourd'hui la même chose, donc `connect-src` autorise
 * exactement l'adresse que l'éditeur appelle. Le jour où l'une gagne une
 * normalisation que l'autre n'a pas (le port par défaut est le cas évident,
 * `https://x:443` contre `https://x`), la politique de sécurité refuse un dépôt
 * qu'elle croit autoriser, et le symptôme est celui que
 * `src/lib/teeshoop/upload.ts` décrit : un achat qui s'arrête une étape avant le
 * panier avec un `TypeError`. Masqué aujourd'hui parce que la politique est en
 * `Report-Only` ; le jour où elle est appliquée, ça devient une panne de vente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE FONCTION NE FAIT PAS
 *
 * Elle ne « répare » rien. Une URL sans schéma ou sans hôte rend la chaîne
 * vide, et un schéma autre que http ou https aussi : `javascript:`,
 * `data:` et `file:` n'ont pas d'origine au sens où une comparaison en a besoin,
 * et une valeur qu'on ne sait pas lire doit refuser plutôt que produire quelque
 * chose de plausible. Le port par défaut n'est PAS retiré, parce que
 * `wp_parse_url` ne le pose que s'il était écrit : ce qui compte est que les
 * trois lecteurs fassent la même chose, pas laquelle.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || exit;

final class Url {

	/** `scheme://host[:port]` d'une URL configurée, ou '' si ce n'en est pas une. */
	public static function origin_of( string $url ): string {
		$url = trim( $url );
		if ( '' === $url ) {
			return '';
		}
		$parts = wp_parse_url( $url );
		if ( empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
			return '';
		}
		$scheme = strtolower( (string) $parts['scheme'] );
		if ( 'http' !== $scheme && 'https' !== $scheme ) {
			return '';
		}
		$origin = $scheme . '://' . strtolower( (string) $parts['host'] );
		if ( ! empty( $parts['port'] ) ) {
			$origin .= ':' . (int) $parts['port'];
		}
		return $origin;
	}
}
