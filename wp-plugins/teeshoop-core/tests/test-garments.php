<?php
/**
 * The garment drawings, and the promise that they are the same object as the
 * centimetres printed beside them.
 *
 * WHAT IS ACTUALLY AT RISK HERE. The homepage draws the print zone ON a picture
 * of a t-shirt and captions it « 30,5 × 40,6 cm ». Those are two numbers from
 * two files: the rectangle comes from `garment-art.json` in the drawing's own
 * 800 x 800 coordinates, the caption comes from `garments.json` in
 * centimetres. If they ever stop describing the same rectangle, the page shows
 * a buyer a box, tells them how big it is, and is wrong, and nothing anywhere
 * else in the shop would notice. So the reconciliation is asserted here, on the
 * files that actually ship, with the conversion done the long way round.
 *
 * The refusals are asserted against records built by hand rather than by
 * corrupting the shipped file, which is why `art_of()` is a separate pure
 * method at all.
 *
 * @package Teeshoop\Core
 */

declare( strict_types = 1 );

// Command line only: this directory is served by URL.
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

require_once __DIR__ . '/../includes/Money.php';
require_once __DIR__ . '/../includes/Garments.php';

use Teeshoop\Core\Garments;

describe(
	'Garments::art, sur les fichiers réellement livrés',
	function (): void {

		it(
			'rend un dessin teintable pour les deux vêtements dessinés',
			function (): void {
				foreach ( array( 'tee', 'hoodie' ) as $garment ) {
					$art = Garments::art( $garment, 'front' );
					truthy( array() !== $art, "$garment a un dessin de devant" );
					truthy( str_contains( $art['body'], '__COLOR__' ), "$garment porte le jeton de teinte" );
					truthy( str_contains( $art['body'], 'viewBox="0 0 800 800"' ), "$garment est dans le repère attendu" );
					truthy( $art['pxPerInch'] > 0, "$garment a une échelle" );
				}
			}
		);

		it(
			'place le rectangle imprimable À L’INTÉRIEUR du dessin',
			function (): void {
				/*
				 * Un rectangle qui déborde du vêtement se dessinerait sur le
				 * fond de la page : la zone d'impression aurait l'air d'aller
				 * plus loin que le tissu.
				 */
				foreach ( array( 'tee', 'hoodie' ) as $garment ) {
					$rect = Garments::art( $garment, 'front' )['printAreaPx'];
					truthy( $rect['x'] >= 0 && $rect['y'] >= 0, "$garment : coin haut gauche dans le repère" );
					truthy( $rect['x'] + $rect['w'] <= 800, "$garment : bord droit dans le repère" );
					truthy( $rect['y'] + $rect['h'] <= 800, "$garment : bord bas dans le repère" );
				}
			}
		);

		it(
			'décrit le MÊME rectangle que les centimètres publiés à la taille tarifée',
			function (): void {
				/*
				 * LE CONTRÔLE QUI JUSTIFIE CE FICHIER.
				 *
				 * `printAreaPx` est en pixels du dessin, `area_by_size()` est
				 * en centimètres, et la seule chose qui les relie est
				 * `pxPerInch`. On refait le trajet complet, px -> pouces -> cm,
				 * et on exige l'égalité à la résolution que la boutique publie
				 * (un dixième de centimètre, ce que `fmtCm` affiche).
				 */
				foreach ( array( 'tee', 'hoodie' ) as $garment ) {
					$art    = Garments::art( $garment, 'front' );
					$priced = Garments::priced_size( $garment );
					$areas  = Garments::area_by_size( $garment, 'front' );
					truthy( isset( $areas[ $priced ] ), "$garment : la taille tarifée est mesurée" );

					$w_cm = $art['printAreaPx']['w'] / $art['pxPerInch'] * 2.54;
					$h_cm = $art['printAreaPx']['h'] / $art['pxPerInch'] * 2.54;

					near( round( $w_cm, 1 ), (float) $areas[ $priced ]['wCm'], 0.05, "$garment : largeur" );
					near( round( $h_cm, 1 ), (float) $areas[ $priced ]['hCm'], 0.05, "$garment : hauteur" );
				}
			}
		);

		it(
			'ne prête jamais le dessin d’un autre vêtement',
			function (): void {
				eq( Garments::art( 'custom', 'front' ), array(), 'custom n’a pas de dessin' );
				eq( Garments::art( 'kimono', 'front' ), array(), 'un vêtement inconnu n’en a pas non plus' );
				eq( Garments::art( 'tee', 'capuche' ), array(), 'une face inconnue n’est pas remplacée par le devant' );
			}
		);
	}
);

describe(
	'Garments::same_back, la face qu’on a le droit de nommer',
	function (): void {

		it(
			'dit vrai sur le t-shirt et FAUX sur le sweat, parce que c’est la mesure',
			function (): void {
				/*
				 * LE CONTRÔLE QUI AURAIT ATTRAPÉ LE DÉFAUT DU 9 SEPTEMBRE 2026.
				 *
				 * La page d'accueil imprimait le rectangle du DEVANT et le
				 * légendait « devant et dos » sans condition. C'était vrai du
				 * t-shirt, donc vert sur la boutique de test, et faux du sweat,
				 * dont le dos accepte 5,1 cm de plus. Les deux vêtements sont
				 * ici, et le second est celui qui compte.
				 */
				eq( Garments::same_back( 'tee', Garments::priced_size( 'tee' ) ), true, 'le tee a le même rectangle des deux côtés' );
				eq( Garments::same_back( 'hoodie', Garments::priced_size( 'hoodie' ) ), false, 'le sweat non' );

				// Et la raison, chiffrée, pour que l'échec dise ce qu'il a vu.
				$devant = Garments::area_by_size( 'hoodie', 'front' )[ Garments::priced_size( 'hoodie' ) ];
				$dos    = Garments::area_by_size( 'hoodie', 'back' )[ Garments::priced_size( 'hoodie' ) ];
				truthy(
					(float) $dos['hCm'] > (float) $devant['hCm'],
					sprintf( 'le dos du sweat est plus haut : %s contre %s', $dos['hCm'], $devant['hCm'] )
				);
			}
		);

		it(
			'refuse plutôt que de supposer quand il n’a pas pu mesurer',
			function (): void {
				eq( Garments::same_back( 'tee', 'XXXL' ), false, 'une taille qui n’existe pas' );
				eq( Garments::same_back( 'kimono', 'M' ), false, 'un vêtement inconnu' );
				eq( Garments::same_back( 'custom', 'M' ), false, 'un vêtement sans mesure publiée' );
				eq( Garments::same_back( '', 'M' ), false, 'pas de vêtement du tout' );
				eq( Garments::same_back( 'tee', '' ), false, 'pas de taille du tout' );
			}
		);

		it(
			'est vrai à TOUTES les tailles du tee, pas seulement à celle du tarif',
			function (): void {
				// La graduation applique le même facteur aux deux faces ; si ce
				// n'était plus le cas, une fiche produit le dirait aussi.
				foreach ( array_keys( Garments::area_by_size( 'tee', 'front' ) ) as $taille ) {
					eq( Garments::same_back( 'tee', (string) $taille ), true, "tee en $taille" );
				}
			}
		);
	}
);

describe(
	'Garments::art_of, les refus',
	function (): void {

		/** Un enregistrement valable, que chaque cas ci-dessous abîme d’une seule façon. */
		$sain = static function (): array {
			return array(
				'id'        => 'tee',
				'pxPerInch' => 25.0,
				'widthIn'   => 21.5,
				'sides'     => array(
					array(
						'side'        => 'front',
						'body'        => '<svg viewBox="0 0 800 800"><path fill="__COLOR__" d="M0 0h1v1z"/></svg>',
						/*
						 * DES COORDONNÉES VOLONTAIREMENT SYNTHÉTIQUES.
						 *
						 * Le vrai rectangle du tee commence à x = 250, et 250 est
						 * aussi le seuil de quantité au-delà duquel une commande
						 * part en devis (H-Q02). Le registre des hypothèses
						 * chasse ce littéral pour repérer une seconde copie
						 * d'une valeur commerciale, et il ne peut pas savoir que
						 * celui-ci est une abscisse. Un montage qui reprend par
						 * hasard une constante du métier est de toute façon un
						 * montage trompeur : celui-ci n'imite aucune valeur
						 * réelle, et les contrôles au-dessus vérifient déjà le
						 * vrai dessin sur le vrai fichier.
						 */
						'printAreaPx' => array(
							'x' => 260,
							'y' => 200,
							'w' => 300,
							'h' => 400,
						),
					),
				),
			);
		};

		it(
			'accepte l’enregistrement sain, sinon les refus ci-dessous ne prouveraient rien',
			function () use ( $sain ): void {
				// Une porte qui refuse tout est un mur, pas une porte.
				$art = Garments::art_of( $sain(), 'front' );
				truthy( array() !== $art, 'le cas légitime passe' );
				eq( $art['printAreaPx']['w'], 300.0, 'largeur du rectangle' );
				eq( $art['pxPerInch'], 25.0, 'échelle' );
			}
		);

		it(
			'refuse un dessin qui a perdu son jeton de teinte',
			function () use ( $sain ): void {
				$abime = $sain();
				$abime['sides'][0]['body'] = str_replace( '__COLOR__', '#cccccc', $abime['sides'][0]['body'] );
				eq( Garments::art_of( $abime, 'front' ), array(), 'un vêtement qui ne peut plus changer de couleur' );
			}
		);

		it(
			'refuse un dessin vide',
			function () use ( $sain ): void {
				$abime = $sain();
				$abime['sides'][0]['body'] = '';
				eq( Garments::art_of( $abime, 'front' ), array(), 'pas de dessin du tout' );
			}
		);

		it(
			'refuse un vêtement sans échelle, parce que le rectangle ne serait plus une mesure',
			function () use ( $sain ): void {
				$abime = $sain();
				$abime['pxPerInch'] = 0;
				eq( Garments::art_of( $abime, 'front' ), array(), 'sans pxPerInch, aucun centimètre n’est dérivable' );
			}
		);

		it(
			'refuse un rectangle imprimable plat',
			function () use ( $sain ): void {
				foreach ( array( 'w', 'h' ) as $cote ) {
					$abime = $sain();
					$abime['sides'][0]['printAreaPx'][ $cote ] = 0;
					eq( Garments::art_of( $abime, 'front' ), array(), "un rectangle sans $cote" );
				}
			}
		);

		it(
			'refuse un enregistrement sans faces',
			function () use ( $sain ): void {
				$abime = $sain();
				$abime['sides'] = array();
				eq( Garments::art_of( $abime, 'front' ), array(), 'aucune face' );
			}
		);
	}
);
