<?php
/**
 * Les modèles sauvegardés : cinq créations par compte client, réappliquées sur
 * n'importe quel vêtement du même type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'EST UN MODÈLE
 *
 * Une création déjà déposée sur le Worker (son identifiant, le même que celui
 * qu'une ligne de panier porte), un nom choisi par le client, le vêtement pour
 * lequel elle a été faite, et l'adresse de son aperçu. Rien d'autre : les
 * calques et les images restent sur le Worker, là où la commande les lirait.
 *
 * DANS LE COMPTE CLIENT, et pas dans le navigateur. « Cinq par utilisateur » et
 * un modèle qu'on retrouve sur un autre appareil supposent un compte ; un
 * visiteur non connecté est invité à se connecter plutôt que de voir ses modèles
 * disparaître avec son stockage local. Décision de l'utilisateur, 26/09/2026.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI WORDPRESS RELIT LE DOCUMENT AU LIEU DU NAVIGATEUR
 *
 * `worker/design.ts` sert le document et les images d'une création à
 * l'administration seulement : ce sont les originaux d'un client, qui peuvent
 * être la photographie d'une personne, et l'identifiant seul ne doit pas suffire
 * à les lire. La boutique, elle, sait qui est connecté. Elle vérifie que le
 * modèle appartient au client, puis relit le document avec le jeton serveur
 * (`Nest::token()`, le même que le calcul du métrage) et le lui rend, à lui seul.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DONNÉES PERSONNELLES
 *
 * Un modèle relie une création à une identité, ce qu'une création jamais
 * commandée ne fait pas. Il est donc au registre (`Privacy::registre()`), dans
 * l'export et dans l'effacement (`Privacy::export_modeles()`,
 * `Privacy::erase_modeles()`). Et le jour où `POST /api/design/reap` sera appelé
 * par une tâche planifiée, la liste qu'il garde devra contenir `tous_les_ids()`.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

namespace Teeshoop\Core;

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

final class Modeles {

	/** La méta utilisateur qui porte la liste. */
	public const META = '_teeshoop_modeles';

	/** Combien de modèles un compte peut garder. Décision de l'utilisateur. */
	public const MAX = 5;

	/** La longueur d'un nom, en caractères. Assez pour « Club de foot 2026, dos ». */
	public const NOM_MAX = 60;

	/** Au-delà, une image renvoyée par le Worker est refusée plutôt que relayée. */
	private const OCTETS_MAX = 20 * 1024 * 1024;

	// ── Les règles, sans WordPress ───────────────────────────────────────────

	/**
	 * Le type d'un vêtement, c'est-à-dire ce sur quoi un modèle se réapplique.
	 *
	 * Le t-shirt et le sweat sont deux hauts : leurs faces portent les mêmes noms
	 * (devant, dos, manche) et l'atelier mesure chaque modèle réappliqué contre la
	 * zone du vêtement ouvert. Le jour où un bas, une casquette, une cagoule, un
	 * masque ou un bandana entre dans l'atelier, il ajoute sa ligne ici. Un
	 * vêtement que cette table ne connaît pas est son propre type, ce qui est le
	 * sens prudent : un modèle ne passe pas d'un vêtement inconnu à un autre.
	 */
	public static function famille( string $garment ): string {
		$familles = array(
			'tee'    => 'haut',
			'hoodie' => 'haut',
		);
		return $familles[ $garment ] ?? $garment;
	}

	/**
	 * La liste stockée, relue comme une donnée venue d'ailleurs. PURE.
	 *
	 * Une méta est modifiable par un autre code ou à la main ; une entrée qui n'a
	 * pas la forme attendue est ignorée plutôt que servie.
	 *
	 * @return list<array{id:string,nom:string,garment:string,apercu:string,cree:string}>
	 */
	public static function normaliser( mixed $brut ): array {
		$sortie = array();
		foreach ( is_array( $brut ) ? $brut : array() as $m ) {
			if ( ! is_array( $m ) || ! Design::valid_id( (string) ( $m['id'] ?? '' ) ) ) {
				continue;
			}
			$sortie[] = array(
				'id'      => (string) $m['id'],
				'nom'     => mb_substr( trim( (string) ( $m['nom'] ?? '' ) ), 0, self::NOM_MAX ),
				'garment' => (string) ( $m['garment'] ?? '' ),
				'apercu'  => Design::normalise_preview( (string) ( $m['apercu'] ?? '' ) ),
				'cree'    => (string) ( $m['cree'] ?? '' ),
			);
		}
		return $sortie;
	}

	/**
	 * Ajouter un modèle, ou dire pourquoi c'est impossible. PURE.
	 *
	 * La même création enregistrée deux fois change de nom au lieu de prendre une
	 * seconde place : un double clic ne doit pas consommer deux des cinq places.
	 *
	 * @param list<array<string,string>> $liste
	 * @param array<string,string>       $modele
	 * @return list<array<string,string>>|string la nouvelle liste, ou le code du refus
	 */
	public static function ajouter( array $liste, array $modele ): array|string {
		foreach ( $liste as $i => $m ) {
			if ( $m['id'] === $modele['id'] ) {
				$liste[ $i ]['nom'] = $modele['nom'];
				return $liste;
			}
		}
		if ( count( $liste ) >= self::MAX ) {
			return 'plein';
		}
		array_unshift( $liste, $modele );
		return $liste;
	}

	/**
	 * La preuve de création d'une création. PURE.
	 *
	 * L'IDENTIFIANT NE SUFFIT PAS. Il circule (lien de partage, adresse publique
	 * de l'aperçu), et un modèle relaie au compte qui l'a enregistré les images
	 * ORIGINALES de la création, que le Worker réserve à l'administration. Sans
	 * cette preuve, un client qui connaîtrait l'identifiant d'un autre
	 * enregistrerait sa création et lirait ses images à travers la boutique.
	 *
	 * Le Worker la rend au seul navigateur qui dépose (`ownerProof` dans
	 * `worker/auth.ts`) : HMAC-SHA256 de `teeshoop-modele:<id>` sous le jeton
	 * partagé. La boutique la recalcule ici sans appel réseau. Le même vecteur est
	 * vérifié des deux côtés (`tests/test-modeles.php`, `worker/design.test.ts`).
	 */
	public static function preuve( string $design_id, string $jeton ): string {
		return '' === $jeton ? '' : hash_hmac( 'sha256', 'teeshoop-modele:' . $design_id, $jeton );
	}

	/**
	 * Les modèles qui se réappliquent sur ce vêtement. PURE.
	 *
	 * @param list<array<string,string>> $liste
	 * @return list<array<string,string>>
	 */
	public static function pour( array $liste, string $garment ): array {
		if ( '' === $garment ) {
			return $liste;
		}
		$famille = self::famille( $garment );
		return array_values( array_filter( $liste, static fn( array $m ): bool => self::famille( $m['garment'] ) === $famille ) );
	}

	// ── Le compte ────────────────────────────────────────────────────────────

	/** @return list<array<string,string>> */
	public static function lister( int $user_id, string $garment = '' ): array {
		if ( $user_id <= 0 ) {
			return array();
		}
		return self::pour( self::normaliser( get_user_meta( $user_id, self::META, true ) ), $garment );
	}

	public static function possede( int $user_id, string $design_id ): bool {
		foreach ( self::lister( $user_id ) as $m ) {
			if ( $m['id'] === $design_id ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Enregistrer une création déjà déposée sur le Worker.
	 *
	 * LE VÊTEMENT VIENT DU WORKER, pas du navigateur : le manifeste de la
	 * création dit pour quel vêtement elle a été faite, et c'est ce qui décide
	 * sur quoi elle se réapplique. Une création que le Worker ne confirme pas
	 * n'est pas enregistrée, pour la même raison qu'elle ne l'est pas au panier :
	 * « nous n'avons pas pu demander » n'est pas « elle existe ».
	 *
	 * ET SEULEMENT SUR LA PREUVE DE CRÉATION (`preuve()`), avant tout appel au
	 * Worker : sans elle, rien n'est enregistré, pas même un renommage.
	 *
	 * @return list<array<string,string>>|\WP_Error
	 */
	public static function enregistrer( int $user_id, string $design_id, string $nom, string $preuve ): array|\WP_Error {
		$nom = mb_substr( trim( sanitize_text_field( $nom ) ), 0, self::NOM_MAX );
		if ( '' === $nom ) {
			return new \WP_Error( 'teeshoop_modele_nom', __( 'Donnez un nom à ce modèle pour le retrouver.', 'teeshoop' ), array( 'status' => 400 ) );
		}
		if ( ! Design::valid_id( $design_id ) ) {
			return new \WP_Error( 'teeshoop_modele_id', __( 'Cette création n’a pas été reconnue. Rechargez la page, puis réessayez.', 'teeshoop' ), array( 'status' => 400 ) );
		}
		$attendue = self::preuve( $design_id, Nest::token() );
		if ( '' === $attendue || ! hash_equals( $attendue, $preuve ) ) {
			return new \WP_Error( 'teeshoop_modele_preuve', __( 'Seule une création faite dans cet atelier, depuis ce navigateur, peut devenir un de vos modèles. Rien n’a été sauvegardé.', 'teeshoop' ), array( 'status' => 403 ) );
		}

		$verif = Design::verify( $design_id );
		if ( empty( $verif['ok'] ) ) {
			return new \WP_Error( 'teeshoop_modele_absent', __( 'Nous n’avons pas pu confirmer que cette création est bien enregistrée. Rien n’a été sauvegardé. Réessayez dans un instant.', 'teeshoop' ), array( 'status' => 502 ) );
		}
		$garment = (string) ( $verif['meta']['garment'] ?? '' );
		if ( '' === $garment ) {
			return new \WP_Error( 'teeshoop_modele_vetement', __( 'Cette création ne dit pas pour quel vêtement elle a été faite. Rien n’a été sauvegardé.', 'teeshoop' ), array( 'status' => 422 ) );
		}

		$liste = self::ajouter(
			self::normaliser( get_user_meta( $user_id, self::META, true ) ),
			array(
				'id'      => $design_id,
				'nom'     => $nom,
				'garment' => $garment,
				'apercu'  => (string) ( $verif['meta']['preview'] ?? '' ),
				'cree'    => gmdate( 'c' ),
			)
		);
		if ( 'plein' === $liste ) {
			return new \WP_Error(
				'teeshoop_modele_plein',
				sprintf(
					/* translators: %d: how many saved designs an account may keep. */
					__( 'Vous avez déjà %d modèles. Supprimez-en un pour enregistrer celui-ci.', 'teeshoop' ),
					self::MAX
				),
				array( 'status' => 409 )
			);
		}
		update_user_meta( $user_id, self::META, $liste );
		return $liste;
	}

	/** @return list<array<string,string>> ce qui reste */
	public static function supprimer( int $user_id, string $design_id ): array {
		$liste = array_values(
			array_filter(
				self::normaliser( get_user_meta( $user_id, self::META, true ) ),
				static fn( array $m ): bool => $m['id'] !== $design_id
			)
		);
		if ( array() === $liste ) {
			delete_user_meta( $user_id, self::META );
		} else {
			update_user_meta( $user_id, self::META, $liste );
		}
		return $liste;
	}

	/**
	 * Tous les identifiants de création que des comptes gardent comme modèles.
	 * Ce qu'une purge de rétention doit ajouter à sa liste « keep ».
	 *
	 * @return list<string>
	 */
	public static function tous_les_ids(): array {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$lignes = (array) $wpdb->get_col( $wpdb->prepare( "SELECT meta_value FROM {$wpdb->usermeta} WHERE meta_key = %s", self::META ) );
		$ids    = array();
		foreach ( $lignes as $brut ) {
			foreach ( self::normaliser( maybe_unserialize( $brut ) ) as $m ) {
				$ids[ $m['id'] ] = true;
			}
		}
		return array_keys( $ids );
	}

	// ── Le Worker ────────────────────────────────────────────────────────────

	/**
	 * Le document d'une création, relu sur le Worker avec le jeton serveur.
	 *
	 * @return array<string,mixed>|\WP_Error
	 */
	public static function document( string $design_id ): array|\WP_Error {
		$reponse = self::worker( '/r2/design/' . rawurlencode( $design_id ) . '/design.json' );
		if ( is_wp_error( $reponse ) ) {
			return $reponse;
		}
		$doc = json_decode( (string) wp_remote_retrieve_body( $reponse ), true );
		if ( ! is_array( $doc ) || ! isset( $doc['layers'] ) || ! is_array( $doc['layers'] ) ) {
			return new \WP_Error( 'teeshoop_modele_illisible', __( 'Ce modèle n’a pas pu être relu. Il n’a pas été modifié.', 'teeshoop' ), array( 'status' => 502 ) );
		}
		return $doc;
	}

	/**
	 * Une image d'une création, relue sur le Worker. PNG ou JPEG seulement, qui
	 * sont les deux formats que le Worker accepte au dépôt.
	 *
	 * @return array{type:string,octets:string}|\WP_Error
	 */
	public static function fichier( string $design_id, string $asset ): array|\WP_Error {
		$reponse = self::worker( '/r2/design/' . rawurlencode( $design_id ) . '/assets/' . rawurlencode( $asset ) );
		if ( is_wp_error( $reponse ) ) {
			return $reponse;
		}
		$octets = (string) wp_remote_retrieve_body( $reponse );
		$type   = str_starts_with( $octets, "\x89PNG\r\n\x1a\n" ) ? 'image/png' : ( str_starts_with( $octets, "\xff\xd8\xff" ) ? 'image/jpeg' : '' );
		if ( '' === $type || strlen( $octets ) > self::OCTETS_MAX ) {
			return new \WP_Error( 'teeshoop_modele_image', __( 'Une image de ce modèle n’a pas pu être relue.', 'teeshoop' ), array( 'status' => 502 ) );
		}
		return array(
			'type'   => $type,
			'octets' => $octets,
		);
	}

	/** Un GET authentifié sur le Worker, qui refuse tout ce qui n'est pas un 200. */
	private static function worker( string $chemin ): array|\WP_Error {
		$base  = Settings::get( 'worker_url' );
		$jeton = Nest::token();
		if ( '' === $base || '' === $jeton ) {
			return new \WP_Error( 'teeshoop_modele_worker', __( 'Les modèles ne peuvent pas être relus pour le moment : le service qui héberge les créations n’est pas configuré.', 'teeshoop' ), array( 'status' => 503 ) );
		}
		$reponse = wp_remote_get(
			rtrim( $base, '/' ) . $chemin,
			array(
				'timeout'     => 15,
				'redirection' => 0,
				'headers'     => array( 'authorization' => 'Bearer ' . $jeton ),
			)
		);
		if ( is_wp_error( $reponse ) || 200 !== (int) wp_remote_retrieve_response_code( $reponse ) ) {
			return new \WP_Error( 'teeshoop_modele_worker', __( 'Ce modèle n’a pas pu être relu. Réessayez dans un instant.', 'teeshoop' ), array( 'status' => 502 ) );
		}
		return $reponse;
	}
}
