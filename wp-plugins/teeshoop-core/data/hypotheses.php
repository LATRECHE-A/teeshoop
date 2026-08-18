<?php
/**
 * GENERATED. Do not edit: run `node scripts/hypotheses-guard.mjs --write`.
 *
 * The rows of `docs/hypotheses.json` whose home is inside this plugin, and only
 * the fields an admin screen shows. Read by includes/Hypotheses.php.
 *
 * PHP AND NOT JSON, ON PURPOSE. This directory is served by URL, and these
 * sentences are business-internal: what the shop does not enforce, what nobody
 * has priced yet, and that the published grid is a demonstration. Guarded on
 * ABSPATH, a direct request gets nothing.
 *
 * @package Teeshoop\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return array(
	array(
		'id' => 'H-Q06-TARIF-TEE',
		'question' => 'Q06',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Un t-shirt imprimé sur une face vaut 14,50 EUR HT à l\'unité : 9,50 EUR de textile nu et 5,00 EUR de marquage.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#garments.tee.base_ht+garments.tee.first_side_ht',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q06-TARIF-SWEAT',
		'question' => 'Q06',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Un sweat imprimé sur une face vaut 32,00 EUR HT à l\'unité : 27,00 EUR de textile nu et 5,00 EUR de marquage.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#garments.hoodie.base_ht+garments.hoodie.first_side_ht',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q06-TARIF-VETEMENT-CLIENT',
		'question' => 'Q06',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Quand le client fournit son propre vêtement, la décoration d\'une face vaut 12,00 EUR HT et le textile ne nous coûte rien.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#garments.custom.base_ht+garments.custom.first_side_ht',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q06-MARQUAGE-FACE-SUP',
		'question' => 'Q06',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Chaque face imprimée après la première coûte 6,00 EUR HT, quel que soit le vêtement.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#garments.tee.extra_side_ht',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q08-PALIERS-SURFACE',
		'question' => 'Q08',
		'level' => 'important',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Le supplément de surface par face est de 0,00 EUR jusqu\'à 625 cm², de 4,00 EUR HT jusqu\'à 1250 cm², puis de 9,00 EUR HT sans borne.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#area_tiers',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'05',
		),
	),
	array(
		'id' => 'H-Q08-PALIERS-QUANTITE',
		'question' => 'Q08',
		'level' => 'important',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Les remises de quantité sont de 15 % à partir de 10 pièces, 25 % à partir de 25 et 35 % à partir de 50, appliquées au prix unitaire complet.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#qty_breaks',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'05',
		),
	),
	array(
		'id' => 'H-Q17-TVA',
		'question' => 'Q17',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'La TVA est de 20 % sur tout ce que le site chiffre, sous la forme d\'une constante unique et non d\'une période datée.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#vat_rate',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'04',
		),
	),
	array(
		'id' => 'H-Q02-SEUIL-DEVIS-QTE',
		'question' => 'Q02',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Au-delà de 250 pièces sur une ligne, la commande passe obligatoirement par un devis au lieu d\'être payée en autonomie.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#quote_from_qty',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q02-SEUIL-DEVIS-MONTANT',
		'question' => 'Q02',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Au-delà de 2 000,00 EUR hors taxes sur une ligne, la commande passe obligatoirement par un devis.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#quote_from_ht',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q23-PLAFOND-QUANTITE',
		'question' => 'Q23',
		'level' => 'important',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Une ligne de commande est plafonnée à 10 000 pièces, au-delà desquelles la quantité est ramenée au plafond.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#max_qty',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'05',
			'08',
		),
	),
	array(
		'id' => 'H-Q42-MARGE-TEXTILE-NU',
		'question' => 'Q42',
		'level' => 'bloquant',
		'status' => 'refused',
		'since' => '2026-08-14',
		'statement_fr' => 'Aucun taux de marge n\'est appliqué à un textile nu revendu, donc aucun prix de vente n\'est écrit sur les 26 392 articles importés.',
		'home' => 'php:Teeshoop\\Core\\Pricing::default_config()#blank_margin_rate',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'05',
		),
	),
	array(
		'id' => 'H-Q41-CATALOGUE-CONSULTABLE',
		'question' => 'Q41',
		'level' => 'important',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Une référence importée est publiée et visible dès sa création, avec ses coloris, ses tailles et ses caractéristiques, et n\'est pas commandable faute de prix.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Shelf.php#unpriced_notice',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'05',
			'09',
		),
	),
	array(
		'id' => 'H-Q09-FAMILLES',
		'question' => 'Q09',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Trois familles sont publiées, t-shirts, polos et sweats, sans plafond de nombre de références. La règle est écrite des deux côtés : le Worker filtre ce qu\'il renvoie, l\'extension décide ce qu\'elle dépublie.',
		'home' => 'phpconst:Teeshoop\\Core\\Catalogue::PRINTABLE_FAMILIES',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'09',
		),
	),
	array(
		'id' => 'H-Q43-STOCK',
		'question' => 'Q43',
		'level' => 'utile',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Des trois nombres de stock que le fournisseur donne par article, seul le premier est traité comme du stock vendable.',
		'home' => 'phpconst:Teeshoop\\Core\\Catalogue::STOCK_INDEX',
		'reaches' => array(
			'supplier',
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'08',
		),
	),
	array(
		'id' => 'H-Q44-COLORIS-NON-TRADUITS',
		'question' => 'Q44',
		'level' => 'utile',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Les 442 noms de coloris sont publiés tels que le fabricant les écrit, sans traduction.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Catalogue.php#$colour_names[ $code ]  = self::text( $cw[\'name\'] ?? \'\' );',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'09',
		),
	),
	array(
		'id' => 'H-Q11-STOCK-CHIFFRE',
		'question' => 'Q11',
		'level' => 'utile',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'La quantité exacte annoncée par le fournisseur est écrite sur chaque article, et rien ne décide encore comment la boutique l\'affiche.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Importer.php#manage_stock',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'08',
			'09',
		),
	),
	array(
		'id' => 'H-Q12-TECHNIQUE-ET-ZONES',
		'question' => 'Q12',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Le DTF est la seule technique personnalisable en ligne, et les zones publiées sont celles du studio, en centimètres, mesurées à la taille de tarification.',
		'home' => 'json:wp-plugins/teeshoop-core/data/garments.json#garments.tee.areas.0.bySize.M',
		'reaches' => array(
			'customer',
			'printer',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'09',
			'10',
		),
	),
	array(
		'id' => 'H-Q01-AUCUN-MINIMUM',
		'question' => 'Q01',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-12',
		'statement_fr' => 'Aucun minimum de commande n\'est appliqué : une pièce suffit, et rien ne réserve le site aux professionnels.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Cart.php#check_cart_items',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'on refait',
		'sessions' => array(
			'04',
			'05',
		),
	),
	array(
		'id' => 'H-Q03-PRIX-ACHAT-BRUT',
		'question' => 'Q03',
		'level' => 'bloquant',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Le coût d\'achat retenu est celui que l\'interface du fournisseur renvoie, sans remise négociée, sans port et sans franco.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Catalogue.php#$cost = $prices[ $supply ][\'cost\'] ?? null;',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage et remesure',
		'sessions' => array(
			'05',
			'08',
		),
	),
	array(
		'id' => 'H-Q38-VALIDITE-DEVIS',
		'question' => 'Q38',
		'level' => 'important',
		'status' => 'refused',
		'since' => '2026-08-14',
		'statement_fr' => 'Aucune durée de validité n\'est écrite sur un devis, ni affichée, ni appliquée.',
		'home' => 'anchor:wp-plugins/teeshoop-core/includes/Quote.php#It gives no validity period for a quote',
		'reaches' => array(
			'operator',
			'internal',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'06',
		),
	),
	array(
		'id' => 'H-Q40-CONSERVATION-DEVIS',
		'question' => 'Q40',
		'level' => 'utile',
		'status' => 'assumption',
		'since' => '2026-08-14',
		'statement_fr' => 'Une demande de devis sans suite est conservée 1095 jours, soit trois ans après le dernier échange, puis supprimée automatiquement.',
		'home' => 'phpconst:Teeshoop\\Core\\Quote::KEEP_DAYS',
		'reaches' => array(
			'customer',
			'operator',
		),
		'cost_if_late' => 'reglage',
		'sessions' => array(
			'06',
			'12',
		),
	),
);
