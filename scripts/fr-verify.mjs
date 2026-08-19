#!/usr/bin/env node
/**
 * FR-VERIFY — hit the live Falk&Ross webservice and print what came back.
 *
 * A browser-free sanity check for the supplier integration: it proves the
 * credentials work, the URL shapes are still what worker/falkross.ts assumes,
 * and the XML field names have not moved. Run it after any supplier-side
 * change, or when the catalogue starts behaving oddly and you need to know
 * which side is at fault.
 *
 *   FR_WS_USER=… FR_WS_PASS=… node scripts/fr-verify.mjs [styleNr]
 *
 * Credentials are read from the environment ONLY — never hard-coded here, and
 * never printed. If you keep them in .dev.vars (git-ignored), this picks them
 * up from there automatically.
 *
 * READ-ONLY: it never places an order that could be filled. The order endpoint
 * is probed twice, and BOTH probes are built so that the supplier cannot create
 * anything from them:
 *
 *   - check 7 posts a document with no `<product_list>` at all, which the
 *     gateway refuses before looking at the account;
 *   - check 8 posts a structurally complete document whose only line is the
 *     article number 999999999. MEASURED 2026-08-19 against the live snapshot
 *     of 46 591 articles: it does not exist, and the largest number the
 *     supplier publishes is 999671018, so it cannot come to exist by a new
 *     colour being added. An order all of whose lines are unknown articles is
 *     an order with nothing to ship.
 *
 * Check 8 also refuses to run unless the account is in TEST mode.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOWNLOAD = 'https://download.falk-ross.eu'
const WS = 'https://ws.falk-ross.eu'
const STYLE = process.argv[2] ?? '18001'

// --- credentials -----------------------------------------------------------

/** .dev.vars is `KEY = "value"` lines; only used to fill gaps in the env. */
function loadDevVars() {
  try {
    const text = readFileSync(join(HERE, '..', '.dev.vars'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    /* absent is fine — the environment may carry them already */
  }
}
loadDevVars()

const USER = process.env.FR_WS_USER
const PASS = process.env.FR_WS_PASS
if (!USER || !PASS) {
  console.error('Set FR_WS_USER and FR_WS_PASS (or put them in .dev.vars).')
  process.exit(2)
}
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64')

// --- tiny XML helpers (mirrors of worker/xml.ts, kept independent on purpose:
//     a bug copied into the checker would verify itself) ----------------------

const strip = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? strip(m[1]) : ''
}
const tagsAll = (xml, name) => [
  ...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g')),
].map((m) => m[1])

// --- the order probe -------------------------------------------------------

/**
 * An article number the supplier does not use, and cannot start using by
 * accident. MEASURED 2026-08-19 over all 46 591 published articles: the largest
 * is 999671018.
 */
const PROBE_SKU = '999999999'

/** A customer number that is certainly not ours, so the probe can be falsified. */
const WRONG_CUSTOMER = '000000'

/** The probe document. One line, and that line names nothing that exists. */
const probeOrder = (customerNumber) =>
  '<?xml version="1.0" encoding="utf-8"?><order>' +
  `<request_date_time>${new Date().toISOString().slice(0, 19).replace('T', ' ')}</request_date_time>` +
  `<customers_number><cn_value><![CDATA[${customerNumber}]]></cn_value></customers_number>` +
  '<shipping_method><sm_value>0</sm_value></shipping_method>' +
  '<partial_shipment><ps_value>false</ps_value></partial_shipment>' +
  '<order_reference><or_value><![CDATA[TS-PROBE-NE-PAS-SERVIR]]></or_value></order_reference>' +
  '<order_note><on_value><![CDATA[Sonde automatique Teeshoop, ne pas traiter.]]></on_value></order_note>' +
  '<delivery_address><da_is_different><da_value>false</da_value></da_is_different></delivery_address>' +
  `<product_list><product><p_sku>${PROBE_SKU}</p_sku><p_lineref><![CDATA[probe]]></p_lineref>` +
  '<p_quantity><pq_ordered>1</pq_ordered></p_quantity></product></product_list>' +
  '</order>'

// --- reporting -------------------------------------------------------------

let failures = 0
const ok = (label, detail) => console.log(`  \x1b[32mok\x1b[0m   ${label}${detail ? ' — ' + detail : ''}`)
const bad = (label, detail) => {
  failures++
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ' — ' + detail : ''}`)
}
const head = (s) => console.log(`\n\x1b[1m${s}\x1b[0m`)

async function get(url, auth = false) {
  const res = await fetch(url, { headers: auth ? { authorization: AUTH } : {} })
  return { status: res.status, body: await res.text() }
}

// --- checks ----------------------------------------------------------------

async function main() {
  console.log(`Falk&Ross webservice check — account ${USER.slice(0, 6)}…, style ${STYLE}`)

  head('1. Webservice mode (state.pl)')
  {
    const { status, body } = await get(`${WS}/ws/run/state.pl?action=getstate`, true)
    const code = tag(body, 'webservice_mode_code')
    const name = tag(body, 'webservice_mode_name')
    if (status === 401 || status === 403) bad('credentials rejected', `HTTP ${status}`)
    else if (code === '') bad('no webservice_mode_code', `HTTP ${status}`)
    else ok('credentials accepted', `mode ${code} = ${name}`)
    if (code === '0') {
      console.log('  \x1b[33m!!  LIVE MODE — orders placed on this account are REAL.\x1b[0m')
    }
  }

  head('2. Style list (falkross-stylelist.xml)')
  let version = 'R000-011'
  {
    const { status, body } = await get(`${DOWNLOAD}/ws/falkross-stylelist.xml`)
    version = tag(body, 'file_version') || version
    const count = tagsAll(body, 'style_nr').length
    if (status !== 200 || count === 0) bad('style list unreadable', `HTTP ${status}`)
    else ok('style list', `${count} styles · version ${version} · exported ${tag(body, 'export_data_date')}`)
    // The PDF documents /ws/xml/{nr}.xml; the live feed links /ws/{version}/xml/.
    const link = tag(body, 'url_style_xml')
    if (link.includes(`/${version}/`)) ok('per-style link is version-scoped', link)
    else bad('unexpected per-style link shape', link)
  }

  head(`3. Style detail (${STYLE}.xml)`)
  {
    const { status, body } = await get(`${DOWNLOAD}/ws/${version}/xml/${STYLE}.xml`)
    if (status !== 200 || !body.includes('<style>')) {
      bad('style detail unreadable', `HTTP ${status}`)
    } else {
      ok('style detail', `${tag(body, 'brand_name')} ${tag(body, 'supplier_article_code')}`)
      const shots = tagsAll(body, 'shottype').map(strip)
      const kinds = [...new Set(shots)].join(',')
      ok('shot types', kinds || '(none)')
      // 'mb' is undocumented but real — the parser must classify it as a BACK.
      if (shots.includes('mb')) ok("undocumented 'mb' (model back) present", 'parser handles it')
      const skus = tagsAll(body, 'sku_artnum').length
      const colours = new Set(tagsAll(body, 'sku_color_code').map(strip)).size
      const sizes = [...new Set(tagsAll(body, 'sku_size_name').map(strip))].join(',')
      ok('sku_list', `${skus} SKUs · ${colours} colourways · sizes ${sizes}`)
      const pdf = tag(body, 'sizespec_download_link')
      ok('sizespec PDF', pdf || '(none)')
      // The whole reason size tables are estimated: assert the absence.
      if (/half_?chest|body_?length|chest_?cm|measure/i.test(body)) {
        bad('a measurement-looking field appeared', 're-check the size provenance!')
      } else {
        ok('no garment measurements published', 'reference-chart estimate stays correct')
      }
      if (tagsAll(body, 'sku_cc_list').length > 0) {
        console.log('  note: sku_cc_list (hex/RGB) now present — swatches could use real colours')
      } else {
        ok('no sku_cc_list', 'colour swatches remain images, not hex')
      }
    }
  }

  head(`4. Prices (price.pl, style ${STYLE})`)
  {
    const { status, body } = await get(
      `${WS}/ws/run/price.pl?format=csv&style=${STYLE}&action=get_price`,
      true,
    )
    if (body.includes('<error>')) bad('price error', `${tag(body, 'error_code')} ${tag(body, 'error_msg')}`)
    else {
      const rows = body.trim().split(/\r?\n/)
      const header = rows[0]
      const sample = (rows[1] ?? '').split(';')
      if (!header.startsWith('artnr;default_price;your_price')) bad('unexpected CSV header', header)
      else ok('price CSV', `${rows.length - 1} SKUs · e.g. ${sample[0]} cost ${sample[2]} ${sample[3]}`)
      console.log('  note: your_price is OUR PURCHASE COST, not a retail price.')
    }
    if (status !== 200) bad('unexpected status', `HTTP ${status}`)
  }

  head(`5. Stock (stockinfo, style ${STYLE})`)
  {
    const { status, body } = await get(
      `${WS}/webservice/R03_000/stockinfo/product/${STYLE}____?format=csv`,
      true,
    )
    const rows = body.trim().split(/\r?\n/)
    if (status !== 200) bad('stock unreadable', `HTTP ${status}`)
    else if (rows.length < 2) bad('no stock rows', `first line: ${rows[0]}`)
    else ok('stock CSV', `as of ${rows[0]} · ${rows.length - 1} SKUs · e.g. ${rows[1]}`)
  }

  head('6. Delivery dates (stock.pl get_deliveries)')
  {
    const { status, body } = await get(
      `${WS}/ws/run/stock.pl?format=xml&action=get_deliveries`,
      true,
    )
    const items = tagsAll(body, 'item').length
    if (status !== 200 || items === 0) bad('deliveries unreadable', `HTTP ${status}`)
    else ok('deliveries', `${items} announced · exported ${tag(body, 'export_data_date')}`)
  }

  head('7. Order endpoint contract (REJECTED ON PURPOSE — nothing is ordered)')
  {
    // No <product_list>: the gateway refuses this before creating anything.
    const probe =
      '<?xml version="1.0" encoding="utf-8"?><order>' +
      '<request_date_time></request_date_time>' +
      '<customers_number><cn_value></cn_value></customers_number>' +
      '<shipping_method><sm_value>0</sm_value></shipping_method>' +
      '</order>'
    const res = await fetch(`${WS}/webservice/R02_000/order?format=xml`, {
      method: 'POST',
      headers: {
        authorization: AUTH,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: probe,
    })
    const body = await res.text()
    const code = tag(body, 'code') || tag(body, 'err')
    if (res.status === 400 && body.includes('<error>')) {
      ok('order endpoint reachable and validating', `rejected with ${code}: ${tag(body, 'message')}`)
    } else if (body.includes('<order>')) {
      ok('order endpoint reachable', `echoed order, err=${code}`)
    } else {
      bad('unexpected order response', `HTTP ${res.status} ${body.slice(0, 120)}`)
    }
  }

  head('8. Whole-catalogue stock in one call (truncation wildcard at every digit)')
  {
    /*
     * The measurement the stock sweep is built on. If the supplier ever stops
     * accepting a fully wild product filter, `GET /api/fr/stock` degrades from
     * one upstream call to 460 and this is where that is noticed, not in
     * production when the sweep times out.
     */
    const t0 = Date.now()
    const { status, body } = await get(
      `${WS}/webservice/R03_000/stockinfo/product/_________?format=csv`,
      true,
    )
    const rows = body.trim().split(/\r?\n/)
    const skus = rows.slice(1).filter((l) => /^\d{6,};/.test(l)).length
    if (status !== 200 || skus < 1000) {
      bad('whole-catalogue stock unreadable', `HTTP ${status}, ${skus} rows`)
    } else {
      ok(
        'whole-catalogue stock',
        `${skus} SKUs · ${(body.length / 1024).toFixed(0)} KB · ${Date.now() - t0} ms · as of ${rows[0]}`,
      )
    }
    // The probe article of check 9 must stay a number the supplier does not use.
    if (rows.some((l) => l.startsWith(`${PROBE_SKU};`))) {
      bad('the probe article now exists upstream', `${PROBE_SKU} is a real SKU — pick another`)
    } else {
      ok('probe article is not a real SKU', PROBE_SKU)
    }
  }

  head('9. Customer number (NOTHING ORDERABLE IS IN THE DOCUMENT)')
  {
    /*
     * WHAT THIS ANSWERS. `FR_CUSTOMER_NR` is not set anywhere, and the Worker
     * refuses to place an order without it rather than deriving one from the
     * login, which is shaped `{account}-{n}-{token}`. The obvious guess is that
     * the leading segment IS the customer number. This check asks the supplier
     * instead of assuming, and it is written so it can come back "I cannot
     * tell": the same document is posted twice, once with the derived number
     * and once with a number that is certainly not ours, and the answer only
     * means something if the two differ.
     *
     * A LOCAL XML BUILDER, ON PURPOSE. Every other helper in this file is an
     * independent re-implementation for the same reason (a bug copied into the
     * checker verifies itself). This document is not an order: it is a probe
     * whose single line names an article that does not exist, so it cannot be
     * filled, and its only structural job is to get far enough for the gateway
     * to judge the account.
     */
    const state = await get(`${WS}/ws/run/state.pl?action=getstate`, true)
    const mode = tag(state.body, 'webservice_mode_code')
    if (mode !== '1') {
      bad(
        'refusing to probe: the account is not in test mode',
        `webservice_mode_code=${mode} — nothing was sent`,
      )
    } else {
      const derived = /^(\d+)-/.exec(USER)?.[1] ?? ''
      if (!derived) {
        bad('cannot derive a candidate customer number from FR_WS_USER', 'unexpected login shape')
      } else {
        const answers = []
        for (const [label, cn] of [
          ['derived from the login', derived],
          ['deliberately wrong', WRONG_CUSTOMER],
        ]) {
          const res = await fetch(`${WS}/webservice/R02_000/order?format=xml`, {
            method: 'POST',
            headers: { authorization: AUTH, 'content-type': 'application/x-www-form-urlencoded' },
            body: probeOrder(cn),
          })
          const body = await res.text()
          answers.push({
            label,
            status: res.status,
            orderId: tag(body, 'orders_id'),
            err: tag(body, 'code') || tag(body, 'err'),
            msg: (tag(body, 'message') || tag(body, 'err_msg') || tag(body, 'msg')).slice(0, 80),
          })
        }
        const [mine, wrong] = answers
        for (const a of answers) {
          console.log(
            `  ${a.label.padEnd(24)} HTTP ${a.status} · orders_id ${a.orderId || '(none)'} · code ${a.err || '(none)'} · ${a.msg}`,
          )
        }
        const same = mine.status === wrong.status && mine.err === wrong.err && mine.msg === wrong.msg
        if (same) {
          /*
           * NOT A FAILURE, AND NOT A PASS. The endpoint answers a bad account
           * exactly as it answers ours, so this cannot tell them apart and must
           * not be reported as if it could. The customer number stays a
           * question for the supplier.
           */
          ok(
            'inconclusive, and says so',
            'the gateway answers a wrong customer number identically — this cannot confirm ours',
          )
        } else if (mine.orderId === '0' || mine.err === '30' || /artno|article/i.test(mine.msg)) {
          ok('the derived customer number is ACCEPTED', 'refused on the article, not on the account')
        } else {
          bad(
            'the derived customer number looks REFUSED',
            'do not set FR_CUSTOMER_NR from the login; ask the supplier',
          )
        }
      }
    }
  }

  head(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nfr-verify crashed:', err?.message ?? err)
  process.exit(1)
})
