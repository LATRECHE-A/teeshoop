#!/usr/bin/env node
/**
 * Une fiche produit peut-elle vendre, oui ou non, et si non on remet ce qui
 * vendait avant.
 *
 *   npm run verify:vendable
 *   npm run verify:vendable -- --retablir   (autorise la remise en état)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SCRIPT EXISTE, ET POURQUOI IL EST LE DERNIER
 *
 * Une nuit qui finit avec le cadre retiré et le chemin natif pas vert laisse la
 * fiche produit incapable de vendre quoi que ce soit, ce qui est STRICTEMENT
 * PIRE qu'avant. Tous les autres harnais de ce dépôt vérifient qu'une chose
 * marche ; celui-ci vérifie qu'il RESTE quelque chose qui marche, ce qui n'est
 * pas la même question et ne se déduit d'aucune des autres.
 *
 * Il ne demande donc pas « l'éditeur natif fonctionne-t-il ». Il demande
 * « existe-t-il un chemin par lequel un visiteur peut acheter cet article »,
 * et il compte trois réponses acceptables, dans cet ordre :
 *
 *   1. l'éditeur natif est monté et son bouton d'achat est offert ;
 *   2. le studio encadré est là et son cadre pointe quelque part ;
 *   3. il n'y a ni l'un ni l'autre, et c'est un ÉCHEC, même si la page rend 200.
 *
 * Le devis ne compte pas comme un chemin d'achat : c'est un formulaire qui
 * envoie un courriel, pas une caisse.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QUE « RÉTABLIR » VEUT DIRE
 *
 * Avec `--retablir` et seulement avec lui, un échec ANNULE le commit qui a
 * retiré le cadre, avec `git revert --no-edit`, puis reconstruit et redemande.
 *
 * IL Y A EU UNE PREMIÈRE ÉTAPE, et elle a été retirée : « éteindre le drapeau
 * `editeur_natif` ». Ce drapeau n'existe plus, parce qu'un drapeau qui ne peut
 * basculer vers rien est un drapeau qui ment, et un secours qui l'éteignait
 * aurait rapporté un succès sans rien changer. Le seul chemin de retour est
 * dans l'historique, et c'est celui-ci.
 *
 * Sans `--retablir` il ne fait que dire, ce qui est le bon défaut : un script
 * qui réécrit l'histoire d'un dépôt sans qu'on le lui ait demandé est pire que
 * le problème qu'il corrige.
 *
 * Env :
 *   VENDABLE_URL=http://…      la fiche à interroger
 *   VENDABLE_COMMIT=<sha>      le commit à annuler si le cadre a disparu
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const URL_FICHE =
  process.env.VENDABLE_URL ??
  'http://localhost:8080/produit/gildan-heavy-cotton-adult-t-shirt-a-personnaliser-18009/'
const RETABLIR = process.argv.includes('--retablir')

const dit = (s) => console.log(s)

/**
 * Ce que la fiche offre, mesuré dans un vrai navigateur.
 *
 * On lit le DOM et jamais le code de statut : une fiche produit rend 200 même
 * quand elle ne porte plus rien à acheter, et c'est exactement le cas que ce
 * script existe pour attraper.
 */
async function interroger(navigateur) {
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(e.message.slice(0, 160)))

  let statut = 0
  try {
    const rep = await page.goto(URL_FICHE, { waitUntil: 'domcontentloaded', timeout: 45000 })
    statut = rep?.status() ?? 0
  } catch (e) {
    await ctx.close()
    return { joignable: false, pourquoi: String(e.message).slice(0, 160) }
  }
  await page.waitForTimeout(2500)
  for (const nom of ['Tout refuser', 'Tout accepter']) {
    const b = page.getByRole('button', { name: nom })
    if ((await b.count()) > 0) {
      await b.first().click({ timeout: 5000 }).catch(() => {})
      break
    }
  }

  // 1. l'éditeur natif
  const conteneur = page.locator('[data-teeshoop-editeur]')
  let natif = { present: (await conteneur.count()) > 0, pret: false, bouton: false }
  if (natif.present) {
    await page.locator('.tshop-ed canvas').first().waitFor({ timeout: 60000 }).catch(() => {})
    natif.pret = (await conteneur.first().getAttribute('data-teeshoop-editeur-etat')) === 'pret'
    const achat = page.locator('[data-teeshoop="add-to-cart"]')
    natif.bouton = (await achat.count()) > 0 && !(await achat.first().isDisabled().catch(() => true))
  }

  // 2. le studio encadré
  const cadre = page.locator('iframe.teeshoop-studio__frame')
  const lien = page.locator('[data-teeshoop-personnaliser]')
  const encadre = {
    cadre: (await cadre.count()) > 0,
    src: (await cadre.first().getAttribute('src').catch(() => '')) ?? '',
    lien: (await lien.count()) > 0,
    lienMene: '',
  }

  /*
   * ── LE LIEN EST SUIVI, PAS COMPTÉ ───────────────────────────────────────
   *
   * La première version de ce script comptait « Personnaliser ce vêtement »
   * comme un chemin d'achat parce que l'ancre existait. Mesuré en cassant les
   * deux chemins exprès : avec `studio_origin` vidé, la fiche portait toujours
   * l'ancre, la page d'arrivée ne portait RIEN, et ce script disait « vend ».
   * Une porte qui compte une poignée sans regarder derrière est une porte qui
   * ne peut pas échouer, ce que `CLAUDE.md` interdit.
   */
  if (encadre.lien && !encadre.cadre) {
    const href = await lien.first().getAttribute('href')
    if (href) {
      try {
        await page.goto(new URL(href, URL_FICHE).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        })
        await page.waitForTimeout(2500)
        const cadreLa = page.locator('iframe.teeshoop-studio__frame')
        const editeurLa = page.locator('[data-teeshoop-editeur]')
        if ((await cadreLa.count()) > 0) {
          encadre.cadre = true
          encadre.src = (await cadreLa.first().getAttribute('src')) ?? ''
          encadre.lienMene = 'un cadre'
        } else if ((await editeurLa.count()) > 0) {
          encadre.lienMene = 'un éditeur'
        } else {
          // L'ancre existe et ne mène à rien : ce n'est pas un chemin d'achat.
          encadre.lien = false
          encadre.lienMene = 'rien'
        }
      } catch (e) {
        encadre.lien = false
        encadre.lienMene = `page injoignable : ${String(e.message).slice(0, 80)}`
      }
    }
  }

  // 3. le devis, qui ne compte pas mais qu'il faut savoir présent
  const devis = (await page.locator('#teeshoop-devis').count()) > 0

  await ctx.close()
  return { joignable: true, statut, natif, encadre, devis, erreurs }
}

function verdict(etat) {
  if (!etat.joignable) return { vend: false, par: 'la page ne répond pas', detail: etat.pourquoi }
  if (etat.natif.present && etat.natif.pret && etat.natif.bouton)
    return { vend: true, par: 'l’éditeur natif', detail: 'monté, bouton d’achat offert' }
  if (etat.encadre.cadre && etat.encadre.src !== '')
    return { vend: true, par: 'le studio encadré', detail: etat.encadre.src }
  if (etat.encadre.lien)
    return {
      vend: true,
      par: 'le lien « Personnaliser »',
      detail: `il mène à ${etat.encadre.lienMene || 'une seconde page'}`,
    }
  return {
    vend: false,
    par: 'rien',
    detail:
      `natif présent=${etat.natif.present} prêt=${etat.natif.pret} bouton=${etat.natif.bouton} ; ` +
      `cadre=${etat.encadre.cadre} lien=${etat.encadre.lien}` +
      (etat.encadre.lienMene ? ` (il mène à ${etat.encadre.lienMene})` : '') +
      ` ; devis=${etat.devis}`,
  }
}

/** Le commit qui a retiré le cadre, s'il existe et si le cadre a disparu. */
function commitDuRetrait() {
  if (process.env.VENDABLE_COMMIT) return process.env.VENDABLE_COMMIT
  const sortie = execFileSync(
    'git',
    ['log', '--format=%H %s', '-40'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  for (const ligne of sortie.split('\n')) {
    // Le sujet du commit de retrait, écrit tel quel dans le rapport de la nuit.
    if (/retire|retrait/i.test(ligne) && /cadre|iframe/i.test(ligne)) return ligne.split(' ')[0]
  }
  return ''
}

function annulerLeRetrait() {
  const sha = commitDuRetrait()
  if (sha === '') {
    dit('  remise en état 2/2 : aucun commit de retrait trouvé, rien à annuler.')
    return false
  }
  dit(`  remise en état 2/2 : git revert --no-edit ${sha.slice(0, 10)} ...`)
  execFileSync('git', ['revert', '--no-edit', sha], { cwd: ROOT, stdio: 'inherit' })
  // npm est npm.cmd sous Windows ; execFileSync ne le lance pas sans shell,
  // et les arguments sont constants, donc le shell n'interprète rien.
  execFileSync('npm', ['run', 'build:editeur'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  })
  return true
}

// ---------------------------------------------------------------------------

const navigateur = await chromium.launch({
  args: ['--host-resolver-rules=MAP host.docker.internal 127.0.0.1'],
})

dit(`fiche interrogée : ${URL_FICHE}`)
let etat = await interroger(navigateur)
let v = verdict(etat)
dit(`  chemin d’achat : ${v.vend ? 'OUI' : 'NON'}, par ${v.par}${v.detail ? ' (' + v.detail + ')' : ''}`)

let repare = false
if (!v.vend && RETABLIR) {
  dit('\nAUCUN CHEMIN D’ACHAT. Remise en état du chemin précédent.')
  repare = annulerLeRetrait()
  dit('  nouvelle interrogation ...')
  etat = await interroger(navigateur)
  v = verdict(etat)
  dit(`  chemin d’achat : ${v.vend ? 'OUI' : 'NON'}, par ${v.par}${v.detail ? ' (' + v.detail + ')' : ''}`)
}

await navigateur.close()

console.log('')
if (!v.vend) {
  console.error('vendable ÉCHEC : cette fiche produit ne peut vendre par aucun chemin.')
  console.error(`  ${v.detail}`)
  if (!RETABLIR) console.error('  Relancez avec --retablir pour rebrancher le chemin précédent.')
  else console.error('  La remise en état a été tentée et n’a pas suffi. À reprendre à la main.')
  process.exit(1)
}
if (repare) {
  console.error(`vendable : la fiche vend de nouveau, par ${v.par}, APRÈS remise en état.`)
  console.error('  Le chemin natif a été débranché. Le rapport de la nuit doit le dire.')
  process.exit(1)
}
console.log(`vendable OK : la fiche vend par ${v.par}.`)
if (etat.erreurs?.length) console.log(`  (${etat.erreurs.length} erreur(s) de page : ${etat.erreurs[0]})`)
