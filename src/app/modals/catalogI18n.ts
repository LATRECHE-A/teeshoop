/**
 * CATALOGUE FOURNISSEUR — UI strings side-file (module-owned; the integrator
 * merges I18N into src/i18n/messages.ts). French is first-class, English
 * faithful.
 *
 * `useCatalogT` resolves `catalog.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys (common.*, side.*, ingest.err.* …).
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'catalog.title': 'Catalogue fournisseur',
    'catalog.subtitle':
      'Les vêtements vierges Imbretex, avec leurs vraies mesures — chargez-en un dans l’éditeur.',
    'catalog.entry.title': 'Catalogue fournisseur',
    'catalog.entry.cta': 'Choisir un vêtement vierge Imbretex',
    'catalog.provenance':
      'Extrait public du catalogue Imbretex du {date} — en attendant leur API officielle. Prix affichés : PVC conseillés, pas nos tarifs d’achat.',
    'catalog.provenance_nodate':
      'Extrait public du catalogue Imbretex — en attendant leur API officielle. Prix affichés : PVC conseillés, pas nos tarifs d’achat.',
    'catalog.search': 'Rechercher (nom, marque, référence)',
    'catalog.filter_dtf': 'Compatible DTF / transfert',
    'catalog.count': '{n} références',
    'catalog.hidden_sizes': '{n} références masquées (tailles hors S–3XL, ex. enfant).',
    'catalog.empty': 'Aucune référence ne correspond à cette recherche.',
    'catalog.loading': 'Chargement du catalogue…',
    'catalog.err.unavailable':
      'Catalogue introuvable — l’extrait public n’est pas déployé sur ce serveur.',
    'catalog.err.parse': 'Catalogue illisible — l’extrait est corrompu.',
    'catalog.err.unsupported_sizes':
      'Aucune taille de cette référence n’entre dans les tailles du studio (S–3XL).',
    'catalog.err.photo': 'Photos du fournisseur inaccessibles pour cette référence.',
    'catalog.err.photo_rejected':
      'La photo fournisseur n’a pas pu être préparée (détourage) — essayez une autre référence.',
    'catalog.err.generic': 'Impossible de charger cette référence.',
    'catalog.card.colours': '{n} coloris',
    'catalog.card.gsm': '{g} g/m²',
    'catalog.card.rrp': 'PVC {price} €',
    'catalog.back': 'Retour au catalogue',
    'catalog.detail.colour': 'Coloris',
    'catalog.detail.colour_note':
      'Photos prises en {colour} : le coloris choisi est enregistré sur la fiche produit (les visuels par coloris arriveront avec l’API).',
    'catalog.detail.size': 'Taille de référence',
    'catalog.detail.size_note':
      'Mesures à plat officielles : mi-poitrine {chest} · longueur {length}.',
    'catalog.detail.sleeve_note': 'Manche {sleeve} — estimée, non publiée par Imbretex.',
    'catalog.detail.sizes_dropped':
      'Tailles {list} non prises en charge par le studio — ignorées.',
    'catalog.detail.marking': 'Marquages certifiés',
    'catalog.detail.spec': 'Fiche technique',
    'catalog.detail.gender': 'Coupe',
    'catalog.detail.material': 'Matière',
    'catalog.detail.origin': 'Origine',
    'catalog.detail.weight': 'Grammage',
    'catalog.detail.ref': 'Référence',
    'catalog.detail.rrp': 'PVC conseillé',
    'catalog.detail.rrp_note': 'Prix de vente conseillé fournisseur — ce n’est pas notre prix d’achat.',
    'catalog.detail.source': 'Fiche Imbretex',
    'catalog.detail.no_back': 'Pas de photo dos — impression recto uniquement.',
    'catalog.use': 'Utiliser dans l’éditeur',
    'catalog.busy.front': 'Import de la face…',
    'catalog.busy.back': 'Import du dos…',
    'catalog.toast.applied': '« {name} » ({size}) chargé dans l’éditeur',
  },
  en: {
    'catalog.title': 'Supplier catalogue',
    'catalog.subtitle':
      'Imbretex blanks with their real measurements — load one into the editor.',
    'catalog.entry.title': 'Supplier catalogue',
    'catalog.entry.cta': 'Pick an Imbretex blank',
    'catalog.provenance':
      'Public snapshot of the Imbretex catalogue taken on {date} — pending their official API. Prices shown are recommended retail, not our cost.',
    'catalog.provenance_nodate':
      'Public snapshot of the Imbretex catalogue — pending their official API. Prices shown are recommended retail, not our cost.',
    'catalog.search': 'Search (name, brand, reference)',
    'catalog.filter_dtf': 'DTF / transfer ready',
    'catalog.count': '{n} references',
    'catalog.hidden_sizes': '{n} references hidden (sizes outside S–3XL, e.g. kids).',
    'catalog.empty': 'No reference matches this search.',
    'catalog.loading': 'Loading the catalogue…',
    'catalog.err.unavailable':
      'Catalogue not found — the public snapshot is not deployed on this server.',
    'catalog.err.parse': 'Unreadable catalogue — the snapshot is corrupted.',
    'catalog.err.unsupported_sizes':
      'None of this reference’s sizes fall inside the studio range (S–3XL).',
    'catalog.err.photo': 'Supplier photos are unreachable for this reference.',
    'catalog.err.photo_rejected':
      'The supplier photo could not be prepared (cutout) — try another reference.',
    'catalog.err.generic': 'Could not load this reference.',
    'catalog.card.colours': '{n} colours',
    'catalog.card.gsm': '{g} gsm',
    'catalog.card.rrp': 'RRP €{price}',
    'catalog.back': 'Back to the catalogue',
    'catalog.detail.colour': 'Colour',
    'catalog.detail.colour_note':
      'Photos shot in {colour}: the chosen colour is recorded on the product sheet (per-colour visuals will come with the API).',
    'catalog.detail.size': 'Reference size',
    'catalog.detail.size_note':
      'Official flat measurements: half chest {chest} · length {length}.',
    'catalog.detail.sleeve_note': 'Sleeve {sleeve} — estimated, not published by Imbretex.',
    'catalog.detail.sizes_dropped': 'Sizes {list} are outside the studio range — skipped.',
    'catalog.detail.marking': 'Certified decoration',
    'catalog.detail.spec': 'Spec sheet',
    'catalog.detail.gender': 'Fit',
    'catalog.detail.material': 'Fabric',
    'catalog.detail.origin': 'Origin',
    'catalog.detail.weight': 'Weight',
    'catalog.detail.ref': 'Reference',
    'catalog.detail.rrp': 'Recommended retail',
    'catalog.detail.rrp_note': 'Supplier recommended retail price — not our purchase cost.',
    'catalog.detail.source': 'Imbretex page',
    'catalog.detail.no_back': 'No back photo — front printing only.',
    'catalog.use': 'Use in the editor',
    'catalog.busy.front': 'Importing the front…',
    'catalog.busy.back': 'Importing the back…',
    'catalog.toast.applied': '“{name}” ({size}) loaded in the editor',
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
