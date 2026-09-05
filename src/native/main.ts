/**
 * Le point d'entrée de l'éditeur natif, chargé par la fiche produit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LES SIX RAISONS DE GARDER LE CADRE, ET CE QUI LES REMPLACE
 *
 * `wp-plugins/teeshoop-core/includes/Shortcode.php` défendait l'encadrement du
 * studio avec six raisons techniques précises, et les six étaient vraies. Elles
 * décrivaient toutes une propriété de CETTE application-là, pas une propriété
 * de l'idée d'un personnalisateur intégré. Chacune a maintenant une réponse en
 * code, et chacune est gardée par `scripts/editeur-guard.mjs` :
 *
 *   1. LA REMISE À ZÉRO DE TAILWIND v4, non préfixée, qui réécrivait les `a`,
 *      `h1` à `h6`, `button` et `img` du thème. Ce paquet n'embarque pas
 *      Tailwind : `editeur.css` ne contient aucun sélecteur d'élément nu, tout
 *      y est sous `.tshop-ed`, et la garde refuse le contraire.
 *
 *   2. `body{overflow:hidden}` ET `100dvh`, qui tuaient le défilement du site.
 *      L'éditeur est un bloc dans le flux : le canevas suit son conteneur par
 *      `ResizeObserver`, jamais la fenêtre, et aucune règle ne vise `body`,
 *      `html` ni `:root`. La garde refuse les quatre.
 *
 *   3. ~53 Mo D'ACTIFS EN CHEMINS ABSOLUS (`/models/`, `/ort/`, `/catalog/`).
 *      La vue simple n'en référence aucun : le vêtement est dessiné depuis
 *      `src/garments/*.ts`, la photographie est une URL que WordPress fournit,
 *      et la zone est un rectangle calculé. La garde refuse ces préfixes dans
 *      la sortie de construction.
 *
 *   4. LES FENÊTRES EN `position:fixed` QUI ENTRAIENT EN COLLISION AVEC
 *      ELEMENTOR. La vue simple n'a aucune fenêtre : tout est en ligne dans la
 *      page. La vue avancée, quand elle en ouvre une, utilise `<dialog>` et sa
 *      couche supérieure, qui est au-dessus de tout contexte d'empilement par
 *      définition et non par un `z-index` qu'un thème peut battre.
 *
 *   5. TROIS ÉCOUTEURS CLAVIER GLOBAUX qui avalaient les frappes. L'écouteur
 *      est posé sur le conteneur de l'éditeur, qui porte `tabindex`, donc il ne
 *      voit une touche que quand le focus est dedans. La garde refuse
 *      `window.addEventListener('key…')` et son équivalent sur `document`.
 *
 *   6. LES SINGLETONS DE NIVEAU MODULE, une instance par document. Tout l'état
 *      d'un éditeur est dans son instance (`src/native/editeur.ts`), et la garde
 *      refuse un `let` ou un `var` au niveau du module dans tout `src/native/`,
 *      qui est la forme que ce défaut prend en pratique : personne n'écrit
 *      « singleton », quelqu'un écrit `let courant = null`.
 *
 *      CINQ VALEURS PARTAGÉES DEMEURENT, dans les modules que l'éditeur importe,
 *      et la garde ne les voit pas parce qu'elle ne lit que `src/native/`. Elles
 *      sont comptées ici plutôt que niées, parce qu'une réponse qui prétend à
 *      zéro état partagé serait fausse et que la passe adversariale du
 *      5 septembre 2026 en avait trouvé trois de plus que ce paragraphe :
 *
 *        `upload.ts` : le cache de dépôt, clé par le CONTENU et par l'adresse du
 *        Worker, donc deux éditeurs qui déposent la même création partagent une
 *        requête au lieu d'en payer deux. Partage VOULU.
 *
 *        `garmentPalette.ts` : le nuancier, posé par `setShopPalette`. C'est de
 *        la configuration de DOCUMENT, une fiche produit vend un article, et
 *        c'est la raison pour laquelle ce fichier n'en monte qu'un par page.
 *
 *        `i18n/lang.ts` : la langue, que l'éditeur fixe à `fr`. Une par document,
 *        et la boutique ne propose pas d'en changer.
 *
 *        `state/assets.ts` et `lib/rasterCache.ts` : deux caches d'images
 *        décodées, clés par identifiant d'actif et par révision. Deux éditeurs
 *        qui montrent le même visuel doivent le décoder une fois.
 *
 *      Aucune n'empêche deux instances de coexister ; la première et la seconde
 *      seraient partagées à tort si les deux fiches vendaient des produits
 *      différents, et c'est ce que la limite d'un par page tient.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SANS JAVASCRIPT
 *
 * Poser un visuel sur un vêtement demande un canevas, donc l'ACHAT d'un article
 * personnalisé demande JavaScript, exactement comme avec le cadre. Ce qui n'en
 * demande pas reste rendu par le serveur et ne bouge pas : la grille de tarifs
 * de la fiche produit, le formulaire de devis, et le message que la fiche
 * affiche à la place de l'éditeur quand celui-ci ne peut pas démarrer.
 */
import './editeur.css'
import { lireContexte } from './contexte'
import { monter, type Editeur } from './editeur'

declare global {
  interface Window {
    TEESHOOP_EDITEUR?: unknown
    /** Ce que la page peut interroger : l'instance montée, ou rien. */
    teeshoopEditeur?: Editeur | null
  }
}

/** Le conteneur que `Editeur::rendre()` écrit, depuis `product-cta.php`. */
const SELECTEUR = '[data-teeshoop-editeur]'

function demarrer(): void {
  const hotes = Array.from(document.querySelectorAll<HTMLElement>(SELECTEUR))
  if (hotes.length === 0) return

  const ctx = lireContexte(window.TEESHOOP_EDITEUR)
  if (!ctx) {
    /*
     * PAS DE CONTEXTE, PAS D'ÉDITEUR, ET LE MESSAGE DE SECOURS RESTE.
     *
     * Le conteneur porte déjà, écrite par PHP, la phrase que voit un visiteur
     * quand l'éditeur ne démarre pas, avec le lien vers le devis. La vider pour
     * n'y rien mettre transformerait une configuration manquante en page morte,
     * ce qui est exactement ce que cette nuit corrige ailleurs.
     */
    for (const h of hotes) h.setAttribute('data-teeshoop-editeur-etat', 'sans-contexte')
    return
  }

  /*
   * UN SEUL PAR DOCUMENT, et le second est signalé plutôt qu'ignoré.
   *
   * Un thème WooCommerce rend la description d'un produit à plus d'un endroit
   * selon le gabarit (l'onglet, le résumé, un motif de blocs) : le raccourci du
   * studio ressortait TROIS fois sur Twenty Twenty-Five. Le nuancier mesuré est
   * une valeur de document, donc deux éditeurs sur deux produits différents se
   * peindraient l'un l'autre. Le premier vit, les suivants disent pourquoi.
   */
  const [premier, ...autres] = hotes
  for (const h of autres) h.setAttribute('data-teeshoop-editeur-etat', 'doublon')

  /*
   * ET CE MODULE NE MONTE RIEN DEUX FOIS, MÊME S'IL EST EXÉCUTÉ DEUX FOIS.
   *
   * Ce n'est pas de la prudence : ça s'est produit. L'entrée s'appelait
   * `editeur.js`, WordPress y ajoutait `?ver=0.1.0`, et le morceau paresseux
   * l'importait par `./editeur.js`. Deux URL, deux modules, deux exécutions de
   * ce fichier, et la seconde vidait le conteneur du premier éditeur au moment
   * précis où le client cliquait « Ouvrir les réglages avancés ». La cause est
   * corrigée (l'empreinte est dans le nom, `Editeur::fichier()`), et cette
   * ligne est ce qui rend le symptôme impossible plutôt qu'improbable : un
   * thème qui charge le script deux fois est une chose qui existe.
   */
  if (premier.getAttribute('data-teeshoop-editeur-etat') === 'pret') return

  window.teeshoopEditeur = monter(premier, ctx)
  premier.setAttribute('data-teeshoop-editeur-etat', 'pret')
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', demarrer, { once: true })
} else {
  demarrer()
}
