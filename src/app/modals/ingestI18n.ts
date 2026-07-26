/**
 * INGEST — UI strings side-file (module-owned; the integrator merges I18N
 * into src/i18n/messages.ts). French is first-class, English faithful.
 *
 * `useIngestT` resolves `ingest.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys (common.*, side.*, custom.*) — after the merge both paths
 * yield identical strings.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'ingest.title': 'Ingestion produit',
    'ingest.subtitle':
      'Deux photos + un tableau de tailles en cm → un vêtement prêt pour le studio (2D, 3D, AR).',
    'ingest.list.new': 'Nouveau produit',
    'ingest.list.import': 'Importer un fichier',
    'ingest.list.export': 'Exporter',
    'ingest.list.empty': 'Aucun produit pour l’instant',
    'ingest.list.empty_hint':
      'Créez un produit à partir de deux photos, ou importez un fichier .json exporté sur une autre machine.',
    'ingest.list.delete_confirm': 'Confirmer ?',
    'ingest.list.sizes': '{n} tailles',
    'ingest.ed.back': 'Bibliothèque',
    'ingest.ed.name': 'Nom du produit',
    'ingest.ed.name_ph': 'T-shirt bio 180 g',
    'ingest.ed.brand': 'Référence fabricant',
    'ingest.ed.brand_ph': 'Stanley/Stella Creator STTU755',
    'ingest.ed.notes': 'Notes',
    'ingest.ed.notes_ph': 'Grammage, coloris disponibles…',
    'ingest.ed.photos': 'Photos du vêtement',
    'ingest.ph.store': 'Enregistrement…',
    'ingest.ph.cutout': 'Détourage…',
    'ingest.ph.measure': 'Analyse…',
    'ingest.err.decode_failed': 'Photo illisible — réessayez avec un JPG ou PNG net.',
    'ingest.err.cutout_failed':
      'Détourage impossible sur cette photo — reprenez-la sur fond uni et bien éclairé.',
    'ingest.err.low_coverage':
      'Le vêtement est trop petit dans le cadre (moins de 3 % de l’image).',
    'ingest.err.bad_aspect':
      'Les proportions détectées ne ressemblent pas à un vêtement posé à plat.',
    'ingest.area.auto': 'Suggestion auto',
    'ingest.sizes.title': 'Tableau des tailles — cm à plat',
    'ingest.sizes.size': 'Taille',
    'ingest.sizes.chest': 'Mi-poitrine',
    'ingest.sizes.body': 'Longueur corps',
    'ingest.sizes.sleeve': 'Manche',
    'ingest.sizes.default': 'Taille de référence (photos + zones)',
    'ingest.sizes.paste_hint':
      'Astuce : collez un tableau ici (lignes S→3XL, colonnes mi-poitrine / corps / manche — virgules décimales acceptées).',
    'ingest.sizes.prefill_tee': 'Copier la charte tee',
    'ingest.sizes.prefill_hoodie': 'Copier la charte hoodie',
    'ingest.sizes.pasted': '{n} tailles lues depuis le presse-papiers',
    'ingest.sizes.paste_empty': 'Aucune ligne de mesures reconnue dans le texte collé',
    'ingest.woo.title': 'WooCommerce',
    'ingest.woo.hint': 'Récupérez les photos produit directement depuis votre boutique.',
    'ingest.woo.url': 'URL de la boutique',
    'ingest.woo.key': 'Consumer key',
    'ingest.woo.secret': 'Consumer secret',
    'ingest.woo.local_notice':
      'Identifiants conservés uniquement sur cet appareil (localStorage) — jamais envoyés ailleurs qu’à votre boutique.',
    'ingest.woo.fetch': 'Charger les produits',
    'ingest.woo.fetching': 'Chargement…',
    'ingest.woo.use': 'Utiliser les photos',
    'ingest.woo.importing': 'Import des photos…',
    'ingest.woo.err_cors':
      'La boutique refuse les requêtes du studio (CORS). Autorisez l’origine du studio côté WordPress (plugin/en-têtes CORS) — ou utilisez le studio en même origine, en plugin WP.',
    'ingest.woo.err_auth': 'Authentification refusée ({status}) — vérifiez la consumer key et le secret.',
    'ingest.woo.err_http': 'Erreur boutique — HTTP {status}.',
    'ingest.woo.err_parse': 'Réponse inattendue — est-ce bien une boutique WooCommerce ?',
    'ingest.woo.empty': 'Aucun produit publié trouvé.',
    'ingest.woo.page': 'page {page}',
    'ingest.unnamed': 'Produit sans nom',
    'ingest.save': 'Enregistrer le produit',
    'ingest.use_studio': 'Utiliser dans le studio',
    'ingest.toast.saved': 'Produit « {name} » enregistré',
    'ingest.toast.applied': '« {name} » ({size}) chargé dans le studio',
    'ingest.toast.deleted': 'Produit supprimé',
    'ingest.toast.imported': 'Produit « {name} » importé',
    'ingest.toast.import_failed': 'Fichier produit invalide',
    'ingest.toast.export_failed': 'Export impossible — photos introuvables',
    'ingest.toast.need_front': 'Ajoutez au moins la photo de face',
    'ingest.toast.need_size': 'Renseignez au moins une taille',
    'ingest.toast.woo_photos': 'Photos importées — vérifiez les zones d’impression',
  },
  en: {
    'ingest.title': 'Product ingest',
    'ingest.subtitle':
      'Two photos + a per-size cm table → a studio-ready garment (2D, 3D, AR).',
    'ingest.list.new': 'New product',
    'ingest.list.import': 'Import a file',
    'ingest.list.export': 'Export',
    'ingest.list.empty': 'No products yet',
    'ingest.list.empty_hint':
      'Create a product from two photos, or import a .json file exported on another machine.',
    'ingest.list.delete_confirm': 'Confirm?',
    'ingest.list.sizes': '{n} sizes',
    'ingest.ed.back': 'Library',
    'ingest.ed.name': 'Product name',
    'ingest.ed.name_ph': 'Organic tee 180 g',
    'ingest.ed.brand': 'Manufacturer reference',
    'ingest.ed.brand_ph': 'Stanley/Stella Creator STTU755',
    'ingest.ed.notes': 'Notes',
    'ingest.ed.notes_ph': 'Fabric weight, available colours…',
    'ingest.ed.photos': 'Garment photos',
    'ingest.ph.store': 'Storing…',
    'ingest.ph.cutout': 'Removing background…',
    'ingest.ph.measure': 'Measuring…',
    'ingest.err.decode_failed': 'Unreadable photo — try again with a clean JPG or PNG.',
    'ingest.err.cutout_failed':
      'Could not cut out this photo — reshoot it on a plain, well-lit background.',
    'ingest.err.low_coverage':
      'The garment is too small in the frame (under 3% of the image).',
    'ingest.err.bad_aspect':
      'The detected proportions do not look like a laid-flat garment.',
    'ingest.area.auto': 'Auto suggest',
    'ingest.sizes.title': 'Size table — flat cm',
    'ingest.sizes.size': 'Size',
    'ingest.sizes.chest': 'Half chest',
    'ingest.sizes.body': 'Body length',
    'ingest.sizes.sleeve': 'Sleeve',
    'ingest.sizes.default': 'Reference size (photos + areas)',
    'ingest.sizes.paste_hint':
      'Tip: paste a table here (rows S→3XL, columns half chest / body / sleeve — comma decimals accepted).',
    'ingest.sizes.prefill_tee': 'Copy tee chart',
    'ingest.sizes.prefill_hoodie': 'Copy hoodie chart',
    'ingest.sizes.pasted': '{n} sizes read from the clipboard',
    'ingest.sizes.paste_empty': 'No measurement rows recognized in the pasted text',
    'ingest.woo.title': 'WooCommerce',
    'ingest.woo.hint': 'Pull product photos straight from your store.',
    'ingest.woo.url': 'Store URL',
    'ingest.woo.key': 'Consumer key',
    'ingest.woo.secret': 'Consumer secret',
    'ingest.woo.local_notice':
      'Credentials are stored locally on this device only (localStorage) — never sent anywhere but your store.',
    'ingest.woo.fetch': 'Load products',
    'ingest.woo.fetching': 'Loading…',
    'ingest.woo.use': 'Use the photos',
    'ingest.woo.importing': 'Importing photos…',
    'ingest.woo.err_cors':
      'The store rejects requests from the studio (CORS). Allow the studio origin on the WordPress site (CORS plugin/headers) — or run the studio same-origin as a WP plugin.',
    'ingest.woo.err_auth': 'Authentication refused ({status}) — check the consumer key and secret.',
    'ingest.woo.err_http': 'Store error — HTTP {status}.',
    'ingest.woo.err_parse': 'Unexpected response — is this really a WooCommerce store?',
    'ingest.woo.empty': 'No published products found.',
    'ingest.woo.page': 'page {page}',
    'ingest.unnamed': 'Untitled product',
    'ingest.save': 'Save product',
    'ingest.use_studio': 'Use in studio',
    'ingest.toast.saved': 'Product “{name}” saved',
    'ingest.toast.applied': '“{name}” ({size}) loaded in the studio',
    'ingest.toast.deleted': 'Product deleted',
    'ingest.toast.imported': 'Product “{name}” imported',
    'ingest.toast.import_failed': 'Invalid product file',
    'ingest.toast.export_failed': 'Export failed — photos missing',
    'ingest.toast.need_front': 'Add at least the front photo',
    'ingest.toast.need_size': 'Fill in at least one size',
    'ingest.toast.woo_photos': 'Photos imported — review the print areas',
  },
}

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the ingest UI: `ingest.*` resolves from this
 * side-file; anything else falls through to the global i18n runtime.
 */
export function useIngestT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
