<?php
/**
 * Conditions générales de vente, version du 1er septembre 2026.
 *
 * CE FICHIER NE SE MODIFIE PLUS. Une version est le texte qu'un client a
 * accepté : `Waiver::freeze()` en enregistre le nom sur sa commande, et une
 * version retouchée après coup rendrait cette preuve fausse. Une correction,
 * même d'une virgule, se fait en déposant un fichier daté du jour où elle prend
 * effet. `Terms` lit le répertoire ; il n'y a pas de liste à tenir à jour.
 *
 * LES CHIFFRES SONT GELÉS ICI ET CONTRÔLÉS AILLEURS. Chaque montant, chaque
 * délai et chaque seuil écrit dans ce texte est aussi déclaré dans `accords`,
 * avec la clé de la valeur que la boutique applique réellement.
 * `Terms::checked()` compare les deux, `tests/test-terms.php` le fait tourner
 * dans `npm run ci`, et l'écran de facturation le dit à l'exploitant. Quand ils
 * divergent, la réponse n'est jamais de corriger cette version : c'est d'en
 * publier une nouvelle.
 *
 * ── POURQUOI CETTE VERSION EXISTE ────────────────────────────────────────────
 *
 * L'associé a répondu le 1er septembre 2026 et quatre chiffres de ce contrat ont
 * bougé : le minimum de commande perd sa condition en euros (question 01, « sans
 * minimum obligatoire de 50 EUR HT »), la livraison est offerte à partir de
 * 250,00 EUR et non 300,00 (question 07), le délai de fabrication passe de 12 à
 * 7 jours ouvrés (question 14) et l'acompte s'ouvre à 1 000,00 EUR et non 3 000
 * (question 16).
 *
 * La version du 26 août n'est pas corrigée : elle reste sur le disque, à son
 * adresse propre, telle qu'elle était. C'est la règle que son propre en-tête
 * énonce, et c'est la seule façon qu'une commande passée sous une version puisse
 * être défendue avec le texte que le client a lu.
 *
 * DEUX CHOSES QUE CE TEXTE NE DIT PAS ENCORE, et ce sont des questions reposées
 * plutôt que des oublis. Le transporteur principal devient Mondial Relay dans la
 * même réponse, sans grille tarifaire : la boutique chiffre donc toujours sur la
 * grille publique de La Poste et ne nomme pas de transporteur ici. Et « 7 jours »
 * ne dit pas ouvrés ou calendaires ; ils sont lus ouvrés, comme toutes les autres
 * durées de ce contrat.
 *
 * @package Teeshoop\Core
 */

defined( 'ABSPATH' ) || defined( 'TEESHOOP_TEST' ) || exit;

return array(

	'titre'  => 'Conditions générales de vente',

	/*
	 * L'ÉTAT DU TEXTE, ET IL EST AFFICHÉ AU CLIENT. Ces conditions ont été
	 * rédigées par l'équipe qui écrit le code, à partir du code lui-même : les
	 * délais, les minimums et les tolérances annoncés sont ceux que la boutique
	 * applique, et rien n'y a été inventé. Aucun avocat ne les a lues. La
	 * question 18 de QUESTIONS-ASSOCIE.md demande cette relecture, et tant
	 * qu'elle n'a pas eu lieu la page le dit en toutes lettres.
	 */
	'etat'   => 'projet',

	'resume' => 'Ce texte est un projet rédigé en interne et non relu par un avocat. '
		. 'Il décrit fidèlement ce que la boutique fait aujourd’hui. Il doit être validé '
		. 'par un professionnel du droit avant toute vente.',

	'articles' => array(

		array(
			'titre'       => 'Article 1. Objet et champ d’application',
			'paragraphes' => array(
				'Les présentes conditions régissent la vente de vêtements et d’accessoires textiles personnalisés à la demande de l’acheteur, commandés sur le site teeshoop.com ou à la suite d’un devis établi par Teeshoop.',
				'Elles s’appliquent aussi bien à un acheteur professionnel qu’à un consommateur. Lorsqu’une clause ne concerne que l’un des deux, elle le dit. Un professionnel qui achète en dehors de son activité principale et dont l’entreprise emploie moins de six salariés est traité comme un consommateur pour l’application du droit de rétractation, conformément à l’article L221-3 du code de la consommation.',
				'Toute commande implique l’acceptation sans réserve des présentes conditions dans la version en vigueur au jour où elle est passée. Cette version est datée, elle reste consultable à son adresse propre, et son nom est enregistré avec la commande.',
			),
		),

		array(
			'titre'       => 'Article 2. Identité du vendeur',
			'paragraphes' => array(
				'Les informations légales du vendeur, sa forme juridique, son adresse, son numéro d’immatriculation et son numéro de TVA figurent dans les mentions légales du site, auxquelles les présentes conditions renvoient.',
				'Tant que ces informations ne sont pas publiées, la boutique n’est pas ouverte à la vente : la page des mentions légales le signale et la validation d’une commande est refusée.',
			),
		),

		array(
			'titre'       => 'Article 3. Produits et personnalisation',
			'paragraphes' => array(
				'Les articles vendus sont des textiles du commerce, décorés par transfert numérique à la demande de l’acheteur, à partir d’un visuel que celui-ci fournit ou compose dans l’outil de personnalisation du site.',
				'L’acheteur garantit détenir tous les droits sur les visuels, marques, logos, photographies et textes qu’il transmet, et il garantit Teeshoop contre toute réclamation d’un tiers à ce sujet. Teeshoop n’exerce aucun contrôle a priori sur ces éléments et peut refuser une commande dont le contenu paraîtrait manifestement illicite.',
				'Les couleurs affichées à l’écran sont une représentation. Un écran n’imprime pas, et l’aspect d’un aplat sur du coton diffère toujours un peu de son aperçu. Cet écart n’est pas un défaut.',
			),
		),

		array(
			'titre'       => 'Article 4. Commande, quantités et devis',
			'paragraphes' => array(
				'Une commande est acceptée à partir de 5 pièces, toutes lignes confondues. En dessous, le panier ne peut pas être validé. Aucun montant minimum de commande n’est exigé.',
				'Au-delà de 250 pièces ou de 2 000,00 € hors taxes sur une même ligne, la commande passe par un devis établi par Teeshoop plutôt que par un paiement en autonomie. Une ligne ne peut pas dépasser 10 000 pièces.',
				'Un devis établi par Teeshoop est valable 15 jours calendaires à compter de sa date d’émission. Passé ce délai il expire, les disponibilités sont revérifiées et le prix comme le délai sont recalculés.',
				'La vente est formée lorsque le paiement a été accepté et que Teeshoop en a accusé réception par courrier électronique. Jusque-là, une commande peut être annulée par l’une ou l’autre partie sans frais.',
			),
		),

		array(
			'titre'       => 'Article 5. Bon à tirer',
			'paragraphes' => array(
				'Aucune production ne démarre avant que l’acheteur ait validé un bon à tirer. Ce document reprend le visuel, ses dimensions en centimètres, son emplacement, les couleurs, les tailles et les quantités. Il est envoyé par courrier électronique et se valide en ligne, sans créer de compte.',
				'Le lien de validation reste actif 30 jours. Passé ce délai, il faut en demander un nouveau.',
				'Le prix comprend 2 allers-retours de bon à tirer, comptés par demande de modification émanant de l’acheteur. Un aller-retour dû à Teeshoop, par exemple un envoi qui n’est pas parti, n’est pas décompté. Au-delà, chaque correction supplémentaire est facturée 15,00 € hors taxes.',
				'La validation du bon à tirer fait foi sur ce qui sera imprimé. Une erreur présente sur un bon à tirer validé n’ouvre pas droit à une reprise gratuite.',
			),
		),

		array(
			'titre'       => 'Article 6. Prix, taxes et paiement',
			'paragraphes' => array(
				'Les prix sont indiqués en euros. Le taux de taxe sur la valeur ajoutée appliqué est de 20 %. Les prix hors taxes et toutes taxes comprises sont tous deux affichés là où les deux publics les lisent.',
				'Le prix d’un article personnalisé dépend du vêtement, du nombre de faces imprimées, de la surface réellement encrée du visuel et de la quantité commandée. Il est calculé par la boutique et affiché avant la validation du panier.',
				'Le paiement s’effectue par carte bancaire, au moment de la commande, par l’intermédiaire de notre prestataire de paiement. Aucune donnée de carte ne transite par les serveurs de Teeshoop ni n’y est conservée.',
				'Les frais de livraison et d’emballage sont indiqués avant le paiement. La livraison est offerte à partir de 250,00 € hors taxes de marchandise.',
			),
		),

		array(
			'titre'       => 'Article 7. Acompte',
			'paragraphes' => array(
				'À partir de 1 000,00 € hors taxes de commande, un règlement en deux fois peut être accordé, après accord exprès de Teeshoop. L’acompte représente alors 50 % du montant toutes taxes comprises et déclenche la production ; le solde est exigible avant l’expédition.',
				'Un acompte n’est jamais automatique. En dehors de ce cas, une commande est réglée intégralement avant production.',
			),
		),

		array(
			'titre'       => 'Article 8. Délais de fabrication et de livraison',
			'paragraphes' => array(
				'Le délai de fabrication est de 7 jours ouvrés entre la validation du bon à tirer et la remise du colis au transporteur. Il ne court pas tant que le bon à tirer n’est pas validé.',
				'Le transporteur annonce ensuite 2 jours ouvrés pour la France métropolitaine. Ce délai est le sien et non le nôtre.',
				'Ces délais sont des objectifs de production communiqués de bonne foi et non des dates garanties. Un dépassement raisonnable n’ouvre pas droit à indemnité. Un retard qui rendrait la commande sans objet, lorsque l’acheteur a indiqué une date impérative au moment de commander, permet en revanche son annulation et le remboursement des sommes versées.',
				'Teeshoop ne publie aucun délai plus court que celui-ci, parce qu’il ne serait pas tenu. Une commande urgente se traite au cas par cas, sur devis.',
			),
		),

		array(
			'titre'       => 'Article 9. Livraison et réception',
			'paragraphes' => array(
				'Les livraisons se font en France métropolitaine, à l’adresse indiquée par l’acheteur. Les autres destinations sont traitées sur devis.',
				'Il appartient à l’acheteur de vérifier l’état du colis à la réception. Un colis endommagé doit être photographié avant ouverture et signalé sans délai : sans photographie, le transporteur refuse le dossier.',
				'Le risque de perte ou de détérioration est transféré au consommateur à la remise physique du colis. Pour un acheteur professionnel, il est transféré à la remise au transporteur.',
			),
		),

		array(
			'titre'       => 'Article 10. Droit de rétractation et son exclusion',
			'paragraphes' => array(
				'Le consommateur qui achète à distance dispose en principe d’un délai de quatorze jours pour se rétracter, sans motif et sans pénalité.',
				'CE DROIT NE S’APPLIQUE PAS AUX ARTICLES PERSONNALISÉS. L’article L221-28 3° du code de la consommation exclut du droit de rétractation les biens confectionnés selon les spécifications du consommateur ou nettement personnalisés. Un vêtement imprimé au visuel d’un client est un tel bien : il ne peut être ni repris, ni échangé, ni remis en vente.',
				'Cette exclusion est portée à la connaissance de l’acheteur avant la conclusion du contrat : une case doit être cochée au moment du paiement, dès que le panier contient un article personnalisé, et l’acceptation est enregistrée avec sa date, la version des présentes conditions et la phrase exacte qui était affichée. Elle est rappelée sur le récapitulatif de commande.',
				'Le droit de rétractation reste entier pour tout article non personnalisé. Il s’exerce alors dans les quatorze jours suivant la réception, par une déclaration dénuée d’ambiguïté adressée à Teeshoop, et l’article doit être retourné neuf, non porté et dans son emballage.',
			),
		),

		array(
			'titre'       => 'Article 11. Tolérances de fabrication',
			'paragraphes' => array(
				'Une impression est posée par une personne sur un vêtement souple. Les écarts suivants sont inhérents au procédé et ne constituent pas un défaut.',
			),
			'liste'       => array(
				'La position du marquage peut varier de 1 cm par rapport aux cotes du bon à tirer, sur la taille pour laquelle ces cotes sont données. Le marquage suit l’échelle du vêtement, donc l’écart peut être plus grand sur les tailles très différentes de celle-là.',
				'La couleur imprimée peut différer de l’aperçu à l’écran. Un écran émet de la lumière, un tissu la réfléchit.',
				'La teinte d’un même coloris peut varier légèrement d’un lot de textile à l’autre chez le fabricant.',
			),
		),

		array(
			'titre'       => 'Article 12. Réclamations et service après-vente',
			'paragraphes' => array(
				'Toute réclamation doit être signalée dans les meilleurs délais, avec le numéro de commande et des photographies des articles concernés.',
				'Le traitement dépend de l’origine du problème.',
			),
			'liste'       => array(
				'Erreur de Teeshoop : remplacement prioritaire, avoir ou remboursement, sans frais pour l’acheteur.',
				'Défaut du textile : remplacement, le recours auprès du fabricant étant l’affaire de Teeshoop et non celle de l’acheteur.',
				'Dommage pendant le transport : dossier auprès du transporteur, et remplacement selon l’urgence.',
				'Erreur présente sur un bon à tirer validé par l’acheteur : pas de gratuité automatique, un geste commercial restant possible.',
				'Erreur de taille commise par l’acheteur : pas de reprise, un vêtement personnalisé ne pouvant pas être remis en vente. Une solution commerciale reste possible.',
				'Usure ou entretien inadapté : analyse et conseil.',
			),
		),

		array(
			'titre'       => 'Article 13. Garanties légales',
			'paragraphes' => array(
				'Indépendamment de toute garantie commerciale, le consommateur bénéficie de la garantie légale de conformité prévue aux articles L217-3 et suivants du code de la consommation et de la garantie contre les vices cachés prévue aux articles 1641 et suivants du code civil.',
				'La garantie légale de conformité s’exerce pendant deux ans à compter de la délivrance du bien. Le consommateur peut demander la réparation ou le remplacement, puis, sous conditions, la réduction du prix ou la résolution du contrat. Il n’a pas à prouver l’existence du défaut pendant les vingt-quatre mois qui suivent la délivrance.',
				'La garantie contre les vices cachés permet, dans les deux ans suivant la découverte du vice, d’obtenir la résolution de la vente ou une réduction du prix.',
				'Aucune clause des présentes conditions ne restreint ces garanties. Les tolérances de l’article 11 décrivent les caractéristiques normales du procédé et ne sont pas des défauts de conformité.',
			),
		),

		array(
			'titre'       => 'Article 14. Retard de paiement entre professionnels',
			'paragraphes' => array(
				'Aucune somme n’étant due après livraison dans le cas général, cet article ne concerne que les factures émises à échéance, sur accord exprès.',
				'Conformément à l’article L441-10 du code de commerce, toute somme non réglée à son échéance porte de plein droit, dès le jour suivant, des pénalités calculées au taux d’intérêt appliqué par la Banque centrale européenne à son opération de refinancement la plus récente, majoré de dix points de pourcentage. Aucun taux contractuel plus bas n’est prévu.',
				'S’y ajoute une indemnité forfaitaire de recouvrement de quarante euros, fixée par décret, sans préjudice d’une indemnisation complémentaire sur justificatifs.',
				'Aucun escompte n’est accordé pour paiement anticipé.',
			),
		),

		array(
			'titre'       => 'Article 15. Données personnelles',
			'paragraphes' => array(
				'Les données recueillies pour traiter une commande, produire un bon à tirer, émettre une facture et assurer le service après-vente sont décrites dans la politique de confidentialité du site, qui indique pour chaque traitement sa finalité, sa base légale, sa durée de conservation et ses destinataires.',
				'Une demande de devis restée sans suite est conservée 1 095 jours après le dernier échange, puis supprimée automatiquement.',
				'L’acheteur dispose d’un droit d’accès, de rectification, d’effacement, de portabilité, de limitation et d’opposition, qu’il exerce à l’adresse indiquée dans les mentions légales.',
			),
		),

		array(
			'titre'       => 'Article 16. Publication des réalisations',
			'paragraphes' => array(
				'Teeshoop peut présenter, sur son site et sur ses réseaux sociaux, des photographies des articles produits pour un client, y compris le visuel qui y figure, à des fins de démonstration de son savoir-faire.',
				'Le client peut refuser cette publication à tout moment, par simple demande écrite, sans avoir à se justifier et sans conséquence sur sa commande. Le refus vaut également pour les publications déjà en ligne, qui sont retirées.',
				'Aucune photographie de personne identifiable n’est publiée sans son accord distinct.',
			),
		),

		array(
			'titre'       => 'Article 17. Force majeure',
			'paragraphes' => array(
				'Teeshoop ne peut être tenue responsable d’un manquement dû à un événement échappant à son contrôle raisonnable, au sens de l’article 1218 du code civil. Si l’empêchement se prolonge au-delà de trente jours, chaque partie peut résilier la commande et les sommes versées sont remboursées.',
			),
		),

		array(
			'titre'       => 'Article 18. Droit applicable et règlement des litiges',
			'paragraphes' => array(
				'Les présentes conditions sont soumises au droit français.',
				'En cas de difficulté, l’acheteur est invité à s’adresser d’abord à Teeshoop, qui s’engage à répondre.',
				'Un consommateur peut ensuite recourir gratuitement à un médiateur de la consommation, conformément à l’article L612-1 du code de la consommation. Le médiateur retenu par Teeshoop et ses coordonnées seront indiqués ici dès sa désignation. Tant qu’ils ne le sont pas, cette obligation n’est pas satisfaite, et la boutique ne peut pas vendre à des consommateurs.',
				'À défaut d’accord, le litige relève des juridictions françaises compétentes. Aucune clause des présentes conditions ne prive un consommateur de la possibilité de saisir la juridiction du lieu où il demeurait au moment de la conclusion du contrat ou de la survenance du fait dommageable.',
			),
		),

		array(
			'titre'       => 'Article 19. Version et modification',
			'paragraphes' => array(
				'Chaque version des présentes conditions porte la date à laquelle elle prend effet et reste consultable à son adresse propre, indéfiniment.',
				'Une modification donne lieu à une nouvelle version datée et ne s’applique qu’aux commandes passées après sa date d’effet. Une commande reste régie par la version qui était en vigueur au jour où elle a été passée, et c’est cette version dont le nom est enregistré avec elle.',
			),
		),
	),

	/*
	 * CE QUE CE TEXTE PROMET, ET OÙ LA BOUTIQUE LE CALCULE.
	 *
	 * `cle` est la valeur telle que `Terms::live_values()` la fournit. `texte`
	 * est le fragment exact qui doit se trouver dans les articles ci-dessus et
	 * qui doit contenir la valeur écrite à la française. Les deux sont comparés
	 * par `Terms::checked()`. Un fragment qui ne s'y trouve plus, ou un chiffre
	 * que la boutique n'applique plus, fait échouer le contrôle.
	 */
	'accords' => array(
		array( 'cle' => 'minimum_pieces',           'texte' => 'à partir de 5 pièces' ),
		array( 'cle' => 'minimum_ht',               'texte' => 'Aucun montant minimum de commande n’est exigé.' ),
		array( 'cle' => 'tva',                      'texte' => 'appliqué est de 20 %' ),
		array( 'cle' => 'devis_pieces',             'texte' => 'Au-delà de 250 pièces' ),
		array( 'cle' => 'devis_ht',                 'texte' => 'ou de 2 000,00 € hors taxes sur une même ligne' ),
		array( 'cle' => 'plafond_pieces',           'texte' => 'ne peut pas dépasser 10 000 pièces' ),
		array( 'cle' => 'delai_fabrication',        'texte' => 'de fabrication est de 7 jours ouvrés' ),
		array( 'cle' => 'delai_transport',          'texte' => 'annonce ensuite 2 jours ouvrés' ),
		array( 'cle' => 'franco_ht',                'texte' => 'offerte à partir de 250,00 € hors taxes' ),
		array( 'cle' => 'bat_corrections',          'texte' => 'comprend 2 allers-retours de bon à tirer' ),
		array( 'cle' => 'bat_correction_ht',        'texte' => 'facturée 15,00 € hors taxes' ),
		array( 'cle' => 'bat_lien_jours',           'texte' => 'reste actif 30 jours' ),
		array( 'cle' => 'tolerance_cm',             'texte' => 'peut varier de 1 cm' ),
		array( 'cle' => 'acompte_ht',               'texte' => 'À partir de 1 000,00 € hors taxes de commande' ),
		array( 'cle' => 'acompte_taux',             'texte' => 'représente alors 50 % du montant' ),
		array( 'cle' => 'devis_validite_jours',     'texte' => 'valable 15 jours calendaires' ),
		array( 'cle' => 'conservation_devis_jours', 'texte' => 'conservée 1 095 jours après le dernier échange' ),
		array( 'cle' => 'penalites_contractuelles',  'texte' => 'Aucun taux contractuel plus bas n’est prévu.' ),
	),
);
