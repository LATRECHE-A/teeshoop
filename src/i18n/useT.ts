/**
 * `useT`, séparé de `t`, et la raison est une arête d'import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE LE CROCHET TRAÎNAIT DERRIÈRE LUI
 *
 * `useT` s'abonne à la langue par `useStore`, donc `src/i18n/index.ts` importait
 * `@/state/store`. Tout ce qui appelait `t()` importait donc le magasin entier,
 * et avec lui `sampleDesign.ts`, `migrate.ts`, `prefs.ts`, `basket.ts`,
 * `board.ts`, `history.ts`, zustand et zundo. Mesuré le 5 septembre 2026 sur le
 * graphe de l'éditeur natif : `EditorEngine` appelle `t()` pour une seule
 * étiquette, l'étiquette de la zone d'impression, et cette étiquette faisait
 * descendre `makeSampleDesign()` chez le client, c'est-à-dire le t-shirt noir
 * portant « TSHOP » en arche que cette nuit existe pour ne plus jamais montrer.
 * Elle faisait aussi descendre `prefs.ts`, qui importe `@/scenes`, les décors 3D.
 *
 * Rien de tout cela n'est un défaut du magasin : c'est un crochet React dans un
 * module que du code sans React importe. Les deux sont maintenant dans deux
 * fichiers, et `scripts/editeur-guard.mjs` échoue si l'arête revient.
 *
 * `t()` reste dans `./index` et n'a besoin que de `./lang` et de `./messages`.
 */
import { useStore } from '@/state/store'
import { resolve, type TParams } from './index'

/** Traduction réactive, liée à la langue du magasin. */
export function useT(): (key: string, params?: TParams) => string {
  const lang = useStore((s) => s.lang)
  return (key: string, params?: TParams) => resolve(lang, key, params)
}
