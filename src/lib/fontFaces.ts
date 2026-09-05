/**
 * Les treize feuilles `@font-face` des polices d'impression, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI ELLES ONT QUITTÉ `src/lib/fonts.ts`
 *
 * `fonts.ts` est atteint depuis `renderDesign.ts`, donc depuis `ink.ts`, donc
 * depuis tout ce qui mesure une surface, y compris un éditeur qui ne propose
 * aucun texte. Les imports de CSS sont des effets de bord : le paquet client
 * emportait les treize déclarations et les fichiers woff2 qui vont avec, pour
 * une vue simple qui n'écrit jamais un mot.
 *
 * Mesuré sur le paquet natif du 5 septembre 2026 : la feuille tombe de 27,73 ko
 * à 4,0 ko, et 1,5 Mo de fontes cessent d'être référencées par la première
 * charge. Le studio y gagne la même chose.
 *
 * `ensureFont` importe ce module dynamiquement avant de demander une famille au
 * navigateur, et c'est le seul endroit d'où il est importé. Sans cet ordre, un
 * `document.fonts.load()` posé avant la déclaration `@font-face` se résout avec
 * zéro fonte chargée et le canevas dessine en police de repli, sans erreur.
 */
import '@fontsource/anton/400.css'
import '@fontsource/archivo-black/400.css'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/600.css'
import '@fontsource/russo-one/400.css'
import '@fontsource/alfa-slab-one/400.css'
import '@fontsource/bangers/400.css'
import '@fontsource/righteous/400.css'
import '@fontsource/permanent-marker/400.css'
import '@fontsource/pacifico/400.css'
import '@fontsource/lobster/400.css'
import '@fontsource/special-elite/400.css'

/** Une valeur exportée, pour que le module ne soit pas élagué comme vide. */
export const FONT_FACES_LOADED = true
