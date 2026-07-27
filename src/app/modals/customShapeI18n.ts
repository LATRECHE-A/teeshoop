/**
 * Custom-garment SHAPE picker — UI strings side-file (module-owned; the
 * integrator merges I18N into src/i18n/messages.ts). French is first-class,
 * English faithful.
 *
 * `useShapeT` resolves `custom.shape.*` keys from THIS file immediately (so the
 * module works before the merge) and falls back to the global runtime for
 * shared keys — after the merge both paths yield identical strings.
 *
 * The vocabulary is deliberately the one a French print shop uses on a quote
 * (« débardeur », « sweat à capuche »), not a literal translation of the code's
 * shape ids.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from '@/i18n'
import type { GarmentShape } from '@/lib/garmentShape'

export const I18N: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    'custom.shape.label': 'Type de vêtement',
    'custom.shape.auto': 'Détection automatique',
    'custom.shape.auto_is': 'détecté : {shape}',
    'custom.shape.hint':
      'Détermine le volume 3D : le vêtement reprend la profondeur réelle du modèle correspondant (poitrine, épaules, manches). Corrigez-le si la détection se trompe.',
    'custom.shape.tee': 'T-shirt',
    'custom.shape.polo': 'Polo',
    'custom.shape.tank': 'Débardeur',
    'custom.shape.longsleeve': 'Manches longues',
    'custom.shape.sweatshirt': 'Sweat',
    'custom.shape.hoodie': 'Sweat à capuche',
    'custom.shape.unsure':
      "La photo n'a pas l'allure d'un vêtement (col, ligne d'épaules, tissu en haut). Le volume 3D reste neutre — choisissez le type ci-dessus pour l'appliquer quand même.",
    'custom.back.generate': 'Générer le dos',
    'custom.back.generating': 'Génération du dos…',
    'custom.back.generated': 'Dos reconstitué',
    'custom.back.hint':
      "Reconstitue le dos à partir de l'avant (silhouette miroir remplie de la couleur du vêtement). Pour la prévisualisation et le placement — ce n'est pas une photo de votre dos.",
    'custom.back.needs_cutout': "Détourez d'abord l'avant pour pouvoir générer le dos.",
    'custom.back.err': 'Impossible de générer le dos.',
  },
  en: {
    'custom.shape.label': 'Garment type',
    'custom.shape.auto': 'Detect automatically',
    'custom.shape.auto_is': 'detected: {shape}',
    'custom.shape.hint':
      'Sets the 3D volume: the garment borrows the real depth of the matching model (chest, shoulders, sleeves). Override it if the detection gets it wrong.',
    'custom.shape.tee': 'T-shirt',
    'custom.shape.polo': 'Polo',
    'custom.shape.tank': 'Tank top',
    'custom.shape.longsleeve': 'Long sleeve',
    'custom.shape.sweatshirt': 'Sweatshirt',
    'custom.shape.hoodie': 'Hoodie',
    'custom.shape.unsure':
      'This photo does not read as a garment (no collar, shoulder line or cloth across the top). The 3D volume stays neutral — pick a type above to apply one anyway.',
    'custom.back.generate': 'Generate the back',
    'custom.back.generating': 'Generating the back…',
    'custom.back.generated': 'Reconstructed back',
    'custom.back.hint':
      'Rebuilds the back from the front (mirrored silhouette flooded with the garment colour). For preview and placement — it is not a photo of your garment’s back.',
    'custom.back.needs_cutout': 'Cut out the front first so the back can be generated.',
    'custom.back.err': 'Could not generate the back.',
  },
}

/** The i18n key naming a garment family. */
export const shapeKey = (shape: GarmentShape): string => `custom.shape.${shape}`

function format(str: string, params?: TParams): string {
  if (!params) return str
  return str.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m,
  )
}

/**
 * Reactive translate for the shape picker: `custom.shape.*` resolves from this
 * side-file; anything else falls through to the global i18n runtime.
 */
export function useShapeT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key, params) => {
    const local = I18N[lang]?.[key] ?? I18N.fr[key]
    return local !== undefined ? format(local, params) : resolve(lang, key, params)
  }
}
