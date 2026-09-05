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
  taillesLegende: 'Tailles et quantités',
  deposer: 'Choisir un fichier',
  centrer: 'Centrer',
  retirer: 'Retirer',
  quantiteEn: (taille: string): string => `Quantité en ${taille}`,

  // ------------------------------------------------------------- états vides
  aucuneCouleur:
    'Aucun coloris n’est déclaré pour cette référence. Le vêtement est dessiné en blanc, et nous confirmerons la couleur avant de lancer la production.',
  aucuneTailleVendue:
    'Aucune taille n’est déclarée pour cette référence. Demandez-nous un devis, nous vérifions ce que le fabricant peut fournir.',
  prixSansVisuel: 'Le prix s’affiche dès qu’un visuel est posé.',
  prixSansTaille: 'Indiquez au moins une taille pour voir le prix.',
  prixEnCours: 'Calcul du prix.',

  // ----------------------------------------------------------------- le prix
  parPiece: ' HT la pièce',
  totalHt: (total: string, pieces: number): string =>
    `${total} HT pour ${pieces} ${pieces > 1 ? 'pièces' : 'pièce'}`,
  suffixeTtc: ' TTC',
  ttcMention: (taux: number): string => `TVA ${formatTaux(taux)} % incluse.`,
  prixIndisponible:
    'Le prix n’a pas pu être calculé. Rechargez la page, puis réessayez : rien n’a été facturé.',
  surDevis:
    'À cette quantité, nous chiffrons la commande à la main : le tissu, la production et le transport se négocient, et le tarif public ne les décrit plus.',
  demanderDevis: 'Demander un devis',

  // ----------------------------------------------------------------- l'achat
  ajouter: 'Ajouter au panier',
  ajoute: 'Ajouté au panier.',
  voirPanier: 'Voir le panier',
  phaseMesure: 'Mesure de votre visuel.',
  phaseDepot: 'Envoi de votre visuel.',
  phaseAjout: 'Ajout au panier.',
  achatEchoue:
    'L’article n’a pas pu être ajouté. Rien n’a été facturé : rechargez la page, puis réessayez.',
  riensurLeVetement: 'Posez d’abord un visuel sur le vêtement.',
  aucuneTaille: 'Indiquez au moins une taille et une quantité.',
  tropDePieces: (max: number): string =>
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

  // ------------------------------------------------------------ vue avancée
  ouvrirAvancee: 'Ouvrir les réglages avancés',
  fermerAvancee: 'Fermer les réglages avancés',
  chargementAvancee: 'Chargement des réglages avancés.',
  avanceeIndisponible:
    'Les réglages avancés n’ont pas pu être chargés. Vérifiez votre connexion, puis réessayez : votre visuel est conservé.',

  depot: DEPOT,
} as const

/**
 * Un taux de TVA lisible, sans zéro inutile.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `vat_rate` EST UNE FRACTION, PAS UN POUR CENT, ET LE PREMIER ÉCRAN L'A DIT.
 *
 * `Pricing::default_config()` porte `'vat_rate' => 0.20`, et la première
 * version de cette phrase l'a imprimée telle quelle : « TVA 0,2 % incluse »,
 * lue sur le miroir le 5 septembre 2026, sous un total qui portait bien
 * vingt pour cent. Une mention de TVA fausse sur une page de vente française
 * n'est pas un détail de rendu.
 *
 * `toFixed(2)` écrirait « 20.00 » avec un point au milieu d'une phrase pleine
 * de virgules décimales, ce que la boutique a déjà corrigé une fois ailleurs ;
 * l'arrondi au centième garde les 2,10 % de l'outre-mer sans traîner de zéros.
 */
function formatTaux(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction < 0) return '0'
  const pourCent = Math.round(fraction * 100 * 100) / 100
  return String(pourCent).replace('.', ',')
}
