/**
 * CATALOGUE FOURNISSEUR: UI strings side-file (module-owned; the integrator
 * merges I18N into src/i18n/messages.ts). French is first-class, English
 * faithful.
 *
 * `useCatalogT` resolves `catalog.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys (common.*, side.*, ingest.err.* …).
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'
// The two back-origin strings live customer-side (SideSwitcher needs them and
// must not import this admin file). Spread back so the catalogue still has them.
import { I18N as BACK_ORIGIN } from '@/app/backOriginI18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    ...BACK_ORIGIN.fr,
    'catalog.title': 'Catalogue fournisseur',
    'catalog.subtitle':
      'Les vêtements vierges de nos fournisseurs. Chargez-en un dans l’éditeur avec ses tailles.',
    'catalog.entry.title': 'Catalogue fournisseur',
    'catalog.entry.cta': 'Choisir un vêtement vierge',

    // --- sources ---------------------------------------------------------
    'catalog.source.falkross': 'Falk&Ross',
    'catalog.source.falkross_hint': 'API en direct · prix et stocks réels',
    'catalog.source.imbretex': 'Imbretex',
    'catalog.source.imbretex_hint': 'Extrait hors ligne · mesures publiées',

    // --- Falk&Ross -------------------------------------------------------
    'catalog.fr.provenance':
      'Catalogue Falk&Ross en direct via leur webservice. Les prix affichés sont NOS PRIX D’ACHAT. Falk&Ross ne publie aucune mesure de vêtement : les tailles ci-dessous sont estimées à partir d’un gabarit de référence, et modifiables avant import.',
    'catalog.fr.mode.test': 'Mode test',
    'catalog.fr.mode.live': 'Mode réel',
    'catalog.fr.mode.unknown': 'Mode inconnu',
    'catalog.fr.filter_printable': 'Tee-shirts, polos, sweats',
    'catalog.fr.scan_partial':
      '{seen} références parcourues sur {total}. La recherche explore le catalogue au fur et à mesure.',
    'catalog.fr.scan_done': 'Catalogue parcouru en entier ({total} références).',
    'catalog.fr.scan_more': 'Continuer la recherche',
    'catalog.fr.badge.estimated': 'Mesures estimées',
    'catalog.fr.profile.tee': 'tee-shirt',
    'catalog.fr.profile.hoodie': 'sweat / hoodie',
    'catalog.fr.sizes.title': 'Mesures estimées (gabarit {profile})',
    'catalog.fr.sizes.estimate_note':
      'Falk&Ross ne publie aucune table de mesures. Ces valeurs proviennent de notre gabarit de référence pour ce type de vêtement : elles servent au placement de l’impression et au rendu 3D. Ce ne sont pas les mesures de ce vêtement. Vérifiez-les, et corrigez-les si vous les avez.',
    'catalog.fr.sizes.manual_note':
      'Mesures corrigées manuellement : elles seront enregistrées comme telles sur la fiche produit.',
    'catalog.fr.sizes.edit': 'Corriger les mesures',
    'catalog.fr.sizes.pdf': 'Fiche de mesures du fabricant (PDF)',
    'catalog.fr.sizes.size': 'Taille',
    'catalog.fr.sizes.chest': '½ poitrine cm',
    'catalog.fr.sizes.body': 'Longueur cm',
    'catalog.fr.sizes.sleeve': 'Manche cm',
    'catalog.fr.sizes.paste_hint':
      'Astuce : collez ici une table de mesures (Ctrl+V). Colonnes attendues : ½ poitrine, longueur, manche.',
    'catalog.fr.sizes.paste_empty': 'Aucune mesure reconnue dans le texte collé.',
    'catalog.fr.sizes.pasted': '{n} tailles mises à jour depuis le presse-papiers',
    'catalog.fr.sizes.reset': 'Revenir à l’estimation',
    'catalog.fr.sizes.reset_done': 'Mesures réinitialisées sur l’estimation',
    'catalog.fr.back.none':
      'Falk&Ross ne publie aucune photo dos pour cette référence. Le dos sera reconstitué à partir de la face et signalé comme aperçu partout.',
    'catalog.fr.back.wrong_colour':
      'Falk&Ross ne photographie le dos que dans un seul coloris, différent de celui-ci. Plutôt qu’un dos d’une autre couleur, le dos sera reconstitué à partir de la face de CE coloris, et signalé comme aperçu.',
    'catalog.fr.neckline': 'Encolure',
    'catalog.fr.certificates': 'Certifications',
    'catalog.fr.sku': 'SKU',
    'catalog.fr.cost': 'Prix d’achat',
    'catalog.fr.cost_value': '{price} € HT',
    'catalog.fr.cost_note':
      'Prix d’achat négocié sur notre compte Falk&Ross. Ce n’est pas un prix de vente.',
    'catalog.fr.stock': 'Stock',
    'catalog.fr.stock_value': '{n} pièces',
    'catalog.fr.err.unavailable':
      'Catalogue Falk&Ross injoignable. Vérifiez la connexion, puis réessayez.',
    'catalog.fr.err.backend':
      'Le backend local n’est pas lancé. Démarrez-le avec « npm run dev » (qui lance aussi l’API), ou avec « npx wrangler dev » dans un second terminal.',
    'catalog.fr.err.timeout':
      'Le catalogue Falk&Ross met trop de temps à répondre. Le serveur tourne, mais une référence bloque. Réessayez.',
    'catalog.fr.retry': 'Réessayer',
    'catalog.fr.offline.banner':
      'Hors ligne. Catalogue en cache du {date} : les prix et les stocks peuvent avoir changé. Réessayez pour recharger les données réelles.',
    'catalog.fr.offline.style': 'Fiche affichée depuis le cache ({date}).',
    'catalog.fr.err.auth':
      'Falk&Ross a refusé les identifiants du webservice (FR_WS_USER / FR_WS_PASS).',
    'catalog.fr.err.config':
      'Identifiants Falk&Ross non configurés sur le serveur. Voir le README (wrangler secret put).',
    'catalog.fr.err.parse': 'Réponse Falk&Ross illisible.',
    'catalog.fr.err.not_found': 'Cette référence n’existe plus chez Falk&Ross.',
    'catalog.fr.err.unsupported_sizes':
      'Aucune taille de cette référence n’entre dans les tailles du studio (S–3XL).',
    'catalog.fr.err.photo': 'Photos Falk&Ross inaccessibles pour cette référence.',
    'catalog.fr.err.order': 'Commande refusée par Falk&Ross.',
    'catalog.fr.err.style': 'Impossible de charger la fiche de cette référence.',

    'catalog.provenance':
      'Extrait public du catalogue Imbretex du {date}, en attendant leur API officielle. Prix affichés : PVC conseillés, pas nos tarifs d’achat.',
    'catalog.provenance_nodate':
      'Extrait public du catalogue Imbretex, en attendant leur API officielle. Prix affichés : PVC conseillés, pas nos tarifs d’achat.',
    'catalog.search': 'Rechercher (nom, marque, référence)',
    'catalog.filter_dtf': 'Compatible DTF / transfert',
    'catalog.count': '{n} références',
    'catalog.hidden_sizes': '{n} références masquées (tailles hors S–3XL, ex. enfant).',
    'catalog.empty': 'Aucune référence ne correspond à cette recherche.',
    'catalog.loading': 'Chargement du catalogue…',
    'catalog.err.unavailable':
      'Catalogue introuvable : l’extrait public n’est pas déployé sur ce serveur.',
    'catalog.err.parse': 'Catalogue illisible : l’extrait est corrompu.',
    'catalog.err.unsupported_sizes':
      'Aucune taille de cette référence n’entre dans les tailles du studio (S–3XL).',
    'catalog.err.photo': 'Photos du fournisseur inaccessibles pour cette référence.',
    'catalog.err.photo_rejected':
      'La photo fournisseur n’a pas pu être préparée (détourage). Essayez une autre référence.',
    'catalog.err.generic': 'Impossible de charger cette référence.',
    'catalog.card.colours': '{n} coloris',
    'catalog.card.gsm': '{g} g/m²',
    'catalog.card.rrp': 'PVC {price} €',
    'catalog.card.back_missing': 'Sans dos',
    'catalog.back_gap':
      '{n} références sans photo dos chez Imbretex : leur dos est reconstitué à partir de la face, et signalé comme aperçu partout (catalogue, studio, AR, mockups).',
    'catalog.back': 'Retour au catalogue',
    'catalog.detail.colour': 'Coloris',
    'catalog.detail.colour_note':
      'Photos prises en {colour} : le coloris choisi est enregistré sur la fiche produit (les visuels par coloris arriveront avec l’API).',
    'catalog.detail.size': 'Taille de référence',
    'catalog.detail.size_note':
      'Mesures à plat officielles : mi-poitrine {chest} · longueur {length}.',
    'catalog.detail.sleeve_note': 'Manche {sleeve} : estimée, Imbretex ne la publie pas.',
    'catalog.detail.sleeve_note_generic': 'Manche {sleeve}.',
    'catalog.detail.sizes_dropped':
      'Tailles {list} ignorées : le studio ne les prend pas en charge.',
    'catalog.detail.marking': 'Marquages certifiés',
    'catalog.detail.spec': 'Fiche technique',
    'catalog.detail.gender': 'Coupe',
    'catalog.detail.material': 'Matière',
    'catalog.detail.origin': 'Origine',
    'catalog.detail.weight': 'Grammage',
    'catalog.detail.ref': 'Référence',
    'catalog.detail.rrp': 'PVC conseillé',
    'catalog.detail.rrp_note': 'Prix de vente conseillé par le fournisseur. Ce n’est pas notre prix d’achat.',
    'catalog.detail.source': 'Fiche Imbretex',
    'catalog.detail.no_back':
      'Imbretex ne publie aucune photo dos pour cette référence, quel que soit le coloris.',
    'catalog.detail.back_generated':
      'À l’import, le dos sera reconstitué à partir de la face (silhouette miroir, couleur du vêtement, plis conservés). C’est un aperçu, jamais une photo du produit : il est signalé dans le studio et marqué dans les exports AR et les mockups.',
    // Short form, for a tooltip on the studio's Dos tab (see SideSwitcher).
    'catalog.detail.back_reconstructed':
      'Le dos montré ici est une reconstitution : silhouette miroir de la face, couleur du vêtement, plis conservés, boutonnage supprimé. C’est un aperçu, jamais une photo du produit : la mention « aperçu » est incrustée dans l’image elle-même, et le dos reste signalé dans le studio, en AR et dans les mockups. Il n’entre jamais dans un fichier d’impression DTF.',
    'catalog.use': 'Utiliser dans l’éditeur',
    'catalog.busy.front': 'Import de la face…',
    'catalog.busy.back': 'Import du dos…',
    'catalog.busy.generate': 'Préparation du dos reconstitué…',
    'catalog.toast.applied': '« {name} » ({size}) chargé dans l’éditeur',
    'catalog.toast.applied_generated':
      '« {name} » ({size}) chargé : dos reconstitué à partir de la face (aperçu)',
    'catalog.toast.no_back':
      '« {name} » ({size}) chargé sans dos : impression recto uniquement',
  },
  en: {
    ...BACK_ORIGIN.en,
    'catalog.title': 'Supplier catalogue',
    'catalog.subtitle':
      'Blanks from our suppliers. Load one into the editor with its size table.',
    'catalog.entry.title': 'Supplier catalogue',
    'catalog.entry.cta': 'Pick a blank',

    // --- sources ---------------------------------------------------------
    'catalog.source.falkross': 'Falk&Ross',
    'catalog.source.falkross_hint': 'Live API · real prices and stock',
    'catalog.source.imbretex': 'Imbretex',
    'catalog.source.imbretex_hint': 'Offline snapshot · published measurements',

    // --- Falk&Ross -------------------------------------------------------
    'catalog.fr.provenance':
      'Live Falk&Ross catalogue over their webservice. Prices shown are OUR PURCHASE COST. Falk&Ross publishes no garment measurements: the size tables below are estimated from a reference blank, and editable before import.',
    'catalog.fr.mode.test': 'Test mode',
    'catalog.fr.mode.live': 'Live mode',
    'catalog.fr.mode.unknown': 'Unknown mode',
    'catalog.fr.filter_printable': 'T-shirts, polos, sweats',
    'catalog.fr.scan_partial':
      '{seen} of {total} references scanned. Search walks the catalogue as it goes.',
    'catalog.fr.scan_done': 'Whole catalogue scanned ({total} references).',
    'catalog.fr.scan_more': 'Keep searching',
    'catalog.fr.badge.estimated': 'Estimated sizes',
    'catalog.fr.profile.tee': 't-shirt',
    'catalog.fr.profile.hoodie': 'sweat / hoodie',
    'catalog.fr.sizes.title': 'Estimated measurements ({profile} block)',
    'catalog.fr.sizes.estimate_note':
      'Falk&Ross publishes no size table. These values come from our reference blank for this garment type: they drive print placement and the 3D preview. They are NOT this garment’s measurements. Check them, and correct them if you have the real ones.',
    'catalog.fr.sizes.manual_note':
      'Measurements corrected by hand: they will be recorded as such on the product sheet.',
    'catalog.fr.sizes.edit': 'Correct the measurements',
    'catalog.fr.sizes.pdf': 'Manufacturer size spec (PDF)',
    'catalog.fr.sizes.size': 'Size',
    'catalog.fr.sizes.chest': '½ chest cm',
    'catalog.fr.sizes.body': 'Length cm',
    'catalog.fr.sizes.sleeve': 'Sleeve cm',
    'catalog.fr.sizes.paste_hint':
      'Tip: paste a size table here (Ctrl+V). Columns: half chest, length, sleeve.',
    'catalog.fr.sizes.paste_empty': 'No measurements recognised in the pasted text.',
    'catalog.fr.sizes.pasted': '{n} sizes updated from the clipboard',
    'catalog.fr.sizes.reset': 'Back to the estimate',
    'catalog.fr.sizes.reset_done': 'Measurements reset to the estimate',
    'catalog.fr.back.none':
      'Falk&Ross publishes no back photo for this reference. The back will be reconstructed from the front and flagged as a preview everywhere.',
    'catalog.fr.back.wrong_colour':
      'Falk&Ross photographs the back in one colourway only, and it is not this one. Rather than a back in the wrong colour, the back will be reconstructed from THIS colour’s front, and flagged as a preview.',
    'catalog.fr.neckline': 'Neckline',
    'catalog.fr.certificates': 'Certifications',
    'catalog.fr.sku': 'SKU',
    'catalog.fr.cost': 'Purchase price',
    'catalog.fr.cost_value': '€{price} excl. VAT',
    'catalog.fr.cost_note':
      'Purchase price negotiated on our Falk&Ross account. Not a selling price.',
    'catalog.fr.stock': 'Stock',
    'catalog.fr.stock_value': '{n} pieces',
    'catalog.fr.err.unavailable':
      'Falk&Ross catalogue unreachable. Check the connection, then try again.',
    'catalog.fr.err.backend':
      'The local backend is not running. Start it with “npm run dev” (which also starts the API), or with “npx wrangler dev” in a second terminal.',
    'catalog.fr.err.timeout':
      'The Falk&Ross catalogue is taking too long. The server is up, but one reference is stalling. Try again.',
    'catalog.fr.retry': 'Retry',
    'catalog.fr.offline.banner':
      'Offline. Cached catalogue from {date}: prices and stock may have changed. Retry to reload live data.',
    'catalog.fr.offline.style': 'Detail shown from the cache ({date}).',
    'catalog.fr.err.auth':
      'Falk&Ross rejected the webservice credentials (FR_WS_USER / FR_WS_PASS).',
    'catalog.fr.err.config':
      'Falk&Ross credentials are not configured on the server. See the README (wrangler secret put).',
    'catalog.fr.err.parse': 'Unreadable Falk&Ross response.',
    'catalog.fr.err.not_found': 'This reference no longer exists at Falk&Ross.',
    'catalog.fr.err.unsupported_sizes':
      'None of this reference’s sizes fall inside the studio range (S–3XL).',
    'catalog.fr.err.photo': 'Falk&Ross photos are unreachable for this reference.',
    'catalog.fr.err.order': 'Order rejected by Falk&Ross.',
    'catalog.fr.err.style': 'Could not load this reference’s detail.',

    'catalog.provenance':
      'Public snapshot of the Imbretex catalogue taken on {date}, pending their official API. Prices shown are recommended retail, not our cost.',
    'catalog.provenance_nodate':
      'Public snapshot of the Imbretex catalogue, pending their official API. Prices shown are recommended retail, not our cost.',
    'catalog.search': 'Search (name, brand, reference)',
    'catalog.filter_dtf': 'DTF / transfer ready',
    'catalog.count': '{n} references',
    'catalog.hidden_sizes': '{n} references hidden (sizes outside S–3XL, e.g. kids).',
    'catalog.empty': 'No reference matches this search.',
    'catalog.loading': 'Loading the catalogue…',
    'catalog.err.unavailable':
      'Catalogue not found: the public snapshot is not deployed on this server.',
    'catalog.err.parse': 'Unreadable catalogue: the snapshot is corrupted.',
    'catalog.err.unsupported_sizes':
      'None of this reference’s sizes fall inside the studio range (S–3XL).',
    'catalog.err.photo': 'Supplier photos are unreachable for this reference.',
    'catalog.err.photo_rejected':
      'The supplier photo could not be prepared (cutout). Try another reference.',
    'catalog.err.generic': 'Could not load this reference.',
    'catalog.card.colours': '{n} colours',
    'catalog.card.gsm': '{g} gsm',
    'catalog.card.rrp': 'RRP €{price}',
    'catalog.card.back_missing': 'No back',
    'catalog.back_gap':
      '{n} references have no back photo at Imbretex: their back is reconstructed from the front, and flagged as a preview everywhere (catalogue, studio, AR, mockups).',
    'catalog.back': 'Back to the catalogue',
    'catalog.detail.colour': 'Colour',
    'catalog.detail.colour_note':
      'Photos shot in {colour}: the chosen colour is recorded on the product sheet (per-colour visuals will come with the API).',
    'catalog.detail.size': 'Reference size',
    'catalog.detail.size_note':
      'Official flat measurements: half chest {chest} · length {length}.',
    'catalog.detail.sleeve_note': 'Sleeve {sleeve}: estimated, Imbretex does not publish it.',
    'catalog.detail.sleeve_note_generic': 'Sleeve {sleeve}.',
    'catalog.detail.sizes_dropped': 'Sizes {list} are outside the studio range, so they are skipped.',
    'catalog.detail.marking': 'Certified decoration',
    'catalog.detail.spec': 'Spec sheet',
    'catalog.detail.gender': 'Fit',
    'catalog.detail.material': 'Fabric',
    'catalog.detail.origin': 'Origin',
    'catalog.detail.weight': 'Weight',
    'catalog.detail.ref': 'Reference',
    'catalog.detail.rrp': 'Recommended retail',
    'catalog.detail.rrp_note': 'Supplier recommended retail price. Not our purchase cost.',
    'catalog.detail.source': 'Imbretex page',
    'catalog.detail.no_back':
      'Imbretex publishes no back photo for this reference, in any colourway.',
    'catalog.detail.back_generated':
      'On import the back is reconstructed from the front (mirrored silhouette, garment colour, folds preserved). It is a preview, never a photo of the product: the studio flags it and the AR/mockup exports carry a mark.',
    // Short form, for a tooltip on the studio's Back tab (see SideSwitcher).
    'catalog.detail.back_reconstructed':
      'The back shown here is a reconstruction: the front’s mirrored silhouette, the garment colour, its folds kept and the button placket removed. It is a preview, never a photo of the product: the word “preview” is baked into the image itself, and the back stays flagged in the studio, in AR and in mockups. It never enters a DTF print file.',
    'catalog.use': 'Use in the editor',
    'catalog.busy.front': 'Importing the front…',
    'catalog.busy.back': 'Importing the back…',
    'catalog.busy.generate': 'Preparing the reconstructed back…',
    'catalog.toast.applied': '“{name}” ({size}) loaded in the editor',
    'catalog.toast.applied_generated':
      '“{name}” ({size}) loaded: back reconstructed from the front (preview)',
    'catalog.toast.no_back':
      '“{name}” ({size}) loaded with no back: front printing only',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the supplier catalogue: `catalog.*` resolves from
 * this side-file; anything else falls through to the global i18n runtime.
 */
export function useCatalogT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
