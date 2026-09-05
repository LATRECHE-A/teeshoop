#!/usr/bin/env node
/**
 * Le CORS des deux routes de création, contre un vrai Worker.
 *
 *   npm run verify:cors
 *
 * worker/cors.test.ts prouve la logique. Ce script prouve le DÉPLOIEMENT :
 * il lance `wrangler dev` sur le vrai `worker/index.ts` avec les vrais actifs
 * de `dist/`, et parle à ce serveur en HTTP. Entre les deux il y a la table de
 * routage, l'ordre des règles et `assets.not_found_handling`, et c'est là que
 * ce genre de changement meurt en silence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON N'ASSERTE JAMAIS SUR LE CODE DE STATUT SEUL.
 *
 * `assets.not_found_handling` vaut `single-page-application`. Toute URL sans
 * route rend donc 200 avec la page du studio, et une sonde qui lit « 200 donc
 * la route existe » ne peut pas échouer, ce que CLAUDE.md interdit. Chaque
 * assertion ici lit LE CORPS : le préflight doit rendre un corps VIDE, la
 * lecture d'un identifiant inconnu doit rendre le JSON `{"error":"not found"}`,
 * et la page HTML de repli est reconnue et nommée comme un échec.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ, ET POURQUOI CHACUN
 *
 *   L'origine autorisée est rendue TELLE QUELLE. Sinon la boutique ne peut pas
 *   lire l'identifiant de création et l'achat s'arrête une étape avant le panier.
 *
 *   Un PRÉFIXE de cette origine ne l'est pas. `teeshoop.com.evil.tld` est un
 *   domaine que n'importe qui enregistre, et `startsWith` y passe.
 *
 *   `*` n'apparaît jamais, et `access-control-allow-credentials` jamais non plus.
 *
 *   `vary: origin` est là même sur les refus, sinon un cache intermédiaire sert
 *   à un inconnu l'en-tête calculé pour la boutique.
 *
 *   Les routes voisines (`/api/nest`, `/api/fr/*`, la suppression) n'en ont pas.
 *
 * Env :
 *   TSHOP_CORS_BASE=http://…   parler à un Worker déjà lancé au lieu d'en
 *                              démarrer un (utilisé par verify:wp-e2e)
 *   TSHOP_CORS_ORIGIN=https://…  l'origine attendue comme autorisée
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = 8791
const EXTERNAL = process.env.TSHOP_CORS_BASE ?? ''
const BASE = EXTERNAL || `http://127.0.0.1:${PORT}`
const SHOP = process.env.TSHOP_CORS_ORIGIN ?? 'https://teeshoop.com'
/** Le préfixe qui passe pour un `startsWith` et qui est un autre site. */
const LOOKALIKE = `${SHOP}.evil.tld`

const results = []
const ok = (name, pass, extra = '') => {
  results.push({ name, pass, extra })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`)
  return pass
}

let worker = null
const done = (code) => {
  try {
    worker?.kill('SIGTERM')
  } catch {}
  process.exit(code)
}

const waitFor = async (url, ms) => {
  const start = Date.now()
  for (;;) {
    try {
      await fetch(url)
      return true
    } catch {
      /* pas encore */
    }
    if (Date.now() - start > ms) return false
    await new Promise((r) => setTimeout(r, 400))
  }
}

/** Le corps, plus ce qu'il faut pour dire « c'est la page de repli ». */
async function probe(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init)
  const body = await res.text()
  return {
    status: res.status,
    body,
    /*
     * LA PAGE DE REPLI, RECONNUE. Sans ça, une route supprimée par erreur
     * répondrait 200 avec du HTML et chaque assertion « pas d'en-tête CORS »
     * serait verte pour la mauvaise raison.
     */
    spa: /<!doctype html|<html/i.test(body),
    acao: res.headers.get('access-control-allow-origin'),
    acam: res.headers.get('access-control-allow-methods'),
    acac: res.headers.get('access-control-allow-credentials'),
    vary: res.headers.get('vary'),
  }
}

try {
  if (!EXTERNAL) {
    console.log(`démarrage de wrangler dev sur ${BASE} ...`)
    worker = spawn(
      'npx',
      ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(PORT), '--log-level', 'warn',
       '--var', `SHOP_ORIGINS:${SHOP}`],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    )
    if (!(await waitFor(`${BASE}/api/design/aaaaaaaaaaaaaaaa`, 90000))) {
      console.error(`FATAL  wrangler dev n'a jamais répondu sur ${BASE}`)
      done(1)
    }
  } else {
    console.log(`Worker déjà lancé : ${BASE}`)
  }

  // --- 0. la sonde elle-même sait reconnaître le repli monopage -------------
  // Sans cette ligne, tout ce qui suit pourrait mesurer des pages HTML.
  const nowhere = await probe('/cette-route-n-existe-pas')
  ok(
    'le repli monopage est bien actif, et la sonde le reconnaît',
    nowhere.status === 200 && nowhere.spa,
    `HTTP ${nowhere.status}, ${nowhere.body.length} octets, spa=${nowhere.spa}`,
  )

  // --- 1. GET /api/design/{id}, origine autorisée ---------------------------
  const readAllowed = await probe('/api/design/aaaaaaaaaaaaaaaa', { headers: { origin: SHOP } })
  ok(
    'GET /api/design/{id} est bien la route et pas la page de repli',
    !readAllowed.spa && readAllowed.body.includes('"error"'),
    `HTTP ${readAllowed.status} ${readAllowed.body.slice(0, 60)}`,
  )
  ok(
    "GET rend l'origine de la boutique, telle quelle",
    readAllowed.acao === SHOP,
    `${readAllowed.acao}`,
  )
  ok('et jamais le joker', readAllowed.acao !== '*')
  ok('et jamais les identifiants', readAllowed.acac === null, String(readAllowed.acac))
  ok(
    'vary porte Origin',
    (readAllowed.vary ?? '').toLowerCase().includes('origin'),
    String(readAllowed.vary),
  )

  // --- 2. le sosie ----------------------------------------------------------
  const readLookalike = await probe('/api/design/aaaaaaaaaaaaaaaa', { headers: { origin: LOOKALIKE } })
  ok(
    "un préfixe de l'origine autorisée n'obtient rien",
    readLookalike.acao === null,
    `${LOOKALIKE} -> ${readLookalike.acao}`,
  )
  ok(
    'et le refus porte quand même vary: Origin',
    (readLookalike.vary ?? '').toLowerCase().includes('origin'),
    String(readLookalike.vary),
  )

  // --- 3. le préflight ------------------------------------------------------
  const pre = await probe('/api/design', {
    method: 'OPTIONS',
    headers: { origin: SHOP, 'access-control-request-method': 'POST' },
  })
  ok(
    'OPTIONS /api/design est traité par le Worker, corps vide',
    pre.body.length === 0 && !pre.spa,
    `HTTP ${pre.status}, ${pre.body.length} octets`,
  )
  ok('le préflight autorise POST', (pre.acam ?? '').includes('POST'), String(pre.acam))
  ok("le préflight rend l'origine", pre.acao === SHOP, String(pre.acao))

  const preBad = await probe('/api/design', {
    method: 'OPTIONS',
    headers: { origin: LOOKALIKE, 'access-control-request-method': 'POST' },
  })
  ok(
    "le préflight ne dit rien à une origine qui n'est pas la nôtre",
    preBad.acao === null && preBad.acam === null,
    `${preBad.acao} / ${preBad.acam}`,
  )

  const preId = await probe('/api/design/aaaaaaaaaaaaaaaa', {
    method: 'OPTIONS',
    headers: { origin: SHOP, 'access-control-request-method': 'GET' },
  })
  ok(
    'OPTIONS /api/design/{id} aussi, et pour un identifiant inconnu',
    preId.body.length === 0 && (preId.acam ?? '').includes('GET'),
    `HTTP ${preId.status}, ${preId.acam}`,
  )

  // --- 4. un vrai dépôt, lu par une page ------------------------------------
  /*
   * LE SEUL TEST QUI MESURE CE DONT L'ACHAT DÉPEND. Les précédents lisent des
   * refus ; celui-ci envoie un document qui ne parse pas et vérifie que la
   * RÉPONSE est lisible par la boutique. C'est cette lecture, et rien d'autre,
   * qui manquait et qui aurait tué l'ajout au panier à trois heures du matin.
   */
  const form = new FormData()
  form.append('design', new Blob(['pas du json']), 'design.json')
  form.append('preview', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'preview.png')
  const post = await fetch(`${BASE}/api/design`, { method: 'POST', body: form, headers: { origin: SHOP } })
  const postBody = await post.text()
  ok(
    'POST /api/design répond en JSON à une origine autorisée, et le corps est lisible',
    post.headers.get('access-control-allow-origin') === SHOP && postBody.includes('"error"'),
    `HTTP ${post.status} acao=${post.headers.get('access-control-allow-origin')} ${postBody.slice(0, 60)}`,
  )

  const postBad = await fetch(`${BASE}/api/design`, {
    method: 'POST',
    body: form,
    headers: { origin: LOOKALIKE },
  })
  await postBad.text()
  ok(
    "POST /api/design ne se laisse pas lire par le sosie",
    postBad.headers.get('access-control-allow-origin') === null,
    String(postBad.headers.get('access-control-allow-origin')),
  )

  // --- 5. les routes voisines n'ont rien gagné ------------------------------
  for (const [label, path, init] of [
    ['/api/nest (économie du film)', '/api/nest', { method: 'POST', headers: { origin: SHOP } }],
    ['/api/fr/* (nos prix d’achat)', '/api/fr/catalog', { headers: { origin: SHOP } }],
    ['la suppression RGPD', '/api/design/aaaaaaaaaaaaaaaa', { method: 'DELETE', headers: { origin: SHOP } }],
    ['la preuve en image', '/r2/design/aaaaaaaaaaaaaaaa/preview.png', { headers: { origin: SHOP } }],
  ]) {
    const r = await probe(path, init)
    ok(`${label} reste sans en-tête CORS`, r.acao === null, `acao=${r.acao}`)
  }
} catch (e) {
  console.error('\nFATAL ', e?.stack || e?.message || e)
  results.push({ name: 'le harnais est allé au bout', pass: false, extra: String(e?.message || e) })
}

console.log('')
if (results.length === 0) {
  // « rien trouvé » et « rien regardé » ne sont pas le même résultat.
  console.error('cors: AUCUNE ASSERTION N’A TOURNÉ. Un vert ici ne voudrait rien dire.')
  done(2)
}
const failed = results.filter((r) => !r.pass)
if (failed.length) {
  console.error(`cors ÉCHEC : ${failed.length} assertions sur ${results.length}`)
  for (const f of failed) console.error(`  - ${f.name}${f.extra ? '  ' + f.extra : ''}`)
  done(1)
}
console.log(`cors OK : ${results.length} assertions`)
done(0)
