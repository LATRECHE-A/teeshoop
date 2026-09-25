/**
 * Les binaires npm du projet, lancés par `node` lui-même et jamais par `npx`.
 *
 * Sous Windows, `npx` est `npx.cmd` : `spawn('npx', …)` rend ENOENT, et depuis
 * Node 20.12 un `.cmd` ne se lance plus sans `shell: true`. Un shell intercalé a
 * un second défaut, pire pour un harnais : `kill()` tue le shell et laisse le
 * serveur vite ou wrangler orphelin, qui garde son port, et le harnais suivant
 * échoue sur `--strictPort`. Lancer le fichier JS du binaire avec
 * `process.execPath` se comporte à l'identique sous Linux et sous Windows, et
 * `kill()` atteint le vrai processus.
 */
import { fileURLToPath } from 'node:url'

const bin = (chemin) => fileURLToPath(new URL(`../node_modules/${chemin}`, import.meta.url))

export const NODE = process.execPath
export const VITE = bin('vite/bin/vite.js')
export const WRANGLER = bin('wrangler/bin/wrangler.js')
