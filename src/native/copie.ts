/**
 * Tout ce qu'un client lit dans l'éditeur, en français, en un seul endroit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNE SEULE LANGUE DANS LE PAQUET, ET C'EST UNE MESURE.
 *
 * Le studio embarquait `src/i18n/messages.ts`, 997 lignes dont 488 d'anglais,
 * dans le paquet que chaque client télécharge, pour une boutique française qui
 * ne propose pas de changer de langue. Ce fichier est français et il n'a pas de
 * table : ce qui n'est pas ici n'est pas dit.
 *
 * ÉCRIRE CETTE PHRASE NE SUFFISAIT PAS, ET ELLE A ÉTÉ FAUSSE PENDANT UNE NUIT.
 * `EditorEngine` importait `t` de `@/i18n` pour trois étiquettes de canevas, ce
 * qui ramenait la table entière : 9 664 octets compressés d'anglais dans un
 * paquet de 112 340, mesurés par la passe adversariale du 5 septembre 2026 en
 * cherchant « Print area » dans le fichier livré. Le moteur DEMANDE maintenant
 * ses étiquettes (`etiquetteMoteur` plus bas), et le même grep ne trouve plus
 * rien.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES RÈGLES DE RÉDACTION, APPLIQUÉES, PAS SEULEMENT CITÉES
 *
 *   Pas de tiret cadratin, pas d'emoji, pas de point d'exclamation.
 *   Virgule décimale : les montants arrivent déjà écrits par `Money::format`.
 *   Une erreur dit CE QUI S'EST PASSÉ et QUOI FAIRE, sans excuse et sans flou.
 *   Un contrôle dit ce qui va se passer, la confirmation dit que c'est fait.
 *
 * Il n'y a donc pas de « Une erreur est survenue » ici, et il ne doit pas y en
 * avoir : une phrase qui ne dit rien coûte un appel au service client.
 */

/** Ce que le dépôt d'une création peut refuser, par code de `DesignUploadError`. */
const DEPOT: Record<string, string> = {
  no_printable_side:
    'Il n’y a rien à imprimer sur ce vêtement. Ajoutez un visuel, puis réessayez.',
  unmeasurable:
    'Nous n’avons pas pu mesurer votre visuel, donc pas le chiffrer. Réessayez avec un PNG ou un JPEG exporté depuis votre logiciel.',
  unreachable:
    'Le service qui reçoit votre visuel ne répond pas en ce moment, votre connexion n’y est pour rien. Réessayez dans quelques minutes, ou demandez un devis : rien n’a été facturé.',
  font_unavailable:
    'La police d’un de vos textes ne s’est pas chargée, donc nous ne pouvons ni le mesurer ni le chiffrer. Vérifiez votre connexion, puis réessayez.',
  missing_artwork:
    'Le fichier de votre visuel n’est plus dans ce navigateur. Déposez-le à nouveau, puis réessayez.',
  preview_failed:
    'Nous n’avons pas pu produire l’aperçu qui accompagne la commande. Rechargez la page, puis réessayez.',
  too_large:
    'Votre visuel dépasse ce que nous acceptons en une fois. Réduisez sa définition, ou envoyez-le-nous par courriel.',
  rejected:
    'Ce fichier n’a pas été accepté. Enregistrez-le en PNG ou en JPEG depuis votre logiciel, puis réessayez.',
  server:
    'Le dépôt de votre création n’a pas abouti. Réessayez dans un instant : rien n’a été facturé.',
  network:
    'La connexion s’est interrompue pendant l’envoi de votre visuel. Réessayez : rien n’a été facturé.',
}

export const COPIE = {
  // ------------------------------------------------------------------ scène
  videTitre: 'Déposez votre visuel ici, ou choisissez un fichier.',
  legende:
    'Le vêtement, photographié par le fabricant. Le placement est montré sur un gabarit à l’échelle : la photographie de cette référence n’a pas été mesurée.',
  legendeSansPhoto:
    'Le placement est montré sur un gabarit à l’échelle. Nous n’avons pas encore la photographie de ce coloris.',
  photoAlt: (produit: string, couleur: string): string =>
    couleur === '' ? produit : `${produit}, coloris ${couleur}`,

  // --------------------------------------------------------------- contrôles
  couleurLegende: 'Couleur',
  visuelLegende: 'Votre visuel',
  deposer: 'Choisir un fichier',
  centrer: 'Centrer',
  retirer: 'Retirer',

  // ------------------------------------------------------------- les étapes
  /*
   * LE NOM ACCESSIBLE CONTIENT L'ÉTIQUETTE VISIBLE, WCAG 2.2 critère 2.5.3.
   * « 2. Choisir » est ce qui est écrit sur la pastille et ce qu'une commande
   * vocale prononcera ; la suite de la phrase est là parce que « Choisir »
   * seul, dans une boutique, ne dit pas choisir quoi.
   */
  etapesLegende: 'Étapes de la personnalisation',
  etapeCreer: '1. Créer',
  etapeCreerLong: '1. Créer votre visuel sur le vêtement',
  etapeChoisir: '2. Choisir',
  etapeChoisirLong: '2. Choisir les coloris, les tailles et les quantités',
  valider: 'Valider ma création',
  /*
   * LA COMMANDE DÉSACTIVÉE DIT POURQUOI, et cette phrase est aussi celle que
   * `aria-describedby` fait lire. Un bouton grisé sans raison est un bouton sur
   * lequel un client clique trois fois avant de partir.
   */
  validerSansVisuel:
    'Posez un visuel sur le vêtement, puis passez aux coloris et aux quantités.',
  revenir: 'Revenir à ma création',

  // ------------------------------------------------- coloris et quantités
  matriceLegende: 'Coloris, tailles et quantités',
  colonneColoris: 'Coloris',
  colonneTotal: 'Total',
  ligneTotal: 'Total par taille',
  quantitePour: (taille: string, couleur: string): string =>
    `Quantité en ${taille}, coloris ${couleur}`,
  totalDuColoris: (couleur: string): string => `Total du coloris ${couleur}`,
  ajouterColoris: 'Ajouter un coloris',
  retirerColoris: (couleur: string): string => `Retirer le coloris ${couleur}`,
  colorisPlein: (max: number): string =>
    `Une commande porte au plus ${max} coloris. Pour en commander d’autres, ajoutez cette ligne au panier puis recommencez, ou demandez-nous un devis.`,
  aucunColoris: 'Choisissez un premier coloris pour saisir vos quantités.',

  // ------------------------------------------------------ aperçu par coloris
  apercusLegende: 'Votre visuel sur chaque coloris',
  apercusVides: 'Les aperçus s’affichent dès qu’un coloris est choisi.',
  apercuEnCours: 'Composition des aperçus.',
  apercuRate:
    'Cet aperçu n’a pas pu être composé. Votre visuel et votre commande ne sont pas touchés : la pastille montre la couleur mesurée sur la puce du fabricant.',
  apercuGabarit:
    'Gabarit à l’échelle, peint avec la couleur mesurée sur la puce du fabricant.',
  apercuPhoto: 'Photographie de ce coloris par le fabricant.',
  apercuFace: (face: string): string => `Vue : ${face.toLowerCase()}`,
  apercuTelecharger: 'Télécharger l’aperçu',
  apercuTelechargerNom: (couleur: string): string => `Télécharger l’aperçu sur le coloris ${couleur}`,
  /** Écrit SUR l'image téléchargée : elle circule sans la page qui l'expliquait. */
  apercuMention: (produit: string, couleur: string): string =>
    `${produit}, ${couleur}. Aperçu Teeshoop non contractuel : le bon à tirer fait foi.`,
  apercuTelechargementRate:
    'L’aperçu n’a pas pu être préparé pour le téléchargement. Votre création n’est pas touchée : réessayez, ou faites une capture de l’écran.',
  /*
   * LA RÉSOLUTION EST DITE EN CE QU'ELLE PERMET, PAS EN JARGON. « 96 ppp »
   * seul ne dit rien à un acheteur ; la largeur jusqu'à laquelle son fichier
   * reste net se mesure sur le canevas juste au-dessus.
   */
  resolutionFaible: (dpi: string, seuil: string, cm: string, plusGrande: boolean): string =>
    `Votre image sera imprimée à ${dpi} pixels par pouce${plusGrande ? ' dans la plus grande taille' : ''}. En dessous de ${seuil}, le marquage risque d’être flou : gardez-la sous ${cm} cm de large, ou envoyez un fichier plus grand.`,
  /*
   * LE POURCENTAGE EST MESURÉ, PAS QUALIFIÉ. « Le contraste est faible » ne dit
   * rien qu'un client puisse peser ; « 78 % de votre visuel » se regarde sur
   * l'aperçu juste au-dessus. Le seuil de 3 pour 1 est celui de WCAG 2.2,
   * critère 1.4.11, et sa dérivation est écrite dans `src/native/contraste.ts`.
   */
  contrasteFaible: (part: string): string =>
    `Sur ce coloris, ${part} % de votre visuel reste sous un contraste de 3 pour 1 : le motif risque de ne pas se détacher du tissu. Choisissez un coloris plus clair ou plus foncé, ou donnez un contour à votre visuel.`,
  contrasteInconnu:
    'Nous n’avons pas pu mesurer le contraste de votre visuel sur ce coloris. Regardez l’aperçu ci-dessus : si le motif se confond avec le tissu, choisissez un autre coloris.',

  // ------------------------------------------------------------------ faces
  /*
   * LES NOMS DES FACES SONT ICI ET PLUS DANS LA VUE AVANCÉE.
   *
   * Ils y étaient tant que le sélecteur de face était un réglage avancé. Il est
   * maintenant dans la vue simple, parce qu'un client qui veut imprimer le dos
   * ne devrait pas avoir à ouvrir des « réglages avancés » pour le voir, et
   * surtout parce que le canevas suit désormais la face choisie : la refermer
   * en laissant le client sur le dos, sans moyen de revenir devant, serait un
   * piège. Il n'y a donc qu'un seul contrôle de face, et il est ici.
   */
  faceLegende: 'Face à décorer',
  face: (id: string): string =>
    id === 'back' ? 'Dos' : id === 'sleeve' ? 'Manche' : 'Devant',

  // ------------------------------------------------------------- historique
  historiqueLegende: 'Annuler et rétablir',
  annuler: 'Annuler',
  retablir: 'Rétablir',
  /*
   * LE NOM ACCESSIBLE CONTIENT L'ÉTIQUETTE VISIBLE, ET C'EST UNE RÈGLE, PAS UN
   * GOÛT : WCAG 2.2 critère 2.5.3. Une commande vocale qui dit « Annuler » doit
   * atteindre le bouton qui affiche « Annuler ». Le reste de la phrase est là
   * parce que « Annuler » seul, à dix centimètres de « Ajouter au panier », se
   * lit comme l'annulation de la commande.
   */
  annulerLong: 'Annuler la dernière modification',
  retablirLong: 'Rétablir la modification annulée',

  // ------------------------------------------------------------- états vides
  aucuneCouleur:
    'Aucun coloris n’est déclaré pour cette référence. Le vêtement est dessiné en blanc, et nous confirmerons la couleur avant de lancer la production.',
  aucuneTailleVendue:
    'Aucune taille n’est déclarée pour cette référence. Demandez-nous un devis, nous vérifions ce que le fabricant peut fournir.',
  prixSansVisuel: 'Le prix s’affiche dès qu’un visuel est posé.',
  prixSansTaille: 'Indiquez au moins une quantité pour voir le prix.',
  prixEnCours: 'Calcul du prix.',

  // ----------------------------------------------------------------- le prix
  /*
   * LE NOMBRE ARRIVE DÉJÀ ÉCRIT, ET C'EST LA MÊME RÈGLE QUE POUR LES MONTANTS.
   *
   * `CLAUDE.md` section 6 : un nombre en prose française s'écrit à la française.
   * Mesuré le 9 septembre 2026 sur l'atelier du miroir, la phrase de refus
   * sortait « dépasse 10000 pièces » ; l'appelant passe maintenant
   * `fmtNum(n, 0)`, qui est le formateur que le reste du paquet utilise déjà,
   * plutôt qu'un second `Intl.NumberFormat` construit ici. Le COMPTE reste
   * passé à part parce que c'est lui qui décide du pluriel, et pas la chaîne.
   */
  pour: (pieces: number, ecrit: string): string =>
    `pour ${ecrit} ${pieces > 1 ? 'pièces' : 'pièce'}`,
  suffixeHt: ' HT',
  suffixeTtc: ' TTC',
  /*
   * « EN MOYENNE », ET C'EST EXACT DANS LES DEUX MONDES.
   *
   * Aujourd'hui chaque case de la grille porte le même prix unitaire : le tarif
   * de la boutique est celui de la FAMILLE, et `Cart::cells_for` laisse
   * délibérément `blank_ht` absent, donc `Pricing::quote_matrix` chiffre toutes
   * les cases avec le même nu. La moyenne de valeurs égales est cette valeur, et
   * le mot reste juste. Le jour où l'associé répond « oui, un supplément par
   * taille » (la question est dans `QUESTIONS-ASSOCIE.md`), les cases cessent
   * d'être égales et cette étiquette est déjà la bonne, au lieu d'annoncer un
   * prix unitaire que la moitié des pièces ne paierait pas.
   */
  laPiece: ' la pièce en moyenne',
  remise: (pourcent: string): string => `Remise quantité incluse : ${pourcent} %`,
  prixIndisponible:
    'Le prix n’a pas pu être calculé. Rechargez la page, puis réessayez : rien n’a été facturé.',
  surDevis:
    'À cette quantité, nous chiffrons la commande à la main : le tissu, la production et le transport se négocient, et le tarif public ne les décrit plus.',
  demanderDevis: 'Demander un devis',

  // ----------------------------------------------------------------- l'achat
  ajouter: 'Ajouter au panier',
  ajoute: 'Ajouté au panier.',
  /** Le bouton, tant que l'écran montre ce qui vient d'être ajouté (EDI-01). */
  ajouteBouton: 'Ajouté au panier',
  /*
   * LA CONFIRMATION DIT CE QUI A ÉTÉ AJOUTÉ, et pas seulement que ça l'a été.
   * « Ajouté au panier » sous une commande de 33 pièces en trois coloris ne
   * permet pas de vérifier qu'on a bien commandé ce qu'on croit ; les deux
   * nombres, eux, se comparent à la grille qui est encore à l'écran.
   */
  ajouteQuoi: (pieces: number, ecrit: string, coloris: number): string =>
    `${ecrit} ${pieces > 1 ? 'pièces' : 'pièce'} en ${coloris} coloris.`,
  voirPanier: 'Voir le panier',
  continuer: 'Continuer la personnalisation',
  phaseMesure: 'Mesure de votre visuel.',
  phaseDepot: 'Envoi de votre visuel.',
  phaseAjout: 'Ajout au panier.',
  achatEchoue:
    'L’article n’a pas pu être ajouté. Rien n’a été facturé : rechargez la page, puis réessayez.',
  riensurLeVetement: 'Posez d’abord un visuel sur le vêtement.',
  aucuneTaille: 'Indiquez au moins une taille et une quantité.',
  tropDePieces: (max: string): string =>
    `Cette commande dépasse ${max} pièces sur une seule ligne. Demandez-nous un devis, nous la traitons à la main.`,
  depotNonConfigure:
    'Cette boutique n’a pas d’espace de dépôt configuré pour les créations, donc votre visuel ne peut pas être conservé. Écrivez-nous, nous prenons la commande à la main.',

  // ---------------------------------------------------------------- fichiers
  fichierTropLourd:
    'Ce fichier dépasse 12 Mo. Réduisez sa définition, ou envoyez-le-nous par courriel.',
  fichierMauvaisType:
    'Nous acceptons le PNG, le JPEG, le WebP et le SVG. Enregistrez votre visuel dans l’un de ces formats, puis réessayez.',
  fichierIllisible:
    'Ce fichier n’a pas pu être lu. Enregistrez-le en PNG depuis votre logiciel, puis réessayez.',
  stockagePlein:
    'Le stockage de votre navigateur est plein, donc votre visuel n’a pas pu être conservé. Libérez de la place, quittez la navigation privée, ou envoyez-nous le fichier par courriel : nous prenons la commande à la main.',

  // ------------------------------------------------------------ vue avancée
  ouvrirAvancee: 'Ouvrir les réglages avancés',
  fermerAvancee: 'Fermer les réglages avancés',
  chargementAvancee: 'Chargement des réglages avancés.',
  avanceeIndisponible:
    'Les réglages avancés n’ont pas pu être chargés. Vérifiez votre connexion, puis réessayez : votre visuel est conservé.',

  /**
   * Les étiquettes que `EditorEngine` dessine sur le canevas.
   *
   * Il les DEMANDE au lieu de les importer, ce qui garde `src/i18n/messages.ts`
   * et ses deux langues hors du paquet. Une clé inconnue rend la chaîne vide et
   * pas la clé : la vue simple ne dessine ni repères ni emplacements nommés,
   * donc les seules clés qui arrivent ici sont celles de la zone d'impression,
   * et un `editor.zone.chest_left` peint en travers d'un t-shirt serait pire
   * qu'un blanc.
   */
  etiquetteMoteur: (cle: string, params?: Record<string, string | number>): string => {
    if (cle === 'editor.print_area_label') {
      return `Zone d’impression ${params?.w ?? ''} × ${params?.h ?? ''}`
    }
    return ''
  },

  /*
   * LES MODÈLES SAUVEGARDÉS (`includes/Modeles.php`). Les refus du serveur
   * (plus de place, pas connecté, modèle inconnu) arrivent écrits par lui et
   * sont montrés tels quels ; ce qui suit est ce que l'écran dit de lui-même.
   */
  modelesLegende: 'Mes modèles',
  modelesConnexion:
    'Connectez-vous à votre compte pour enregistrer cette création comme modèle et la réappliquer sur un autre vêtement du même type.',
  modelesSeConnecter: 'Se connecter',
  modelesChargement: 'Chargement de vos modèles.',
  modelesAucun: 'Aucun modèle enregistré pour ce type de vêtement.',
  modelesCompte: (n: number, max: number): string => `${n} modèle${n > 1 ? 's' : ''} enregistré${n > 1 ? 's' : ''} sur ${max}.`,
  modeleNom: 'Nom du modèle',
  modeleNomAide: 'Par exemple « Club, maillot 2026 ».',
  modeleEnregistrer: 'Enregistrer comme modèle',
  modeleEnregistrement: 'Enregistrement du modèle.',
  modeleEnregistre: (nom: string): string => `Modèle « ${nom} » enregistré.`,
  modeleSansVisuel: 'Posez d’abord un visuel pour l’enregistrer comme modèle.',
  modeleSansNom: 'Donnez un nom à ce modèle pour le retrouver.',
  modeleAppliquer: 'Appliquer',
  modeleAppliquerLong: (nom: string): string => `Appliquer le modèle « ${nom} » sur ce vêtement`,
  modeleApplication: 'Application du modèle.',
  modeleApplique: (nom: string): string =>
    `Modèle « ${nom} » appliqué. « Annuler » revient à la création précédente.`,
  modeleEcartes: (n: number): string =>
    `${n} élément${n > 1 ? 's' : ''} du modèle n’${n > 1 ? 'ont' : 'a'} pas pu être repris sur ce vêtement.`,
  modeleVide: 'Ce modèle ne contient rien que ce vêtement puisse imprimer. Votre création n’a pas changé.',
  modeleSupprimer: 'Supprimer',
  modeleSupprimerLong: (nom: string): string => `Supprimer le modèle « ${nom} »`,
  modeleSupprime: (nom: string): string => `Modèle « ${nom} » supprimé.`,
  modeleApercuAlt: (nom: string): string => `Aperçu du modèle « ${nom} »`,
  modelesChargementEchec: 'Vos modèles n’ont pas pu être chargés. Rechargez la page pour réessayer.',
  modeleAutreType:
    'Le modèle demandé a été fait pour un autre type de vêtement. Choisissez-en un dans la liste ci-dessous.',
  modeleEchec: 'Ce modèle n’a pas pu être appliqué. Votre création n’a pas changé.',
  modeleEchecEnregistrement: 'Ce modèle n’a pas pu être enregistré. Votre création n’a pas changé, réessayez dans un instant.',
  modeleEchecSuppression: 'Ce modèle n’a pas pu être supprimé. Réessayez dans un instant.',

  depot: DEPOT,
} as const

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * IL N'Y A PLUS DE PHRASE DE TVA ÉCRITE ICI, ET C'EST UNE CORRECTION.
 *
 * Il y en a eu une, `ttcMention`, qui écrivait « TVA X % incluse » à partir du
 * taux renvoyé par le devis. Elle s'est trompée deux fois en une nuit.
 *
 * D'abord sur l'unité : `vat_rate` est une FRACTION, pas un pour cent, et le
 * premier écran a affiché « TVA 0,2 % incluse » sous un total qui en portait
 * bien vingt. Puis, une fois l'unité corrigée, sur la question elle-même, que
 * la passe adversariale a écrite en entier : sous la franchise en base
 * (article 293 B du CGI) le taux vaut zéro et la phrase devenait
 * « TVA 0 % incluse », à dix centimètres d'une grille de tarifs disant « TVA
 * non applicable », qui est la mention que la loi impose. Régime INCONNU, elle
 * écrivait « TVA 20 % incluse » sur une boutique que `Vat::problems()` déclare
 * incapable de facturer.
 *
 * Le taux ne suffit pas à écrire cette phrase : il faut le RÉGIME. La boutique
 * en a une seule maison, `Settings::price_bases()`, que la fiche produit et la
 * grille de tarifs lisent déjà. L'éditeur la lit maintenant aussi et affiche la
 * `mention` telle quelle. Une quatrième rédaction de la même règle est
 * exactement ce que `CLAUDE.md` section 1 interdit.
 */
