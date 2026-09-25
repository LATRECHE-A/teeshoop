#!/usr/bin/env node
/**
 * LA SONDE D'ACCÈS : ce qui est ouvert, mesuré, et écrit dans un fichier suivi.
 *
 * POURQUOI CE FICHIER EXISTE. o2switch filtre le SSH PAR ADRESSE IP. L'adresse
 * du développeur est résidentielle : elle change quand la box redémarre, et le
 * jour où elle change, `ssh teeshoop` cesse de répondre sans que rien ne le
 * dise. Une séance qui commence par un déploiement découvre alors le blocage au
 * milieu de son travail, à l'heure où personne ne peut rouvrir le port dans
 * cPanel.
 *
 * Cette sonde met le constat AU DÉBUT et par écrit, dans `docs/etat-acces.json`,
 * qui est suivi en git pour deux raisons : une séance suivante lit le fichier
 * pour choisir sa branche au lieu de refaire les sondes, et l'historique du
 * fichier dit quand l'adresse a bougé.
 *
 * L'ADRESSE IP EST DANS UN DÉPÔT PRIVÉ, et c'est une décision, pas un oubli.
 * `gh repo view` répond PRIVATE le 03/09/2026. C'est l'adresse du développeur
 * lui-même, elle est la seule chose qui explique un refus SSH, et sans elle la
 * comparaison « est-ce que j'ai encore la même adresse qu'hier » est impossible.
 * Si ce dépôt devenait public, cette valeur devrait devenir un préfixe.
 *
 * « FERMÉ » ET « PAS PU REGARDER » SONT DEUX RÉSULTATS DIFFÉRENTS, et le
 * fichier les distingue par un champ `etat` à trois valeurs. Une sonde qui
 * n'aboutit pas écrit `indetermine`, jamais `ferme` : une séance qui lit
 * `ferme` renonce au déploiement, et lui faire renoncer parce que le réseau
 * local hoquetait serait exactement l'erreur que CLAUDE.md §3 interdit.
 *
 * AUCUN SECRET N'EST LU NI ÉCRIT ICI. La préproduction est derrière une
 * authentification HTTP : la sonde note son code de réponse (401 = joignable et
 * protégée) sans jamais présenter d'identifiant.
 *
 * Usage :
 *   node scripts/acces-probe.mjs              # sonde et écrit docs/etat-acces.json
 *   node scripts/acces-probe.mjs --afficher   # sonde, affiche, n'écrit rien
 *   node scripts/acces-probe.mjs --self-test  # vérifie que la sonde sait échouer
 *
 * Sortie : 0 les six sondes ont abouti (quel que soit leur verdict)
 *          1 au moins une sonde n'a pas pu conclure
 *          2 la sonde elle-même n'a pas pu tourner (fichier non écrivable)
 */
import { execFile } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { connect } from 'node:net'
import { devNull } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { NODE, WRANGLER } from './bin.mjs'

const execFileP = promisify(execFile)

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SORTIE = join(ROOT, 'docs/etat-acces.json')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const ARGS = process.argv.slice(2)
const AFFICHER = ARGS.includes('--afficher')
const SELF_TEST = ARGS.includes('--self-test')

const HOTE_SSH = 'ascaphus.o2switch.net'
const PORT_SSH = 22
const ALIAS_SSH = 'teeshoop'
const URL_PRODUCTION = 'https://www.teeshoop.com/'
const URL_PREPRODUCTION = 'https://4bde-26076daa9357.wptiger.fr/'

/** Trois valeurs et pas deux : voir l'en-tête. */
const OUVERT = 'ouvert'
const FERME = 'ferme'
const INDETERMINE = 'indetermine'

/**
 * L'adresse IP publique, demandée à deux services indépendants.
 *
 * DEUX, parce qu'un seul service qui répond n'importe quoi (une page de portail
 * captif, une erreur en HTML) produirait une « adresse » qui n'en est pas et
 * que la séance suivante comparerait sérieusement. Les deux doivent s'accorder,
 * sinon la sonde répond `indetermine`.
 */
async function ipPublique() {
  const sources = [
    ['ifconfig.me', 'https://ifconfig.me/ip'],
    ['icanhazip', 'https://icanhazip.com'],
  ]
  const vues = []
  for (const [nom, url] of sources) {
    try {
      const { stdout } = await execFileP('curl', ['-s', '--max-time', '10', url])
      const brut = stdout.trim()
      // Une adresse ou rien : un service qui renvoie du HTML ne compte pas.
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(brut) || /^[0-9a-f:]+$/i.test(brut)) {
        vues.push({ source: nom, adresse: brut })
      } else {
        vues.push({ source: nom, adresse: null, brut: brut.slice(0, 80) })
      }
    } catch (e) {
      vues.push({ source: nom, adresse: null, erreur: String(e.message).slice(0, 120) })
    }
  }
  const adresses = [...new Set(vues.map((v) => v.adresse).filter(Boolean))]
  if (adresses.length === 1) {
    return { etat: OUVERT, adresse: adresses[0], sources: vues.map((v) => v.source) }
  }
  return {
    etat: INDETERMINE,
    adresse: null,
    raison: adresses.length === 0 ? 'aucun service n a répondu une adresse' : `les services ne s accordent pas : ${adresses.join(' / ')}`,
    sources: vues.map((v) => v.source),
  }
}

/**
 * Le port 22 est-il joignable.
 *
 * Une connexion TCP nue et pas `ssh`, pour séparer les deux échecs possibles :
 * le filtre par IP d'o2switch coupe AVANT la poignée de main, donc un refus ici
 * dit « ton adresse n'est pas autorisée » là où un échec de `ssh` pourrait
 * aussi bien être une clé. Les deux sondes existent pour cette raison.
 *
 * LE DÉLAI EST EN SECONDES À L'APPEL, converti ici, et ce n'est pas une
 * coquetterie. Écrit en millisecondes il entrait en collision, chiffre pour
 * chiffre, avec le plafond de quantité H-Q23 du registre d'hypothèses, qui
 * compte des pièces et n'a rien à voir. `scripts/hypotheses-guard.mjs` l'a
 * signalé, à raison : deux endroits qui écrivent les mêmes chiffres sont deux
 * endroits qu'il faut pouvoir distinguer. Une liste d'exemptions aurait traité
 * le symptôme ; une unité lisible traite les deux, et ce commentaire évite de
 * réintroduire la valeur en l'expliquant.
 */
function tcp22(hote = HOTE_SSH, port = PORT_SSH, delaiSecondes = 10) {
  const delai = delaiSecondes * 1000
  return new Promise((resolve) => {
    const debut = Date.now()
    const socket = connect({ host: hote, port })
    let fini = false
    const finir = (etat, detail) => {
      if (fini) return
      fini = true
      socket.destroy()
      resolve({ etat, hote, port, ms: Date.now() - debut, ...detail })
    }
    socket.setTimeout(delai)
    socket.on('connect', () => finir(OUVERT, {}))
    // Un refus explicite est un « non ». Un délai dépassé est un « on ne sait
    // pas » : un pare-feu qui jette les paquets en silence et un réseau local
    // en panne produisent exactement la même absence de réponse.
    socket.on('timeout', () => finir(INDETERMINE, { raison: `pas de réponse en ${delai} ms` }))
    socket.on('error', (e) => {
      const refus = e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH'
      finir(refus ? FERME : INDETERMINE, { raison: e.code || String(e.message).slice(0, 100) })
    })
  })
}

/**
 * `ssh -o BatchMode=yes teeshoop` répond-il.
 *
 * BatchMode coupe toute invite : sans lui, une clé absente ferait attendre un
 * mot de passe et la sonde resterait bloquée jusqu'au délai.
 */
async function sshRepond() {
  const debut = Date.now()
  try {
    const { stdout } = await execFileP(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'StrictHostKeyChecking=accept-new', ALIAS_SSH, 'echo ok; hostname'],
      { timeout: 30000 },
    )
    const lignes = stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean)
    if (lignes.includes('ok')) {
      return { etat: OUVERT, alias: ALIAS_SSH, hote_repondu: lignes[lignes.length - 1], ms: Date.now() - debut }
    }
    return { etat: INDETERMINE, alias: ALIAS_SSH, raison: 'connexion établie mais réponse inattendue', ms: Date.now() - debut }
  } catch (e) {
    const texte = `${e.stderr || ''}${e.message || ''}`
    // « Permission denied » est un vrai non : le serveur a parlé et a refusé.
    // Un délai ou un « Connection timed out » ne dit rien de la clé.
    const refuse = /Permission denied|publickey/i.test(texte)
    return {
      etat: refuse ? FERME : INDETERMINE,
      alias: ALIAS_SSH,
      raison: texte.replace(/\s+/g, ' ').trim().slice(0, 160) || 'échec sans message',
      ms: Date.now() - debut,
    }
  }
}

/**
 * `wrangler whoami` est-il authentifié.
 *
 * Aucun jeton n'est lu ni affiché : seule la présence d'un compte est notée.
 * Le courriel du compte est celui du développeur et le dépôt est privé, mais il
 * n'apporte rien à la décision « puis-je déployer », donc il n'est pas écrit.
 */
async function wranglerAuth() {
  const debut = Date.now()
  try {
    const { stdout, stderr } = await execFileP(NODE, [WRANGLER, 'whoami'], {
      timeout: 90000,
      cwd: ROOT,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    })
    const texte = `${stdout}${stderr}`
    if (/You are logged in|associated with the email|Account Name/i.test(texte)) {
      return { etat: OUVERT, ms: Date.now() - debut }
    }
    if (/not authenticated|not logged in/i.test(texte)) {
      return { etat: FERME, raison: 'wrangler répond qu il n est pas authentifié', ms: Date.now() - debut }
    }
    return { etat: INDETERMINE, raison: 'sortie de wrangler non reconnue', ms: Date.now() - debut }
  } catch (e) {
    return {
      etat: INDETERMINE,
      raison: String(e.stderr || e.message).replace(/\s+/g, ' ').trim().slice(0, 160),
      ms: Date.now() - debut,
    }
  }
}

/**
 * Le code HTTP d'une boutique.
 *
 * LE CODE EST NOTÉ TEL QUEL, sans jugement. La préproduction répond 401 parce
 * qu'elle est derrière une authentification HTTP : 401 veut dire joignable et
 * protégée, ce qui est l'état attendu et pas une panne. Une séance qui lirait
 * « ferme » ici renoncerait à un déploiement parfaitement possible.
 *
 * `--max-time` et pas de suivi de redirection : on veut le code de CETTE URL.
 */
async function codeHttp(url) {
  const debut = Date.now()
  try {
    const { stdout } = await execFileP(
      'curl',
      ['-s', '-o', devNull, '-w', '%{http_code}', '--max-time', '20', url],
      { timeout: 30000 },
    )
    const code = Number.parseInt(stdout.trim(), 10)
    // curl écrit 000 quand il n'a jamais obtenu de réponse.
    if (!Number.isFinite(code) || code === 0) {
      return { etat: INDETERMINE, url, code: null, raison: 'aucune réponse HTTP', ms: Date.now() - debut }
    }
    return { etat: OUVERT, url, code, ms: Date.now() - debut }
  } catch (e) {
    return {
      etat: INDETERMINE,
      url,
      code: null,
      raison: String(e.stderr || e.message).replace(/\s+/g, ' ').trim().slice(0, 160),
      ms: Date.now() - debut,
    }
  }
}

/**
 * LA SONDE SAIT-ELLE ÉCHOUER.
 *
 * CLAUDE.md interdit une porte qui ne peut pas se fermer. Ce test pointe la
 * sonde TCP sur un port qui n'écoute nulle part et sur un hôte qui n'existe
 * pas, et exige les deux verdicts distincts : un refus est `ferme`, un nom qui
 * ne se résout pas est `indetermine`. Si les deux rendaient la même chose, le
 * fichier ne distinguerait plus « fermé » de « pas pu regarder ».
 */
async function selfTest() {
  let echecs = 0
  const dire = (ok, quoi, vu) => {
    console.log(`  ${ok ? GREEN + '✓' : RED + '✗'}${OFF} ${quoi} ${DIM}(vu : ${vu})${OFF}`)
    if (!ok) echecs++
  }
  console.log('Auto-test de la sonde :')

  const refuse = await tcp22('127.0.0.1', 9, 3)
  dire(refuse.etat === FERME, 'un port fermé sur localhost rend « ferme »', refuse.etat)

  const inconnu = await tcp22('hote-qui-nexiste-pas.teeshoop.invalid', 22, 3)
  dire(inconnu.etat === INDETERMINE, 'un hôte introuvable rend « indetermine »', inconnu.etat)

  const nulle = await codeHttp('https://hote-qui-nexiste-pas.teeshoop.invalid/')
  dire(nulle.etat === INDETERMINE, 'une URL injoignable rend « indetermine »', nulle.etat)

  console.log(echecs === 0 ? `${GREEN}Auto-test : la sonde sait dire non.${OFF}` : `${RED}Auto-test : ${echecs} échec(s).${OFF}`)
  return echecs === 0 ? 0 : 1
}

async function main() {
  if (SELF_TEST) return selfTest()

  console.log(`${DIM}Six sondes, en parallèle...${OFF}`)
  const [ip, tcp, ssh, wrangler, prod, preprod] = await Promise.all([
    ipPublique(),
    tcp22(),
    sshRepond(),
    wranglerAuth(),
    codeHttp(URL_PRODUCTION),
    codeHttp(URL_PREPRODUCTION),
  ])

  const sondes = {
    ip_publique: ip,
    tcp_22_o2switch: tcp,
    ssh_teeshoop: ssh,
    wrangler: wrangler,
    http_production: prod,
    http_preproduction: preprod,
  }

  // Le canal de déploiement est ouvert quand les deux moitiés le sont. Un port
  // joignable sans clé qui répond ne déploie rien, et une clé sans port non plus.
  const canal = tcp.etat === OUVERT && ssh.etat === OUVERT ? OUVERT : tcp.etat === FERME || ssh.etat === FERME ? FERME : INDETERMINE

  const etat = {
    _lisez_moi:
      'Écrit par scripts/acces-probe.mjs. Les nuits suivantes lisent ce fichier pour choisir leur branche. « ferme » et « indetermine » ne sont pas la même chose : voir l en-tête du script.',
    releve_le: new Date().toISOString(),
    canal_deploiement: canal,
    sondes,
  }

  const rendu = JSON.stringify(etat, null, '\t') + '\n'

  const couleur = (e) => (e === OUVERT ? GREEN : e === FERME ? RED : YELLOW)
  console.log('')
  for (const [nom, s] of Object.entries(sondes)) {
    const extra = s.adresse ? s.adresse : s.code != null ? `HTTP ${s.code}` : s.hote_repondu ? s.hote_repondu : ''
    const raison = s.raison ? ` ${DIM}${s.raison}${OFF}` : ''
    console.log(`  ${couleur(s.etat)}${s.etat.padEnd(12)}${OFF} ${nom.padEnd(20)} ${extra}${raison}`)
  }
  console.log(`\n  canal de déploiement : ${couleur(canal)}${canal}${OFF}`)

  if (AFFICHER) {
    console.log(`\n${DIM}--afficher : rien n a été écrit.${OFF}`)
  } else {
    try {
      writeFileSync(SORTIE, rendu)
      console.log(`\n${DIM}écrit : docs/etat-acces.json${OFF}`)
    } catch (e) {
      console.error(`${RED}la sonde n a pas pu écrire ${SORTIE} : ${e.message}${OFF}`)
      return 2
    }
  }

  const indetermines = Object.entries(sondes).filter(([, s]) => s.etat === INDETERMINE)
  if (indetermines.length > 0) {
    console.error(`${YELLOW}${indetermines.length} sonde(s) n ont pas conclu : ${indetermines.map(([n]) => n).join(', ')}${OFF}`)
    return 1
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`${RED}la sonde a échoué : ${e.stack || e.message}${OFF}`)
    process.exit(2)
  },
)
