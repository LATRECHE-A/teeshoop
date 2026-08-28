#!/usr/bin/env node
/**
 * PURCHASE-BENCH: what a realistic week of orders costs to buy, in blanks.
 *
 *   FR_WS_USER=… FR_WS_PASS=… node scripts/purchase-bench.mjs [styleNr]
 *
 * `scripts/dtf-bench.mjs` measured what pooling a week of orders saves on FILM.
 * This measures the other half of the same run: the garments. Same six orders,
 * same size grids, so the two numbers can be read side by side.
 *
 * ── IT RE-IMPLEMENTS NOTHING ────────────────────────────────────────────────
 *
 * The basket, the totals and the carriage are computed by the shipped code:
 * this script fetches the live prices and stock, hands the claims to
 * `Purchase::aggregate()` through a generated PHP driver, and prints what comes
 * back. A bench with its own arithmetic measures its own arithmetic, and this
 * one exists to say what the shop will actually do.
 *
 * ── THE PRICES ARE REAL AND THE ORDERS ARE NOT ──────────────────────────────
 *
 * Every purchase price and every stock figure here is read from the supplier's
 * live webservice at the moment the bench runs, and it says so with the
 * timestamp the supplier published. The six orders are the fixture from session
 * 07, which is a plausible week and not a measured one. So the euros are the
 * supplier's; the shape of the week is ours.
 *
 * Exit 0 when the bench ran, 1 when it could not.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const WS = 'https://ws.falk-ross.eu'
const DOWNLOAD = 'https://download.falk-ross.eu'
const ARGS = process.argv.slice(2)
const STYLE = ARGS.find((a) => !a.startsWith('--')) ?? '18001'
/**
 * `--coloris=White` to price the same week in another colour.
 *
 * It is not decoration: it is how the shortage report is proved to fire. The
 * default colour is usually well stocked, so a bench that only ever ran on it
 * would print « tout est en stock » for ever and nobody would know whether it
 * could say anything else.
 */
const COLOUR = (ARGS.find((a) => a.startsWith('--coloris=')) ?? '').slice('--coloris='.length)

/**
 * The week, verbatim from `scripts/dtf-bench.mjs`.
 *
 * COPIED AND NOT IMPORTED, deliberately, and this is the one duplication here.
 * That file is a browser harness: it renders artwork through the real pipeline
 * inside a page, and importing it would drag Konva, three.js and a headless
 * Chromium into a script whose whole job is arithmetic on quantities. The
 * fixture is six literals; what must not be duplicated is what is DERIVED from
 * them, and none of that is here.
 */
const WEEK = [
  { id: '1041', sizes: { M: 12, L: 8 } },
  { id: '1042', sizes: { S: 4, M: 6 } },
  { id: '1043', sizes: { L: 5 } },
  { id: '1044', sizes: { M: 3, L: 3, XL: 2 } },
  { id: '1045', sizes: { S: 2, XL: 2 } },
  { id: '1046', sizes: { M: 20 } },
]

// --- credentials -----------------------------------------------------------

function loadDevVars() {
  try {
    const text = readFileSync(join(ROOT, '.dev.vars'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    /* absent is fine */
  }
}
loadDevVars()

const USER = process.env.FR_WS_USER
const PASS = process.env.FR_WS_PASS
if (!USER || !PASS) {
  console.error('Set FR_WS_USER and FR_WS_PASS (or put them in .dev.vars).')
  process.exit(1)
}
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

// --- the supplier ----------------------------------------------------------

const strip = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
const inner = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? m[1] : ''
}
const text = (xml, name) => strip(inner(xml, name))
const all = (xml, name) => [
  ...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g')),
].map((m) => m[1])

async function get(url, auth = false) {
  const res = await fetch(url, { headers: auth ? { authorization: AUTH } : {} })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.text()
}

/**
 * The style's articles: article number, colour name, size name.
 *
 * The colour NAME is on the article and not in a colour block of its own
 * (`sku_color_name`), which is what `parseStyle` in the Worker reads too. Read
 * from a block that does not exist, every colour came back as its three-digit
 * code and this bench announced a basket in colour « 000 ».
 */
async function articles() {
  const list = await get(`${DOWNLOAD}/ws/falkross-stylelist.xml`)
  const version = text(list, 'file_version') || 'R000-011'
  const xml = await get(`${DOWNLOAD}/ws/${version}/xml/${STYLE}.xml`)

  const rows = []
  for (const sku of all(xml, 'sku')) {
    const nr = text(sku, 'sku_artnum')
    const code = text(sku, 'sku_color_code')
    const size = text(sku, 'sku_size_name')
    const colour = text(sku, 'sku_color_name')
    if (!nr || !size) continue
    rows.push({ sku: nr, colourCode: code, colour: colour || code, size })
  }
  return { version, rows, brand: text(xml, 'brand_name'), ref: text(xml, 'supplier_article_code') }
}

/** SKU to our purchase price, in cents. */
async function prices() {
  const csv = await get(`${WS}/ws/run/price.pl?format=csv&style=${STYLE}&action=get_price`, true)
  const out = new Map()
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [sku, , cost] = line.split(';')
    if (!sku || !/^\d{6,}$/.test(sku)) continue
    out.set(sku, Math.round(parseFloat(cost) * 100) || 0)
  }
  return out
}

/** SKU to the first of the supplier's three numbers, and when he published it. */
async function stock() {
  const csv = await get(
    `${WS}/webservice/R03_000/stockinfo/product/${STYLE}____?format=csv`,
    true,
  )
  const lines = csv.split(/\r?\n/)
  const out = new Map()
  for (const line of lines.slice(1)) {
    const [sku, green] = line.split(';')
    if (!sku || !/^\d{6,}$/.test(sku)) continue
    out.set(sku, parseInt(green, 10) || 0)
  }
  return { at: (lines[0] ?? '').trim(), out }
}

// --- the shipped arithmetic ------------------------------------------------

/**
 * `Purchase::aggregate()` and `Cost::freight()`, run for real.
 *
 * The driver is generated into a temp directory rather than kept in `scripts/`,
 * the way `scripts/hypotheses-guard.mjs` generates its own: it is the calling
 * convention of this file and not a file anybody should edit.
 */
function runShop(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-buy-'))
  try {
    const driver = join(dir, 'driver.php')
    const input = join(dir, 'in.json')
    writeFileSync(input, JSON.stringify(payload))
    writeFileSync(
      driver,
      `<?php
declare( strict_types = 1 );
define( 'TEESHOOP_TEST', true );
require_once ${JSON.stringify(join(ROOT, 'wp-plugins/teeshoop-core/includes/Money.php'))};
require_once ${JSON.stringify(join(ROOT, 'wp-plugins/teeshoop-core/includes/Cost.php'))};
require_once ${JSON.stringify(join(ROOT, 'wp-plugins/teeshoop-core/includes/Supply.php'))};
require_once ${JSON.stringify(join(ROOT, 'wp-plugins/teeshoop-core/includes/Purchase.php'))};

use Teeshoop\\Core\\Cost;
use Teeshoop\\Core\\Purchase;

$in     = json_decode( file_get_contents( ${JSON.stringify(input)} ), true );
$config = Cost::default_config();

$pooled           = Purchase::aggregate( $in['claims'], array(), $config );
// The verdict on the shelf is a separate function, and asking for it is the
// caller's job: aggregate() deliberately answers nothing about stock.
$pooled['stock']  = Purchase::stock_verdict( $pooled['rows'], '' );

$solo = array();
foreach ( $in['claims'] as $claim ) {
    $solo[ $claim['order_id'] ][] = $claim;
}
$alone = array();
foreach ( $solo as $id => $claims ) {
    $one = Purchase::aggregate( $claims, array(), $config );
    $alone[ (string) $id ] = array(
        'garments'   => $one['garments'],
        'blanks_ht'  => $one['blanks_ht'],
        'freight_ht' => $one['freight_ht'],
        'total_ht'   => $one['total_ht'],
    );
}

$weights = array();
foreach ( $alone as $id => $row ) {
    $weights[ $id ] = $row['blanks_ht'];
}

echo json_encode(
    array(
        'pooled'  => $pooled,
        'alone'   => $alone,
        'share'   => Cost::allocate( (int) $pooled['freight_ht'], $weights ),
        'franco'  => (int) $config['freight_free_from_ht'],
        'carriage' => (int) $config['freight_ht'],
    )
);
`,
    )
    return JSON.parse(execFileSync('php', [driver], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- reporting -------------------------------------------------------------

const eur = (cents) =>
  (cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const pad = (s, n) => String(s).padEnd(n)
const num = (s, n) => String(s).padStart(n)

async function main() {
  const [cat, price, st] = await Promise.all([articles(), prices(), stock()])

  console.log(`\x1b[1mUne semaine de six commandes, en textile nu\x1b[0m`)
  console.log(
    `Référence ${STYLE} · ${cat.brand} ${cat.ref} · tarifs et stock relevés maintenant, publiés le ${st.at}\n`,
  )

  // One colour, so the bench measures a size run and not a colour spread. The
  // week's fixture is one design on one garment; the colour it was drawn on is
  // black in both sample designs.
  const wanted = COLOUR !== '' ? [COLOUR] : ['Black', 'Noir']
  const colours = [...new Set(cat.rows.map((r) => r.colour))]
  const colour = colours.find((c) => wanted.includes(c)) ?? (COLOUR !== '' ? null : colours[0])
  if (colour === null) {
    console.error(`Cette référence ne se vend pas en « ${COLOUR} ». Coloris publiés : ${colours.join(', ')}.`)
    process.exit(1)
  }

  const bySize = new Map()
  for (const row of cat.rows) {
    if (row.colour === colour) bySize.set(row.size, row)
  }

  const claims = []
  const missing = new Set()
  for (const order of WEEK) {
    for (const [size, qty] of Object.entries(order.sizes)) {
      const article = bySize.get(size)
      if (!article) {
        missing.add(size)
        continue
      }
      claims.push({
        order_id: order.id,
        order_ref: order.id,
        item_id: 1,
        sku: article.sku,
        source: 'ws',
        label: `${cat.brand} ${cat.ref}`,
        colour,
        size,
        qty,
        unit_ht: price.get(article.sku) ?? null,
        stock: st.out.get(article.sku) ?? null,
        stock_at: st.at,
      })
    }
  }

  if (missing.size > 0) {
    console.error(
      `Le fournisseur ne vend pas ${[...missing].join(', ')} en ${colour} sur cette référence : la semaine ne peut pas être achetée telle quelle.`,
    )
    process.exit(1)
  }

  const shop = runShop({ claims })
  const { pooled, alone, share } = shop

  console.log(`\x1b[1mLe panier d'achat, coloris ${colour}\x1b[0m`)
  console.log(
    `  ${pad('article', 11)} ${pad('taille', 7)} ${num('qté', 4)} ${num('unitaire', 10)} ${num('montant', 11)} ${num('stock', 7)}  commandes`,
  )
  for (const row of pooled.rows) {
    const from = row.from.map((f) => `${f.order_ref}×${f.qty}`).join(' + ')
    console.log(
      `  ${pad(row.sku, 11)} ${pad(row.size, 7)} ${num(row.qty, 4)} ${num(eur(row.unit_ht) + ' €', 10)} ${num(eur(row.amount_ht) + ' €', 11)} ${num(row.stock ?? '?', 7)}  ${from}`,
    )
  }
  console.log(
    `  ${pad('', 11)} ${pad('total', 7)} ${num(pooled.garments, 4)} ${num('', 10)} ${num(eur(pooled.blanks_ht) + ' €', 11)}`,
  )
  console.log(`  port fournisseur : ${eur(pooled.freight_ht)} € HT`)
  console.log(`  \x1b[1mà payer : ${eur(pooled.total_ht)} € HT\x1b[0m\n`)

  console.log(`\x1b[1mAcheté commande par commande, ce serait\x1b[0m`)
  let soloTotal = 0
  let soloFreight = 0
  for (const order of WEEK) {
    const one = alone[order.id]
    soloTotal += one.total_ht
    soloFreight += one.freight_ht
    console.log(
      `  ${pad(order.id, 6)} ${num(one.garments, 4)} pièces  ${num(eur(one.blanks_ht) + ' €', 11)} de textile  + ${num(eur(one.freight_ht) + ' €', 9)} de port  = ${num(eur(one.total_ht) + ' €', 11)}   part du port groupé : ${eur(share[order.id] ?? 0)} €`,
    )
  }
  console.log(
    `  ${pad('', 6)} ${num('', 4)}          ${num(eur(pooled.blanks_ht) + ' €', 11)}              + ${num(eur(soloFreight) + ' €', 9)}          = ${num(eur(soloTotal) + ' €', 11)}\n`,
  )

  const saved = soloTotal - pooled.total_ht
  console.log(`\x1b[1mCe que le groupage fait gagner\x1b[0m`)
  console.log(`  ${eur(saved)} € HT sur la semaine, et c'est ENTIÈREMENT du port :`)
  console.log(
    `  le textile coûte le même prix (${eur(pooled.blanks_ht)} € dans les deux cas, l'article est vendu à l'unité),`,
  )
  console.log(
    `  et ${WEEK.length} ports de ${eur(shop.carriage)} € deviennent ${eur(pooled.freight_ht)} € parce que le panier groupé passe le franco de ${eur(shop.franco)} €.`,
  )
  console.log(
    `  À comparer aux 121,41 € que le groupage du FILM fait gagner sur la même semaine (scripts/dtf-bench.mjs).\n`,
  )

  const short = pooled.stock.short ?? []
  console.log(`\x1b[1mCe que le fournisseur a\x1b[0m`)
  if (short.length === 0) {
    console.log(`  Tout est en stock au relevé du ${st.at}.`)
  } else {
    for (const one of short) {
      console.log(
        `  \x1b[33m${one.sku} ${pad(one.size, 4)} : ${num(one.have, 5)} en stock pour ${num(one.want, 4)} demandés\x1b[0m`,
      )
    }
    console.log(
      `  Cette semaine ne peut donc PAS être achetée telle quelle aujourd'hui : il faut une autre taille, un autre coloris, ou attendre le réapprovisionnement annoncé.`,
    )
  }
  console.log(
    `  Ce relevé est une observation datée, jamais une réservation : le fournisseur sert d'autres clients entre-temps.`,
  )
}

main().catch((err) => {
  console.error('\npurchase-bench a échoué :', err?.message ?? err)
  process.exit(1)
})
