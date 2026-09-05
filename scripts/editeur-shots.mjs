#!/usr/bin/env node
/**
 * L'éditeur dans la page, photographié : 375 px puis 1440 px, du vêtement nu
 * jusqu'à la ligne de panier.
 *
 *   npm run wp:up
 *   npx wrangler dev --ip 0.0.0.0 --port 8788 --var SHOP_ORIGINS:http://localhost:8080
 *   npm run verify:editeur-shots
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN SCRIPT ET PAS DES CAPTURES PRISES À LA MAIN
 *
 * Une capture prise à la main est vraie le jour où elle est prise et jamais
 * vérifiable ensuite. Celui-ci REJOUE l'achat : il dépose un vrai PNG à marges
 * transparentes, remplit une taille, attend le prix que le serveur renvoie,
 * clique, et ne photographie l'écran de confirmation que s'il est vraiment
 * apparu. Une image de ce répertoire est donc l'état d'un achat qui a marché,
 * ou le script sort en erreur et il n'y a pas d'image.
 *
 * Il ne remplace pas `scripts/wp-e2e-verify.mjs`, qui assère ; celui-ci
 * photographie, et il échoue seulement quand il ne peut pas aller au bout.
 *
 * Env :
 *   SHOTS_OUT=/abs/dir   où écrire (défaut docs/screens/nuit-3)
 *   SHOTS_URL=http://…   la fiche produit à photographier
 */
import { mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = process.env.SHOTS_OUT ?? `${ROOT}docs/screens/nuit-3`
const URL_FICHE =
  process.env.SHOTS_URL ??
  'http://localhost:8080/produit/gildan-heavy-cotton-adult-t-shirt-a-personnaliser-18009/'

// --- un vrai PNG, à marges transparentes, écrit ici ------------------------
// Il DOIT être un vrai PNG (le Worker décide du format par les octets) et il
// doit être surtout vide, parce que c'est à quoi ressemble le logo d'un client
// et c'est ce que `sideArtworkSqCm` existe pour ne pas facturer.
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const bloc = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function logoClient(taille = 320, marge = 0.26) {
  const w = taille
  const h = taille
  const brut = Buffer.alloc((w * 4 + 1) * h, 0)
  const x0 = Math.round(w * marge)
  const x1 = w - x0
  const y0 = Math.round(h * marge)
  const y1 = h - y0
  for (let y = 0; y < h; y++) {
    const ligne = y * (w * 4 + 1)
    for (let x = 0; x < w; x++) {
      const o = ligne + 1 + x * 4
      const dans = x >= x0 && x < x1 && y >= y0 && y < y1
      // Un anneau, pour qu'on voie tout de suite le placement sur la capture.
      const cx = w / 2
      const cy = h / 2
      const r = Math.hypot(x - cx, y - cy)
      if (dans && r > taille * 0.16 && r < taille * 0.24) {
        brut[o] = 1
        brut[o + 1] = 0
        brut[o + 2] = 80
        brut[o + 3] = 255
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(brut)),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

const fait = []
let navigateur

function mourir(pourquoi) {
  console.error(`\nFATAL  ${pourquoi}\n`)
  try {
    navigateur?.close()
  } catch {}
  process.exit(1)
}

/** Écarter le bandeau de consentement, qui recouvre la moitié basse de l'écran. */
async function ecarterBandeau(page) {
  for (const nom of ['Tout refuser', 'Tout accepter']) {
    const b = page.getByRole('button', { name: nom })
    if ((await b.count()) > 0) {
      await b.first().click({ timeout: 5000 }).catch(() => {})
      return
    }
  }
}

async function serie(largeur, hauteur, prefixe, { avancee = false } = {}) {
  const ctx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur } })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(e.message.slice(0, 160)))

  await page.goto(URL_FICHE, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2200)
  await ecarterBandeau(page)
  await page.waitForTimeout(400)

  const editeur = page.locator('[data-teeshoop-editeur]')
  if ((await editeur.count()) === 0) mourir(`aucun éditeur sur ${URL_FICHE}`)
  await editeur.scrollIntoViewIfNeeded()
  await page.locator('.tshop-ed canvas').first().waitFor({ timeout: 60000 })
  await page.waitForTimeout(800)

  const cliche = async (nom) => {
    const chemin = `${OUT}/${prefixe}-${nom}.png`
    await editeur.screenshot({ path: chemin })
    fait.push(chemin)
  }

  // 1. le vêtement nu, avec sa zone à l'échelle
  await cliche('1-vetement-nu')

  // 2. le visuel posé, et les contrôles qui n'existent que maintenant
  await page.setInputFiles('.tshop-ed__fichier', {
    name: 'logo-client.png',
    mimeType: 'image/png',
    buffer: logoClient(),
  })
  await page.locator('[data-teeshoop="taille-visuel"]').waitFor({ timeout: 25000 })
  await page.waitForTimeout(700)
  await cliche('2-visuel-pose')

  // 3. les tailles, et le prix que le serveur a rendu
  await page.getByLabel('Quantité en M').fill('25')
  await page.locator('[data-teeshoop="price"]').waitFor({ timeout: 30000 })
  await page.waitForTimeout(900)
  await cliche('3-prix-serveur')

  // 4. la vue avancée, ouverte, avec son morceau chargé à la demande
  if (avancee) {
    await page.locator('[data-teeshoop="vue-avancee"]').click()
    await page.locator('.tshop-ed__avancee').waitFor({ timeout: 30000 })
    await page.waitForTimeout(700)
    await cliche('4-vue-avancee')

    /*
     * 4 bis. L'APERÇU EN VOLUME, ET IL EST PHOTOGRAPHIÉ APRÈS AVOIR RENDU.
     *
     * `buildArModel` construit le vêtement puis three.js le charge : prendre la
     * capture au clic donnerait un canevas noir, c'est-à-dire une preuve que
     * rien ne marche présentée comme une preuve que tout marche. On attend que
     * la phrase de chargement ait disparu, puis une seconde de rotation.
     */
    await page.locator('[data-teeshoop="apercu-volume"]').click()
    const canvas3d = page.locator('[data-teeshoop="apercu-3d"]')
    await canvas3d.waitFor({ timeout: 60000 }).catch(() => {})
    await page
      .waitForFunction(
        () => {
          const c = document.querySelector('[data-teeshoop="apercu-3d"]')
          return c instanceof HTMLCanvasElement && c.width > 2 && c.height > 2
        },
        null,
        { timeout: 90000 },
      )
      .catch(() => {})
    await page.waitForTimeout(2500)
    await cliche('5-apercu-volume')

    // 4 ter. L'essayage : le modèle monte sur R2 et le client scanne.
    const essai = page.locator('[data-teeshoop="essayer-ar"]')
    if ((await essai.count()) > 0) {
      await essai.click()
      const pret = await page
        .locator('[data-teeshoop="ar-pret"]')
        .waitFor({ timeout: 120000 })
        .then(() => true)
        .catch(() => false)
      if (pret) {
        await page.waitForTimeout(600)
        await cliche('6-essayage-ar')
      } else {
        console.log(`  ${prefixe} : l'essayage n'a pas abouti, pas de capture`)
      }
    }

    await page.locator('[data-teeshoop="vue-avancee"]').click()
    await page.waitForTimeout(400)
  }

  // 5. l'ajout, et la confirmation, seulement si elle est vraiment arrivée
  await page.locator('[data-teeshoop="add-to-cart"]').click()
  const issue = await Promise.race([
    page.locator('[data-teeshoop="cart-done"]').waitFor({ timeout: 120000 }).then(() => 'ok'),
    page.locator('[data-teeshoop="cart-error"]').waitFor({ timeout: 120000 }).then(() => 'erreur'),
  ]).catch(() => 'silence')
  if (issue !== 'ok') {
    const quoi = await page.locator('[data-teeshoop="cart-error"]').textContent().catch(() => '')
    mourir(`l'ajout au panier a répondu « ${issue} » : ${quoi || 'rien'}`)
  }
  await cliche('7-ajoute-au-panier')

  // 6. la ligne de panier, page entière : c'est la boutique qui parle
  await page.goto(`${new URL(URL_FICHE).origin}/panier/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)
  const cheminPanier = `${OUT}/${prefixe}-8-ligne-de-panier.png`
  await page.screenshot({ path: cheminPanier, fullPage: true })
  fait.push(cheminPanier)

  if (erreurs.length) console.log(`  ${prefixe} : ${erreurs.length} erreur(s) de page : ${erreurs[0]}`)
  await ctx.close()
}

mkdirSync(OUT, { recursive: true })
navigateur = await chromium.launch({ args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'] })
try {
  console.log('375 px, mobile d’abord ...')
  await serie(375, 812, '375', { avancee: true })
  console.log('1440 px ...')
  await serie(1440, 1000, '1440', { avancee: true })
} catch (e) {
  mourir(e?.stack || e?.message || String(e))
}
await navigateur.close()

if (fait.length === 0) {
  // « Rien trouvé » et « rien regardé » ne sont pas le même résultat.
  console.error('editeur-shots : AUCUNE capture écrite.')
  process.exit(2)
}
console.log(`\nediteur-shots : ${fait.length} captures dans ${OUT}`)
for (const f of fait) console.log(`  ${f.replace(ROOT, '')}`)
