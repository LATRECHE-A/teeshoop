<?php
/**
 * Le gradient d'impression vérifié contre la série du VRAI vêtement.
 *
 * Ce que ce fichier tient, et pourquoi il est ici plutôt que dans une suite pure :
 * `Design::unprintable_sizes` refuse une taille dont le marquage, une fois gradé,
 * ne tient plus sur le film. Le verdict dépend du format de feuille du
 * fournisseur, qui vit dans une option WordPress, donc il n'existe que dans un
 * vrai WordPress.
 *
 * LE DÉFAUT QUE CETTE SUITE EMPÊCHE DE REVENIR. Jusqu'au 5 septembre 2026 le
 * studio et la boutique gradaient tous deux par `data/garments.json`, dérivé de
 * la charte du Stanley/Stella. Le studio grade désormais par la série du
 * fabricant quand la boutique en fournit une, et les deux ne montent pas de la
 * même façon : sur le Gildan Heavy Cotton, le rapport 3XL/M vaut 1,400 chez le
 * fabricant contre 1,231 dans `garments.json`. Une boutique restée sur l'ancien
 * rapport vérifierait le placement d'une pièce 14 % plus petite que celle que
 * l'atelier découpera, et vendrait un 3XL que le nid refuserait ensuite.
 *
 * Lancée depuis integration.php, qui possède l'amorçage.
 *
 * @package Teeshoop\Core
 */

/* LIGNE DE COMMANDE UNIQUEMENT. Voir run.php. */
if ( 'cli' !== PHP_SAPI ) {
	http_response_code( 404 );
	exit( 1 );
}

use Teeshoop\Core\Design;
use Teeshoop\Core\Garments;

/**
 * Le Gildan Heavy Cotton 18009, demi-poitrine à plat en centimètres.
 *
 * Lue sur la fiche du fournisseur et importée dans la boutique : c'est la série
 * que `_teeshoop_demi_poitrine` porte réellement sur ce produit. Sa fiche est en
 * pouces, d'où les décimales.
 *
 * @return array<string,float>
 */
function ts_gradient_gildan(): array {
	return array(
		'S'   => 45.72,
		'M'   => 50.8,
		'L'   => 55.88,
		'XL'  => 60.96,
		'2XL' => 66.04,
		'3XL' => 71.12,
	);
}

/**
 * Une face dont le marquage occupe presque toute la zone imprimable.
 *
 * Presque, et pas tout : le but est une pièce qui TIENT sur le film au rapport
 * du studio et qui n'y tient plus au rapport du fabricant. Une pièce déjà trop
 * grande ne dirait rien, et une petite non plus.
 *
 * @param float $w_cm Largeur de la pièce à la taille tarifée.
 * @param float $h_cm Hauteur de la pièce à la taille tarifée.
 * @return array<string,mixed>
 */
function ts_gradient_side( float $w_cm, float $h_cm ): array {
	return array(
		'id'         => 'front',
		'area_sq_cm' => $w_cm * $h_cm,
		'pieces'     => array(
		array(
			'id'   => 'p1',
			'w_cm' => $w_cm,
			'h_cm' => $h_cm,
		),
		),
	);
}

function ts_gradient_suite(): void {
	echo "\033[2mLe gradient : la série du fabricant décide du placement\033[0m\n";

	ts_it( 'grade par le fabricant et non par garments.json', function () {
		/*
		 * La preuve est faite sur le VERDICT et pas sur un facteur interne,
		 * parce que c'est le verdict qui refuse une vente. La largeur est
		 * choisie pour tomber entre les deux rapports : au rapport de
		 * `garments.json` la pièce tient sur la feuille, au rapport du
		 * fabricant elle n'y tient plus.
		 */
		$priced = Garments::priced_size( 'tee' );
		ts_eq( $priced, 'M', 'la taille tarifée du t-shirt' );

		$chart = ts_gradient_gildan();
		$k_fab = $chart['3XL'] / $chart['M'];

		$by      = Garments::area_by_size( 'tee', 'front' );
		$k_json  = (float) $by['3XL']['wCm'] / (float) $by['M']['wCm'];
		$ecart   = $k_fab / $k_json;
		echo sprintf(
			"      rapport 3XL/M : fabricant %.4f, garments.json %.4f, ecart %.1f %%\n",
			$k_fab,
			$k_json,
			( $ecart - 1 ) * 100
		);
		ts_assert( $k_fab > $k_json * 1.10, 'les deux rapports diffèrent de plus de dix pour cent' );

		/*
		 * LE CÔTÉ COURT DU FILM, pris dans la configuration réelle plutôt
		 * qu'écrit en dur : le test suit un changement de fournisseur au lieu
		 * de porter un nombre qui deviendrait faux en silence.
		 *
		 * La pièce est CARRÉE, pour que `Cost::fits_sheet` se réduise à « le
		 * côté tient-il dans la largeur ». Une pièce rectangulaire pourrait
		 * basculer sur la feuille et le test mesurerait la rotation au lieu
		 * de la gradation.
		 */
		$film  = (array) ( \Teeshoop\Core\Costing::config()['film'] ?? array() );
		$court = min( (float) ( $film['width_cm'] ?? 0 ), (float) ( $film['max_length_cm'] ?? 0 ) );
		ts_assert( $court > 0, 'le format de feuille est lisible dans la configuration' );

		// Entre les deux rapports : tient au rapport de garments.json, dépasse
		// à celui du fabricant.
		$w    = ( $court / $k_fab + $court / $k_json ) / 2;
		$side = ts_gradient_side( $w, $w );
		echo sprintf(
			"      piece %.2f cm de cote a la taille tarifee ; %.2f cm en 3XL selon garments.json, %.2f cm selon le fabricant, feuille %.2f cm\n",
			$w,
			$w * $k_json,
			$w * $k_fab,
			$court
		);

		$grid = array( 'M' => 1, '3XL' => 1 );

		$sans = Design::unprintable_sizes( 'tee', array( $side ), $grid );
		$avec = Design::unprintable_sizes( 'tee', array( $side ), $grid, $chart );

		ts_eq( $sans, array(), 'sans la série, garments.json accepte le 3XL' );
		ts_eq( $avec, array( '3XL' ), 'avec la série du fabricant, le 3XL est refusé et nommé' );
		} );

	ts_it( 'ne refuse jamais la taille tarifée elle-même', function () {
		// Le facteur y vaut un par construction ; une suite qui refuserait la
		// taille de référence refuserait toute commande.
		$side = ts_gradient_side( 25.0, 30.0 );
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( 'M' => 4 ), ts_gradient_gildan() ),
			array(),
			'la taille tarifée passe'
		);
		} );

	ts_it( 'refuse une taille que la série du fabricant ne porte pas', function () {
		/*
		 * « La série ne répond pas » n'est pas « le marquage ne grandit pas », et
		 * ce n'est pas non plus « demandons à un autre vêtement ». Une série qui
		 * s'arrête au 2XL (le Fruit of the Loom Classic Hooded) ne dit rien du
		 * 3XL : grader avec `garments.json` mélangerait la poitrine du
		 * Stanley/Stella et celle du Fruit of the Loom dans un seul rapport, et
		 * le studio, lui, rendrait « non mesurable ». Les deux moitiés se
		 * contrediraient sur la même commande.
		 *
		 * Trouvé par la passe adversariale du 5 septembre 2026 : mesuré sur une
		 * série courte, le rapport mélangé valait 1,2598, et sur une série
		 * fabriquée acceptable pièce à pièce il montait à 2,56.
		 */
		$courte = ts_gradient_gildan();
		unset( $courte['3XL'] );

		// Un marquage minuscule, pour que seul le refus de la TAILLE puisse
		// expliquer le résultat : à cette taille rien ne déborde du film.
		$side = ts_gradient_side( 4.0, 4.0 );
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( '3XL' => 1 ), $courte ),
			array( '3XL' ),
			'le 3XL est refusé et nommé'
		);
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( '2XL' => 1 ), $courte ),
			array(),
			'et le 2XL, que la série porte, passe'
		);
	} );

	ts_it( 'refuse une taille que le studio ne dessine pas, série ou pas', function () {
		/*
		 * Les fiches fournisseur montent au 5XL, `garments.json` s'arrête au 3XL,
		 * et le studio ne dessine que six tailles. Un 4XL passé par la branche
		 * « série du fabricant » atteignait `sizeSpecCm('tee','4XL')` côté studio,
		 * qui est indéfini, et faisait tomber le rendu de TOUTE la fournée.
		 * Joignable par une requête REST fabriquée. Trouvé par la passe
		 * adversariale du 5 septembre 2026.
		 */
		$longue = ts_gradient_gildan();
		$longue['4XL'] = 76.2;
		$longue['5XL'] = 81.28;
		$side = ts_gradient_side( 4.0, 4.0 );
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( '4XL' => 1 ), $longue ),
			array( '4XL' ),
			'le 4XL est refusé même quand la fiche du fabricant le porte'
		);
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( '4XL' => 1 ) ),
			array( '4XL' ),
			'et sans série aussi'
		);
	} );

	ts_it( 'ne grade pas un marquage unique pour toutes les tailles', function () {
		/*
		 * `printScaleK` rend 1 partout en mode « fixe ». Grader quand même
		 * refusait une vente parfaitement imprimable avec la phrase « le marquage
		 * grandit avec le vêtement », qui est fausse pour cette création.
		 */
		$court  = ts_gradient_side( 25.0, 25.0 );
		$gradee = $court;
		$gradee['graded'] = true;
		$fixe   = $court;
		$fixe['graded'] = false;

		ts_eq(
			Design::unprintable_sizes( 'tee', array( $gradee ), array( '3XL' => 1 ), ts_gradient_gildan() ),
			array( '3XL' ),
			'gradée, elle dépasse le film en 3XL'
		);
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $fixe ), array( '3XL' => 1 ), ts_gradient_gildan() ),
			array(),
			'fixe, c’est le même transfert de 25,0 cm à toutes les tailles'
		);
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $court ), array( '3XL' => 1 ), ts_gradient_gildan() ),
			array( '3XL' ),
			'et un document qui ne dit rien est traité comme gradé'
		);
	} );

	ts_it( 'garde garments.json pour un produit SANS série', function () {
		// Tout le catalogue sauf dix références est dans ce cas. Refuser là
		// reviendrait à fermer la boutique.
		$side = ts_gradient_side( 4.0, 4.0 );
		ts_eq(
			Design::unprintable_sizes( 'tee', array( $side ), array( '3XL' => 1 ) ),
			array(),
			'sans série, le 3XL passe comme avant'
		);
	} );
}
