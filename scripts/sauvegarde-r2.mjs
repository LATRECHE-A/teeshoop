#!/usr/bin/env node
/**
 * Le coffre des créations de clients : une copie des objets R2 hors de R2, un
 * inventaire qui se vérifie, et une restauration qui a été essayée.
 *
 *   node scripts/sauvegarde-r2.mjs inventaire <seau>
 *   node scripts/sauvegarde-r2.mjs depuis-r2  <seau> <miroir>
 *   node scripts/sauvegarde-r2.mjs verifier   <miroir>
 *   node scripts/sauvegarde-r2.mjs vers-r2    <miroir> <seau>
 *   node scripts/sauvegarde-r2.mjs comparer   <miroir> <seau>
 *
 * POURQUOI CE FICHIER EXISTE. R2 détient CHAQUE création de client. Une
 * création perdue est une commande payée que l'atelier ne peut pas imprimer, et
 * il n'y a aucun original ailleurs : le client a fermé son navigateur. R2 n'a ni
 * instantané, ni corbeille, ni versionnage ; une suppression est définitive à la
 * seconde où elle part. Trois façons de la provoquer existent déjà dans notre
 * propre code, et aucune n'est un bogue : `DELETE /api/design/{id}` (effacement
 * RGPD), `POST /api/design/reap` (rétention) et la règle de cycle de vie posée
 * sur le préfixe `ar/`. La séance 13 a nommé ce trou « le plus sérieux qui
 * reste » et la séance 14 ne l'a pas fermé.
 *
 * CE QUE CE SCRIPT NE FAIT PAS, dit ici plutôt que découvert un mauvais jour.
 *
 *   Il ne déploie rien. Un seul Worker sert la production et la préproduction ;
 *   une sauvegarde est une LECTURE et reste une lecture. `vers-r2` est la seule
 *   écriture, elle refuse le seau de production sans un drapeau explicite, et
 *   elle n'écrase jamais un objet existant sans `--ecraser`.
 *
 *   Il ne restitue pas les métadonnées personnalisées. Mesuré le 05/09/2026 :
 *   l'API REST de Cloudflare accepte `content-type` et le rend, et perd
 *   `custom_metadata` quelle que soit la convention d'en-tête (`x-amz-meta-*`
 *   comme `cf-r2-metadata` : relus, les deux rendent `{}`). Nos objets y portent
 *   `created`, que `worker/design.ts` lit pour décider si un dessin est assez
 *   vieux pour être fauché. Conséquence à connaître : un objet restauré a la
 *   date du jour de la restauration, donc la rétention ne le prendra plus. C'est
 *   le sens sûr (on ne supprime pas une oeuvre restaurée), pas le sens neutre.
 *   L'inventaire garde la valeur d'origine, donc rien n'est perdu, seulement
 *   déplacé du seau vers le coffre.
 *
 * LE MIROIR EST CUMULATIF ET NE SUPPRIME JAMAIS. Nos clés portent un identifiant
 * tiré au sort et ne sont pas réécrites : l'ennemi n'est donc pas la corruption,
 * c'est la disparition. Un objet qui n'est plus dans le seau reste dans le
 * miroir et le rapport le NOMME, parce que c'est exactement la ligne qui
 * attrape une fauche ratée. Un objet dont les octets ont changé sous la même clé
 * est téléchargé à nouveau et l'ancien est gardé sous `<nom>.remplace-<date>`.
 *
 * Sorties : 0 tout est bon, 1 quelque chose ne va pas, 2 mauvais usage, 3 la
 * sauvegarde est complète MAIS des objets ont disparu du seau depuis la
 * dernière. Trois est un code à part parce que ces deux nouvelles ne se
 * traitent pas pareil : la première réveille quelqu'un, la seconde se lit le
 * matin, et les confondre est la façon la plus sûre de faire ignorer les deux.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const FORMAT = 'teeshoop-inventaire-1'
const SEAU_PRODUCTION = 'tshop-ar'
const API = 'https://api.cloudflare.com/client/v4'
/* R2 pagine à 1 000 par page au maximum. Une page vide ou un curseur absent
 * termine la marche ; une page tronquée sans curseur est une anomalie et non une
 * fin, parce que la confondre avec une fin sauvegarde la moitié du seau en
 * annonçant qu'elle a tout pris. */
const PAR_PAGE = 1000
const PAGES_MAX = 10000

/* ─────────────────────────── identifiants ─────────────────────────── */

/**
 * Le jeton, dans cet ordre : la variable d'environnement (c'est ce que porte un
 * cron), puis le fichier hors dépôt, puis le jeton OAuth de wrangler (c'est ce
 * qu'a un développeur devant sa machine). Aucun secret n'est imprimé, jamais,
 * mais la PROVENANCE l'est : savoir avec quoi on vient de lire un seau fait
 * partie de la preuve.
 *
 * AUCUN JETON REFUSE TOUT. Le réflexe inverse (« pas de jeton, donc rien à
 * sauvegarder ») est exactement la panne silencieuse que ce fichier existe pour
 * empêcher.
 */
function identifiants() {
  const env = {}
  const fichier = join(process.env.HOME ?? '', '.config', 'teeshoop', 'r2.env')
  if (existsSync(fichier)) {
    for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  let jeton = process.env.CF_API_TOKEN || env.CF_API_TOKEN || env.CF_R2_TOKEN || ''
  let compte = process.env.CF_ACCOUNT_ID || env.CF_ACCOUNT_ID || ''
  let provenance = jeton ? (process.env.CF_API_TOKEN ? "la variable CF_API_TOKEN" : `le fichier ${fichier}`) : ''

  if (!jeton) {
    const conf = join(process.env.HOME ?? '', '.config', '.wrangler', 'config', 'default.toml')
    if (existsSync(conf)) {
      const m = /oauth_token\s*=\s*"([^"]+)"/.exec(readFileSync(conf, 'utf8'))
      if (m && m[1]) {
        jeton = m[1]
        provenance = 'la session wrangler de cette machine (elle expire, ce n est pas un identifiant de cron)'
      }
    }
  }
  if (!compte && jeton) {
    try {
      const sortie = execFileSync('npx', ['--no-install', 'wrangler', 'whoami'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000,
      })
      const m = /\b([0-9a-f]{32})\b/.exec(sortie)
      if (m) compte = m[1]
    } catch { /* mesuré ci-dessous par l'absence de compte */ }
  }
  if (!jeton || !compte) {
    console.error('sauvegarde-r2: aucun identifiant Cloudflare utilisable, donc rien n a été lu.')
    console.error('  Attendu : CF_ACCOUNT_ID et CF_API_TOKEN dans l environnement,')
    console.error(`  ou le fichier ${fichier} qui porte les deux,`)
    console.error('  ou une session wrangler ouverte (npx wrangler login).')
    console.error('  Le jeton doit porter la permission « Workers R2 Storage » en lecture.')
    process.exit(1)
  }
  return { jeton, compte, provenance }
}

/* ─────────────────────────── l'API R2 ─────────────────────────── */

/**
 * Un appel, avec ses reprises. Un 429 ou un 5xx est passager et une sauvegarde
 * qui abandonne à la première secousse n'est pas une sauvegarde ; un 4xx ne se
 * réessaie pas, parce qu'un jeton faux le restera.
 */
async function appel(url, options, { essais = 4 } = {}) {
  let derniere = null
  for (let i = 0; i < essais; i++) {
    let r
    try {
      r = await fetch(url, options)
    } catch (e) {
      derniere = new Error(`réseau: ${e.message}`)
      await pause(400 * 2 ** i)
      continue
    }
    if (r.status === 429 || r.status >= 500) {
      derniere = new Error(`HTTP ${r.status}`)
      await pause(400 * 2 ** i)
      continue
    }
    return r
  }
  throw derniere ?? new Error('appel impossible')
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Toutes les clés d'un seau, pagination suivie jusqu'au bout.
 *
 * `result_info` est ABSENT sur la dernière page (mesuré le 05/09/2026 avec
 * per_page=5 sur quinze objets : deux pages avec `is_truncated: true` et un
 * curseur, la troisième sans rien). Absent veut donc dire fini. Ce qui n'est
 * jamais toléré, c'est `is_truncated: true` sans curseur : ce serait une marche
 * qui s'arrête au milieu en croyant avoir fini, et c'est la panne qui sauvegarde
 * les mille premiers objets d'un seau qui en a trois mille.
 */
async function lister(ctx, seau, prefixe) {
  const objets = []
  let curseur = null
  let pages = 0
  for (;;) {
    const u = new URL(`${API}/accounts/${ctx.compte}/r2/buckets/${encodeURIComponent(seau)}/objects`)
    u.searchParams.set('per_page', String(PAR_PAGE))
    if (prefixe) u.searchParams.set('prefix', prefixe)
    if (curseur) u.searchParams.set('cursor', curseur)
    const r = await appel(u, { headers: { authorization: `Bearer ${ctx.jeton}` } })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || j.success !== true) {
      const quoi = j?.errors?.map((e) => `${e.code} ${e.message}`).join(', ') || `HTTP ${r.status}`
      throw new Error(`la liste du seau ${seau} a échoué : ${quoi}`)
    }
    pages++
    for (const o of j.result) objets.push(o)
    const info = j.result_info
    if (!info || !info.is_truncated) break
    if (!info.cursor) throw new Error('page tronquée sans curseur : la marche ne peut pas finir, rien ne sera annoncé comme complet')
    curseur = info.cursor
    if (pages >= PAGES_MAX) throw new Error(`plus de ${PAGES_MAX} pages, la marche est arrêtée sans être complète`)
  }
  return { objets, pages }
}

async function telecharger(ctx, seau, cle) {
  const u = `${API}/accounts/${ctx.compte}/r2/buckets/${encodeURIComponent(seau)}/objects/${encodeURIComponent(cle)}`
  const r = await appel(u, { headers: { authorization: `Bearer ${ctx.jeton}` } })
  if (!r.ok) throw new Error(`lecture de ${cle} : HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

async function televerser(ctx, seau, cle, octets, entetes) {
  const u = `${API}/accounts/${ctx.compte}/r2/buckets/${encodeURIComponent(seau)}/objects/${encodeURIComponent(cle)}`
  const r = await appel(u, {
    method: 'PUT',
    headers: { authorization: `Bearer ${ctx.jeton}`, ...entetes },
    body: octets,
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`écriture de ${cle} : HTTP ${r.status} ${t.slice(0, 200)}`)
  }
}

/* ─────────────────────────── outils ─────────────────────────── */

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const md5 = (buf) => createHash('md5').update(buf).digest('hex')

/**
 * Une clé R2 vient d'un service tiers, même quand ce tiers est nous. Elle
 * devient un chemin de fichier, donc elle doit être refusée avant, pas nettoyée
 * après : `..`, une barre de tête, un antislash, un octet nul, ou une longueur
 * démesurée. Un objet refusé n'arrête pas la sauvegarde des autres, mais il
 * empêche la course d'être déclarée complète.
 */
function cleSure(cle) {
  if (typeof cle !== 'string' || cle.length === 0) return 'clé vide'
  if (cle.length > 512) return 'clé de plus de 512 caractères'
  if (cle.includes('\0')) return 'clé contenant un octet nul'
  if (cle.includes('\\')) return 'clé contenant un antislash'
  if (cle.startsWith('/')) return 'clé commençant par une barre'
  for (const seg of cle.split('/')) {
    if (seg === '..' || seg === '.') return 'clé contenant un segment de remontée'
  }
  return null
}

/**
 * L'empreinte de l'inventaire entier : une ligne « sha256  clé » par objet,
 * triée. Un objet effacé à la demande d'un client compte pour `efface` : son
 * empreinte quitte le fichier en même temps que ses octets quittent le disque,
 * et le changement se voit dans cette valeur-ci.
 */
function empreinteListe(entrees) {
  const lignes = entrees
    .map((e) => `${e.sha256 ?? 'efface'}  ${e.cle}`)
    .sort()
    .join('\n')
  return sha256(Buffer.from(lignes + '\n', 'utf8'))
}

/**
 * UN VERROU SUR LE MIROIR. Deux courses en même temps sur le même coffre (le
 * cron et quelqu'un qui lance à la main) s'entrelacent et écrivent un
 * inventaire qui ne décrit ni l'une ni l'autre. `mkdir` est atomique partout,
 * y compris sur un partage réseau, ce qu'un fichier de verrou n'est pas.
 *
 * UN VERROU PÉRIMÉ EST CASSÉ, BRUYAMMENT. Refuser indéfiniment sur un verrou
 * qu'un plantage a laissé, c'est arrêter les sauvegardes en silence, ce qui est
 * exactement la panne que ce fichier existe pour empêcher. Aucune course
 * honnête ne dure douze heures à ces volumes.
 */
const VERROU_PERIME_MS = 12 * 3600 * 1000
function prendreVerrou(racine) {
  const verrou = join(racine, '.verrou')
  mkdirSync(racine, { recursive: true, mode: 0o700 })
  /* `mkdir` ne resserre pas un répertoire qui existait déjà, et les coffres
   * créés avant cette règle sont en 0755. Un 0700 sur la racine suffit : sans
   * droit de traversée, ce qu'il y a dessous est hors d'atteinte quel que soit
   * son propre mode. */
  chmodSync(racine, 0o700)
  try {
    mkdirSync(verrou)
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const age = Date.now() - statSync(verrou).mtimeMs
    if (age < VERROU_PERIME_MS) {
      throw new Error(
        `une autre course tient le verrou ${verrou} depuis ${Math.round(age / 60000)} min. ` +
        'Attendez, ou retirez-le si vous savez qu aucune ne tourne.',
      )
    }
    console.log(`ATTENTION : verrou périmé de ${Math.round(age / 3600000)} h cassé (${verrou}).`)
    console.log('  Une course précédente ne s est pas terminée. Le contenu du coffre est à revérifier.')
  }
  return () => { try { rmSync(verrou, { recursive: true }) } catch { /* déjà parti */ } }
}

/** 20260905T083012Z : triable, sans deux-points, utilisable dans un nom de fichier. */
function horodatage() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

/*
 * 0700 SUR LES RÉPERTOIRES ET 0600 SUR LES FICHIERS, PARTOUT ICI. Ce coffre
 * contient l'oeuvre de clients : elle est à eux, elle n'est publiable par
 * personne, et le masque par défaut de la plupart des machines la rendrait
 * lisible par tout compte de la machine. `mkdir -p` seul donnait 0755.
 */
function ecrireJson(chemin, valeur) {
  mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 })
  writeFileSync(chemin, JSON.stringify(valeur, null, 2) + '\n', { mode: 0o600 })
}

/**
 * L'inventaire d'un chemin, que ce chemin soit le répertoire qui le contient ou
 * le fichier lui-même. La copie hors site garde le sien sous un autre nom
 * (`INVENTAIRE-HORS-SITE.json`, parce que `MANIFESTE.txt` est déjà le manifeste
 * de ce répertoire-là), et il doit pouvoir être relu par le même vérificateur.
 */
function cheminInventaire(chemin) {
  const abs = resolve(chemin)
  if (existsSync(abs) && statSync(abs).isFile()) return abs
  return join(abs, 'INVENTAIRE.json')
}

function fichiersSous(racine) {
  const trouves = []
  const marche = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) marche(p)
      else if (e.isFile()) trouves.push(p)
    }
  }
  if (existsSync(racine)) marche(racine)
  return trouves
}

/* ─────────────────────────── inventaire ─────────────────────────── */

async function verbeInventaire(argv) {
  const seau = argv[0]
  if (!seau) return usage('inventaire attend le nom du seau')
  const ctx = identifiants()
  const t0 = Date.now()
  const { objets, pages } = await lister(ctx, seau, argv.prefixe)
  const parPrefixe = {}
  let octets = 0
  for (const o of objets) {
    octets += o.size
    const p = o.key.split('/')[0]
    parPrefixe[p] = (parPrefixe[p] ?? 0) + 1
  }
  console.log(`seau              : ${seau}`)
  console.log(`identifiant       : ${ctx.provenance}`)
  console.log(`pages parcourues  : ${pages}`)
  console.log(`objets            : ${objets.length}`)
  console.log(`octets            : ${octets} (${(octets / 1e6).toFixed(1)} Mo)`)
  for (const [p, n] of Object.entries(parPrefixe).sort()) console.log(`  préfixe ${p}/ : ${n}`)
  console.log(`durée             : ${Date.now() - t0} ms`)
  if (objets.length === 0) {
    console.log('seau vide : ce n est pas une erreur ici, inventaire ne fait que regarder.')
  }
  return 0
}

/* ─────────────────────────── depuis-r2 ─────────────────────────── */

async function verbeDepuisR2(argv) {
  const [seau, miroir] = argv
  if (!seau || !miroir) return usage('depuis-r2 attend <seau> <miroir>')
  const ctx = identifiants()
  const racine = resolve(miroir)
  const objetsDir = join(racine, 'objets')
  const inventairePath = join(racine, 'INVENTAIRE.json')

  const ancien = existsSync(inventairePath)
    ? JSON.parse(readFileSync(inventairePath, 'utf8'))
    : { objets: [] }
  const parCle = new Map(ancien.objets.map((e) => [e.cle, e]))

  const rendreVerrou = prendreVerrou(racine)
  try {
    return await depuisR2Course(ctx, seau, racine, objetsDir, inventairePath, ancien, parCle, argv)
  } finally {
    rendreVerrou()
  }
}

async function depuisR2Course(ctx, seau, racine, objetsDir, inventairePath, ancien, parCle, argv) {
  const t0 = Date.now()
  const { objets, pages } = await lister(ctx, seau, argv.prefixe)
  const stamp = horodatage()

  const entrees = []
  const refuses = []
  const ressuscites = []
  let repris = 0
  let neufs = 0
  let remplaces = 0
  let octetsLus = 0

  for (const o of objets) {
    const mauvais = cleSure(o.key)
    if (mauvais) {
      refuses.push({ cle: String(o.key).slice(0, 120), raison: mauvais })
      continue
    }
    const relatif = join('objets', ...o.key.split('/'))
    const chemin = join(racine, relatif)
    const precedent = parCle.get(o.key)

    /*
     * UN OBJET EFFACÉ DU COFFRE À LA DEMANDE D'UN CLIENT N'EST PAS RECOPIÉ.
     * Le seul cas où il est encore dans le seau est un effacement RGPD qui
     * n'est pas allé jusqu'au bout côté R2 : le recopier annulerait en silence
     * la seule moitié qui avait été faite. On le refuse, on le nomme, et la
     * course ne se déclare pas complète.
     */
    if (precedent && precedent.efface_le) {
      ressuscites.push(o.key)
      entrees.push({ ...precedent })
      continue
    }

    const dejaLa = existsSync(chemin) && statSync(chemin).size === o.size

    let contenu = null
    /* Reprendre plutôt que retélécharger : l'etag et la taille suffisent à dire
     * que les octets n'ont pas bougé, et une sauvegarde nocturne qui retire
     * chaque nuit la totalité du seau ne tient pas à cinquante gigaoctets. Le
     * sha256 local n'est jamais recalculé ici, c'est le travail de `verifier`,
     * qui est un passage séparé exprès. */
    if (dejaLa && precedent && precedent.etag === o.etag && precedent.octets === o.size) {
      repris++
      entrees.push({ ...precedent, vu_le: stamp })
      continue
    }
    contenu = await telecharger(ctx, seau, o.key)
    octetsLus += contenu.length

    if (contenu.length !== o.size) {
      throw new Error(`${o.key} : la liste annonce ${o.size} octets, la lecture en rend ${contenu.length}`)
    }
    /* L'etag R2 d'un objet en une seule partie EST son md5. Le comparer prouve
     * que les octets reçus sont ceux que R2 détient, avec une empreinte qui ne
     * vient pas de nous. Un etag suffixé « -N » est un envoi multipartie et ne
     * se compare pas ainsi. */
    const etag = String(o.etag ?? '').replace(/^"|"$/g, '')
    let md5Verifie = null
    if (/^[0-9a-f]{32}$/.test(etag)) {
      md5Verifie = md5(contenu) === etag
      if (!md5Verifie) throw new Error(`${o.key} : le md5 des octets reçus ne vaut pas l etag annoncé par R2`)
    }

    /*
     * L'ÉCRITURE PEUT ÉCHOUER POUR UN SEUL OBJET SANS QUE LA COURSE S'ARRÊTE.
     * R2 accepte à la fois la clé `a/b` et la clé `a/b/c` ; sur un disque, la
     * seconde exige que la première soit un répertoire. Nos clés à nous ne
     * peuvent pas produire ce couple, mais une clé posée à la main le peut, et
     * ce serait alors UN objet qui empêcherait la sauvegarde de TOUS les
     * autres. Refusé, compté, et la course ne sera pas déclarée complète.
     */
    try {
      if (dejaLa || existsSync(chemin)) {
        renameSync(chemin, `${chemin}.remplace-${stamp}`)
        remplaces++
      } else {
        neufs++
      }
      mkdirSync(dirname(chemin), { recursive: true, mode: 0o700 })
      /* Écrit sous un nom temporaire puis renommé : une interruption ne laisse
       * jamais un fichier à moitié écrit portant le nom d'un objet complet. */
      const tmp = `${chemin}.en-cours`
      writeFileSync(tmp, contenu, { mode: 0o600 })
      renameSync(tmp, chemin)
    } catch (e) {
      refuses.push({ cle: o.key, raison: `écriture impossible sur le disque : ${e.message}` })
      continue
    }

    entrees.push({
      cle: o.key,
      fichier: relatif.split(sep).join('/'),
      octets: o.size,
      sha256: sha256(contenu),
      etag,
      md5_verifie: md5Verifie,
      type: o.http_metadata?.contentType ?? null,
      cache: o.http_metadata?.cacheControl ?? null,
      metadonnees: o.custom_metadata ?? {},
      modifie: o.last_modified ?? null,
      vu_le: stamp,
    })
  }

  /* Ce qui a disparu du seau depuis la dernière fois. C'est la ligne qui
   * attrape une fauche ratée ou un effacement de trop, et elle ne supprime
   * rien : le miroir garde. */
  const vues = new Set(objets.map((o) => o.key))
  const disparus = ancien.objets.filter((e) => !vues.has(e.cle)).map((e) => e.cle)
  for (const cle of disparus) {
    const precedent = parCle.get(cle)
    entrees.push({ ...precedent, disparu_du_seau_le: precedent.disparu_du_seau_le ?? stamp })
  }

  const total = entrees.reduce((n, e) => n + e.octets, 0)
  const inventaire = {
    format: FORMAT,
    genre: 'objets-r2',
    seau,
    pris_le: new Date().toISOString(),
    pages_parcourues: pages,
    compte: entrees.length,
    octets: total,
    dans_le_seau: objets.length,
    disparus_du_seau: disparus,
    effaces_encore_dans_le_seau: ressuscites,
    refuses,
    sha256_liste: empreinteListe(entrees),
    objets: entrees.sort((a, b) => (a.cle < b.cle ? -1 : 1)),
  }
  ecrireJson(inventairePath, inventaire)
  ecrireJson(join(racine, 'inventaires', `${stamp}.json`), inventaire)

  const ms = Date.now() - t0
  console.log(`seau              : ${seau}`)
  console.log(`identifiant       : ${ctx.provenance}`)
  console.log(`miroir            : ${racine}`)
  console.log(`objets dans le seau : ${objets.length}`)
  console.log(`  téléchargés     : ${neufs}`)
  console.log(`  remplacés       : ${remplaces}`)
  console.log(`  repris du miroir: ${repris}`)
  console.log(`objets au coffre  : ${entrees.length} (${total} octets)`)
  console.log(`octets lus        : ${octetsLus}`)
  console.log(`empreinte         : ${inventaire.sha256_liste}`)
  console.log(`durée             : ${ms} ms`)
  if (disparus.length) {
    console.log(`ATTENTION : ${disparus.length} objet(s) ne sont plus dans le seau et sont gardés ici :`)
    for (const c of disparus.slice(0, 20)) console.log(`  ${c}`)
    if (disparus.length > 20) console.log(`  … et ${disparus.length - 20} autres, tous nommés dans INVENTAIRE.json`)
    console.log('  Effacement RGPD, fauche de rétention, ou incident : c est à un humain de le dire.')
  }
  if (ressuscites.length) {
    console.error(`ECHEC : ${ressuscites.length} objet(s) effacé(s) du coffre sont TOUJOURS dans le seau :`)
    for (const c of ressuscites.slice(0, 20)) console.error(`  ${c}`)
    console.error('        Un effacement RGPD n a pas été jusqu au bout côté R2. Le coffre ne les a pas')
    console.error('        recopiés. Terminez l effacement avec DELETE /api/design/{id}, puis relancez.')
    return 1
  }
  if (refuses.length) {
    console.error(`ECHEC : ${refuses.length} clé(s) refusée(s), la sauvegarde n est pas complète :`)
    for (const r of refuses) console.error(`  ${r.raison} : ${r.cle}`)
    return 1
  }
  if (objets.length === 0) {
    console.error('ECHEC : le seau a rendu zéro objet. « Rien trouvé » et « rien regardé » ne se distinguent pas ici,')
    console.error('        et une sauvegarde vide annoncée verte est la panne que ce script existe pour empêcher.')
    console.error('        Si le seau est réellement vide, passez --vide-permis.')
    return argv['vide-permis'] ? 0 : 1
  }
  return disparus.length ? 3 : 0
}

/* ─────────────────────────── oublier ─────────────────────────── */

/**
 * L'EFFACEMENT RGPD DOIT ATTEINDRE LE COFFRE, SINON IL N'A PAS EU LIEU.
 *
 * Le coffre ne supprime jamais de lui-même, et c'est délibéré : son ennemi est
 * la disparition. Mais l'article 17 ne s'arrête pas à la porte d'une
 * sauvegarde, et un coffre où l'oeuvre d'un client resterait après qu'il a
 * demandé son effacement serait une conservation illicite déguisée en prudence
 * technique.
 *
 * Ce verbe est donc le seul endroit qui retire quelque chose, il exige un
 * identifiant précis et une raison écrite, et il laisse la trace de ce qu'il a
 * retiré : la clé et la date restent, les octets et l'empreinte partent. Sans
 * cette trace, `verifier` réclamerait à jamais un fichier absent, et l'opérateur
 * qui a bien fait son travail verrait la porte rouge.
 */
function verbeOublier(argv) {
  const [miroir, id] = argv
  if (!miroir || !id) return usage('oublier attend <miroir> <identifiant> --raison="..."')
  if (!argv.raison) return usage('oublier exige --raison="...", parce qu un effacement se justifie par écrit')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return usage(`« ${id} » n est pas un identifiant`)

  const racine = resolve(miroir)
  const inventairePath = join(racine, 'INVENTAIRE.json')
  if (!existsSync(inventairePath)) {
    console.error(`ECHEC : aucun INVENTAIRE.json sous ${racine}.`)
    return 1
  }
  const rendreVerrou = prendreVerrou(racine)
  try {
    const inv = JSON.parse(readFileSync(inventairePath, 'utf8'))
    const stamp = new Date().toISOString()
    /* `design/{id}/…` et `ar/{id}.{ext}` : les deux formes de clé que nos
     * routes produisent pour un même identifiant. */
    const vise = (cle) => cle.startsWith(`design/${id}/`) || cle.startsWith(`ar/${id}.`)
    const touches = (inv.objets ?? []).filter((e) => vise(e.cle) && !e.efface_le)
    if (touches.length === 0) {
      const deja = (inv.objets ?? []).filter((e) => vise(e.cle)).length
      console.log(deja
        ? `rien à faire : les ${deja} objet(s) de ${id} sont déjà marqués effacés.`
        : `rien à faire : le coffre ne contient aucun objet pour ${id}.`)
      return 0
    }
    const restes = []
    for (const e of touches) {
      const chemin = join(racine, ...String(e.fichier).split('/'))
      if (!resolve(chemin).startsWith(racine + sep)) { restes.push(e.cle); continue }
      try {
        if (existsSync(chemin)) rmSync(chemin)
        /* Les copies gardées lors d'un remplacement portent le même contenu et
         * doivent partir aussi. */
        for (const p of fichiersSous(dirname(chemin))) {
          if (p.startsWith(`${chemin}.remplace-`)) rmSync(p)
        }
      } catch (err) { restes.push(`${e.cle} (${err.message})`); continue }
      /* L'etag de R2 est le md5 du contenu. Il ne reconstitue rien, mais garder
       * un condensé par objet de ce qu'un client a fait effacer n'a plus aucun
       * usage : la clé et la date suffisent à prouver que l'effacement a eu
       * lieu. Ce qui reste est la trace, pas l'empreinte. */
      e.sha256 = null
      e.etag = null
      e.md5_verifie = null
      e.metadonnees = {}
      e.octets = 0
      e.efface_le = stamp
      e.efface_raison = String(argv.raison)
    }
    inv.sha256_liste = empreinteListe(inv.objets)
    inv.octets = inv.objets.reduce((n, x) => n + (x.octets ?? 0), 0)
    ecrireJson(inventairePath, inv)
    ecrireJson(join(racine, 'inventaires', `${horodatage()}-oubli-${id}.json`), inv)

    console.log(`coffre        : ${racine}`)
    console.log(`identifiant   : ${id}`)
    console.log(`objets retirés: ${touches.length - restes.length}`)
    console.log(`raison        : ${argv.raison}`)
    console.log(`empreinte     : ${inv.sha256_liste}`)
    if (restes.length) {
      console.error(`ECHEC : ${restes.length} objet(s) n ont pas pu être retirés :`)
      for (const r of restes) console.error(`  ${r}`)
      return 1
    }
    console.log('ok : les octets sont partis du coffre, la clé et la date restent comme trace.')
    console.log('     Vérifiez que R2 les a aussi : DELETE /api/design/{id} sur le Worker.')
    return 0
  } finally {
    rendreVerrou()
  }
}

/* ─────────────────────────── verifier ─────────────────────────── */

/**
 * LA PORTE. Elle relit les octets sur le disque et recalcule tout : elle ne
 * croit pas l'inventaire, elle le contredit ou elle le confirme.
 *
 * Elle échoue sur, dans cet ordre : pas d'inventaire, format inconnu, zéro
 * objet, un fichier manquant, une taille qui ne colle pas, un sha256 qui ne
 * colle pas, un fichier présent que l'inventaire ne nomme pas, une empreinte de
 * liste qui ne se recalcule pas.
 */
function verbeVerifier(argv) {
  const miroir = argv[0]
  if (!miroir) return usage('verifier attend <miroir>')
  const racine = resolve(miroir)
  const inventairePath = join(racine, 'INVENTAIRE.json')
  const ennuis = []

  if (!existsSync(inventairePath)) {
    console.error(`ECHEC : aucun INVENTAIRE.json sous ${racine}. Rien n a été regardé.`)
    return 1
  }
  let inv
  try {
    inv = JSON.parse(readFileSync(inventairePath, 'utf8'))
  } catch (e) {
    console.error(`ECHEC : INVENTAIRE.json est illisible (${e.message}).`)
    return 1
  }
  if (inv.format !== FORMAT) {
    console.error(`ECHEC : format d inventaire inconnu (${inv.format}), attendu ${FORMAT}.`)
    return 1
  }
  const entrees = Array.isArray(inv.objets) ? inv.objets : []
  if (entrees.length === 0) {
    console.error('ECHEC : l inventaire ne nomme aucun objet. Un contrôle qui ne regarde rien ne passe pas.')
    return 1
  }

  const attendus = new Map()
  let octets = 0
  let lus = 0
  let effaces = 0
  for (const e of entrees) {
    const rel = String(e.fichier ?? '')
    const chemin = join(racine, ...rel.split('/'))
    /* Le chemin doit rester sous la racine, même si l'inventaire a été édité. */
    if (!resolve(chemin).startsWith(racine + sep)) {
      ennuis.push(`${e.cle} : le chemin sort du miroir (${rel})`)
      continue
    }
    attendus.set(resolve(chemin), e)
    /*
     * UN OBJET EFFACÉ DOIT ÊTRE ABSENT, et son absence est alors la réussite,
     * pas l'anomalie. Le contrôle est retourné pour ces entrées-là : c'est sa
     * PRÉSENCE qui devient une anomalie, parce qu'elle voudrait dire qu'un
     * effacement demandé par un client n'a pas eu lieu.
     */
    if (e.efface_le) {
      effaces++
      if (existsSync(chemin)) {
        ennuis.push(`${e.cle} : marqué effacé le ${e.efface_le} et le fichier est toujours là`)
      }
      continue
    }
    if (!existsSync(chemin)) {
      ennuis.push(`${e.cle} : le fichier ${rel} manque`)
      continue
    }
    const contenu = readFileSync(chemin)
    lus++
    octets += contenu.length
    if (contenu.length !== e.octets) {
      ennuis.push(`${e.cle} : ${contenu.length} octets sur le disque contre ${e.octets} à l inventaire`)
      continue
    }
    const h = sha256(contenu)
    if (h !== e.sha256) ennuis.push(`${e.cle} : sha256 ${h.slice(0, 16)} contre ${String(e.sha256).slice(0, 16)} à l inventaire`)
  }

  /* Un fichier de plus est une anomalie autant qu'un fichier de moins : il veut
   * dire que le miroir a été écrit par autre chose que ce script. Les copies
   * gardées sous « .remplace-… » sont attendues et ne comptent pas. */
  for (const p of fichiersSous(join(racine, 'objets'))) {
    const abs = resolve(p)
    if (attendus.has(abs)) continue
    if (/\.remplace-[0-9TZ]+$/.test(abs)) continue
    if (abs.endsWith('.en-cours')) {
      ennuis.push(`${relative(racine, abs)} : téléchargement interrompu laissé sur le disque`)
      continue
    }
    ennuis.push(`${relative(racine, abs)} : présent sur le disque et absent de l inventaire`)
  }

  const empreinte = empreinteListe(entrees)
  if (empreinte !== inv.sha256_liste) {
    ennuis.push(`l empreinte de la liste vaut ${empreinte.slice(0, 16)} et l inventaire annonce ${String(inv.sha256_liste).slice(0, 16)}`)
  }
  if (entrees.length !== inv.compte) {
    ennuis.push(`l inventaire annonce ${inv.compte} objets et en nomme ${entrees.length}`)
  }

  console.log(`miroir            : ${racine}`)
  console.log(`seau d origine    : ${inv.seau ?? inv.source ?? '(inconnu)'}`)
  console.log(`pris le           : ${inv.pris_le}`)
  console.log(`objets à l inventaire : ${entrees.length}`)
  console.log(`fichiers relus    : ${lus} (${octets} octets)`)
  console.log(`empreinte         : ${empreinte}`)
  if (effaces) console.log(`effacés à la demande d un client, absents comme attendu : ${effaces}`)
  if (inv.disparus_du_seau?.length) {
    console.log(`gardés ici et absents du seau : ${inv.disparus_du_seau.length}`)
  }
  if (ennuis.length) {
    console.error(`ECHEC : ${ennuis.length} anomalie(s).`)
    for (const e of ennuis.slice(0, 50)) console.error(`  ${e}`)
    if (ennuis.length > 50) console.error(`  … et ${ennuis.length - 50} autres`)
    return 1
  }
  /*
   * UN CONTRÔLE QUI N'A RIEN RELU N'EST PAS UN CONTRÔLE VERT. Le cas se produit
   * quand tout a été effacé à la demande de clients : c'est un état légitime et
   * ce n'est pas un coffre. Quelqu'un doit le savoir.
   */
  if (lus === 0) {
    console.error(effaces === entrees.length
      ? 'ECHEC : les ' + effaces + ' objets de ce coffre ont tous été effacés. Il ne protège plus rien.'
      : 'ECHEC : aucun fichier n a été relu, donc rien n a été vérifié.')
    return 1
  }
  console.log('ok : chaque objet de l inventaire est sur le disque, à la bonne taille et à la bonne empreinte.')
  return 0
}

/* ─────────────────────────── vers-r2 ─────────────────────────── */

async function verbeVersR2(argv) {
  const [miroir, seau] = argv
  if (!miroir || !seau) return usage('vers-r2 attend <miroir> <seau>')
  if (seau === SEAU_PRODUCTION && !argv['je-restaure-la-production']) {
    console.error(`REFUS : ${SEAU_PRODUCTION} est le seau que servent la boutique et le Worker.`)
    console.error('  Une restauration par-dessus la production se demande explicitement :')
    console.error('  ajoutez --je-restaure-la-production, après avoir lu docs/SAUVEGARDES.md.')
    return 1
  }
  const racine = resolve(miroir)
  const inventairePath = join(racine, 'INVENTAIRE.json')
  if (!existsSync(inventairePath)) {
    console.error(`ECHEC : aucun INVENTAIRE.json sous ${racine}, il n y a rien à restaurer.`)
    return 1
  }
  const inv = JSON.parse(readFileSync(inventairePath, 'utf8'))
  /* Un objet effacé à la demande d'un client ne se restaure pas : c'est le
   * point de l'effacement. Il est écarté ici plutôt que compté en échec. */
  const entrees = (inv.objets ?? [])
    .filter((e) => !e.efface_le)
    .filter((e) => !argv.prefixe || e.cle.startsWith(argv.prefixe))
  if (entrees.length === 0) {
    console.error('ECHEC : rien à restaurer, l inventaire ne nomme aucun objet correspondant.')
    return 1
  }

  const ctx = identifiants()
  const { objets: dejaLa } = await lister(ctx, seau)
  const presents = new Map(dejaLa.map((o) => [o.key, o]))

  const t0 = Date.now()
  let ecrits = 0, sautes = 0, ecrases = 0, octets = 0
  const echecs = []
  const metadonneesPerdues = []
  const sansType = []

  for (const e of entrees) {
    const chemin = join(racine, ...String(e.fichier).split('/'))
    if (!existsSync(chemin)) { echecs.push(`${e.cle} : le fichier du coffre manque`); continue }
    const contenu = readFileSync(chemin)
    /* On ne remet jamais dans un seau des octets dont on ne vient pas de
     * prouver qu'ils sont ceux de l'inventaire. Restaurer un fichier corrompu
     * par-dessus un objet vivant ferait de la sauvegarde la panne. */
    if (sha256(contenu) !== e.sha256) { echecs.push(`${e.cle} : le sha256 du coffre ne correspond pas à l inventaire`); continue }

    const present = presents.get(e.cle)
    if (present && !argv.ecraser) { sautes++; continue }

    const entetes = {}
    if (e.type) entetes['content-type'] = e.type
    else sansType.push(e.cle)
    if (e.cache) entetes['cache-control'] = e.cache
    try {
      await televerser(ctx, seau, e.cle, contenu, entetes)
    } catch (err) {
      echecs.push(`${e.cle} : ${err.message}`)
      continue
    }
    if (present) ecrases++
    ecrits++
    octets += contenu.length
    if (e.metadonnees && Object.keys(e.metadonnees).length) metadonneesPerdues.push(e.cle)
  }

  console.log(`coffre            : ${racine}`)
  console.log(`seau destinataire : ${seau}`)
  console.log(`identifiant       : ${ctx.provenance}`)
  console.log(`objets écrits     : ${ecrits} (dont ${ecrases} par-dessus un existant), ${octets} octets`)
  console.log(`objets sautés     : ${sautes} (déjà dans le seau, --ecraser pour les remplacer)`)
  console.log(`durée             : ${Date.now() - t0} ms`)
  if (metadonneesPerdues.length) {
    console.log(`métadonnées non restituées : ${metadonneesPerdues.length} objet(s).`)
    console.log('  L API REST de Cloudflare ne porte pas custom_metadata (mesuré le 05/09/2026).')
    console.log('  Les valeurs d origine restent dans INVENTAIRE.json. Voir docs/SAUVEGARDES.md.')
  }
  /*
   * SANS TYPE, UNE VIGNETTE NE S'AFFICHE PLUS. `serveDesignFile` rend le
   * content-type STOCKÉ et pose `nosniff` : un `preview.png` restauré sans type
   * est refusé par le navigateur, donc la vignette du panier et l'image du bon
   * a tirer deviennent des cadres vides. (`serveAr`, lui, impose le type d'après
   * l'extension et ne craint rien.) Ce n'est pas une raison de refuser de
   * restaurer une oeuvre, c'en est une de le dire.
   */
  if (sansType.length) {
    console.log(`ATTENTION : ${sansType.length} objet(s) restaurés SANS content-type :`)
    for (const c of sansType.slice(0, 10)) console.log(`  ${c}`)
    console.log('  Une vignette servie sans type est refusée par le navigateur (nosniff).')
  }
  if (echecs.length) {
    console.error(`ECHEC : ${echecs.length} objet(s) non restauré(s).`)
    for (const e of echecs.slice(0, 50)) console.error(`  ${e}`)
    return 1
  }
  console.log('ok : chaque objet demandé est dans le seau.')
  return 0
}

/* ─────────────────────────── comparer ─────────────────────────── */

/**
 * Le seau contre l'inventaire, octet par octet. C'est ce verbe qui transforme
 * « on a restauré » en « on a vérifié la restauration » : il relit les objets
 * DEPUIS R2 et recalcule leur sha256, sans jamais faire confiance à la taille
 * annoncée ni à l'etag.
 */
async function verbeComparer(argv) {
  const [miroir, seau] = argv
  if (!miroir || !seau) return usage('comparer attend <miroir|inventaire.json> <seau>')
  const inventairePath = cheminInventaire(miroir)
  if (!existsSync(inventairePath)) {
    console.error(`ECHEC : aucun inventaire lisible à ${inventairePath}.`)
    return 1
  }
  const inv = JSON.parse(readFileSync(inventairePath, 'utf8'))
  const entrees = (inv.objets ?? []).filter((e) => !argv.prefixe || e.cle.startsWith(argv.prefixe))
  if (entrees.length === 0) {
    console.error('ECHEC : l inventaire ne nomme aucun objet à comparer.')
    return 1
  }

  const ctx = identifiants()
  const { objets } = await lister(ctx, seau, argv.prefixe)
  const dans = new Map(objets.map((o) => [o.key, o]))
  const ennuis = []
  let compares = 0, octets = 0

  for (const e of entrees) {
    const o = dans.get(e.cle)
    if (!o) { ennuis.push(`${e.cle} : absent du seau ${seau}`); continue }
    if (o.size !== e.octets) { ennuis.push(`${e.cle} : ${o.size} octets dans le seau contre ${e.octets} à l inventaire`); continue }
    const contenu = await telecharger(ctx, seau, e.cle)
    compares++
    octets += contenu.length
    const h = sha256(contenu)
    if (h !== e.sha256) ennuis.push(`${e.cle} : sha256 ${h.slice(0, 16)} dans le seau contre ${String(e.sha256).slice(0, 16)} à l inventaire`)
  }
  const enTrop = objets.filter((o) => !entrees.some((e) => e.cle === o.key)).map((o) => o.key)

  console.log(`inventaire        : ${inventairePath}`)
  console.log(`seau comparé      : ${seau}${argv.prefixe ? ` (préfixe ${argv.prefixe})` : ''}`)
  console.log(`objets attendus   : ${entrees.length}`)
  console.log(`objets relus      : ${compares} (${octets} octets, relus depuis R2)`)
  if (enTrop.length) {
    console.log(`objets dans le seau et hors inventaire : ${enTrop.length}`)
    for (const c of enTrop.slice(0, 10)) console.log(`  ${c}`)
  }
  if (ennuis.length) {
    console.error(`ECHEC : ${ennuis.length} écart(s).`)
    for (const e of ennuis.slice(0, 50)) console.error(`  ${e}`)
    return 1
  }
  if (compares === 0) {
    console.error('ECHEC : aucun objet n a été relu, donc rien n a été prouvé.')
    return 1
  }
  console.log('ok : chaque objet de l inventaire est dans le seau, aux mêmes octets.')
  return 0
}

/* ─────────────────────────── entrée ─────────────────────────── */

function usage(message) {
  if (message) console.error(`sauvegarde-r2: ${message}`)
  console.error(`
Usage :
  node scripts/sauvegarde-r2.mjs inventaire <seau> [--prefixe=design/]
      Compte et pèse ce qu il y a dans le seau. Ne touche à rien.

  node scripts/sauvegarde-r2.mjs depuis-r2 <seau> <miroir> [--prefixe=…] [--vide-permis]
      Copie le seau vers le disque, écrit INVENTAIRE.json, et NOMME les objets
      qui ont disparu du seau depuis la dernière fois sans les supprimer.

  node scripts/sauvegarde-r2.mjs verifier <miroir>
      Relit chaque fichier et recalcule chaque empreinte. C est la porte.

  node scripts/sauvegarde-r2.mjs vers-r2 <miroir> <seau> [--prefixe=…] [--ecraser]
      Restaure. N écrase rien sans --ecraser, et refuse ${SEAU_PRODUCTION} sans
      --je-restaure-la-production.

  node scripts/sauvegarde-r2.mjs comparer <miroir|inventaire.json> <seau> [--prefixe=…]
      Relit le seau et le compare à l inventaire, octet par octet.

  node scripts/sauvegarde-r2.mjs oublier <miroir> <identifiant> --raison="…"
      Retire du coffre les octets d un client qui a demandé son effacement.
      La clé et la date restent comme trace ; les octets et l empreinte partent.

Identifiants : CF_ACCOUNT_ID et CF_API_TOKEN, ou ~/.config/teeshoop/r2.env,
ou une session wrangler ouverte. Aucun identifiant refuse tout.

Codes de sortie : 0 bon, 1 problème, 2 mauvais usage, 3 sauvegarde complète mais
des objets ont disparu du seau (à lire, pas à ignorer).
`)
  return 2
}

async function principal() {
  const brut = process.argv.slice(2)
  const verbe = brut[0]
  const argv = []
  for (const a of brut.slice(1)) {
    if (a.startsWith('--')) {
      const [n, v] = a.slice(2).split('=')
      argv[n] = v === undefined ? true : v
    } else argv.push(a)
  }
  try {
    switch (verbe) {
      case 'inventaire': return await verbeInventaire(argv)
      case 'depuis-r2': return await verbeDepuisR2(argv)
      case 'verifier': return verbeVerifier(argv)
      case 'oublier': return verbeOublier(argv)
      case 'vers-r2': return await verbeVersR2(argv)
      case 'comparer': return await verbeComparer(argv)
      default: return usage(verbe ? `verbe inconnu : ${verbe}` : null)
    }
  } catch (e) {
    console.error(`ECHEC : ${e.message}`)
    return 1
  }
}

process.exit(await principal())
