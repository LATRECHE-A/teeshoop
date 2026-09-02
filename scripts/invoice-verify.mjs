#!/usr/bin/env node
/**
 * INVOICE VERIFY: renders real invoices through the plugin, then reads them back
 * with something that shares no code with the plugin.
 *
 * WHY IT IS NOT A PHP TEST. The invoice is a hand-rolled PDF, and a hand-rolled
 * format checked by its own writer proves only self-consistency: the same wrong
 * offset table produces the same wrong answer twice and both agree. So the
 * bytes are produced by `wp eval-file` against a real WooCommerce, and read here
 * by a Node reader that knows nothing about `Pdf.php`, plus poppler's
 * `pdftotext` when the machine has it, which knows nothing about either.
 *
 * WHAT IT ASSERTS is what the law asks for and what a customer would notice:
 *   the number, the seller, the buyer and the amounts are ON the page;
 *   a franchise invoice carries "TVA non applicable, article 293 B du CGI" and
 *     no rate, no VAT amount and no separate TTC total, because showing VAT
 *     under the franchise makes the issuer liable for it;
 *   a taxable invoice carries the rate, the VAT line and the mandatory
 *     professional mentions;
 *   an incomplete legal identity is stamped on staging and refused outright in
 *     production.
 *
 * Exit: 0 all green · 1 a document is wrong · 2 the check is not trustworthy
 *       (nothing produced, nothing read, or a scenario missing).
 */
import { execFileSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'

const COMPOSE = ['compose', '-f', 'wp-local/docker-compose.yml', 'run', '--rm', 'wpcli']
const PROBE = 'wp-content/plugins/teeshoop-core/tests/invoice-probe.php'
const MARKER = '===TEESHOOP-INVOICE-JSON==='

/** Windows-1252's own band, back to Unicode. The inverse of Pdf::to_win1252. */
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
}

/**
 * Every string a PDF actually draws, in order.
 *
 * Written from the specification rather than from `Pdf.php`: find the content
 * streams, inflate them, take what a `Tj` operator is handed. It does not
 * understand PDF in general and does not need to; it understands the part a
 * reader would draw.
 */
/**
 * Every string a PDF draws, with the baseline it draws it at, in POINTS from
 * the bottom of the page. Written from the specification, like `textOf`.
 */
function placedTextOf(bytes) {
  const out = []
  let at = 0
  for (;;) {
    const start = bytes.indexOf('stream\n', at)
    if (start === -1) break
    const end = bytes.indexOf('\nendstream', start)
    if (end === -1) break
    at = end + 10
    let body
    try {
      body = inflateSync(bytes.subarray(start + 7, end))
    } catch {
      continue
    }
    const src = body.toString('latin1')
    const re = /(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s*\(((?:\\.|[^\\()])*)\)\s*Tj/g
    for (const m of src.matchAll(re)) {
      out.push({ x: Number(m[1]), y: Number(m[2]), text: m[3] })
    }
  }
  return out
}

function textOf(bytes) {
  const out = []
  let at = 0
  for (;;) {
    const start = bytes.indexOf('stream\n', at)
    if (start === -1) break
    const end = bytes.indexOf('\nendstream', start)
    if (end === -1) break
    const raw = bytes.subarray(start + 7, end)
    at = end + 10

    let body
    try {
      body = inflateSync(raw)
    } catch {
      // Not a deflate stream: a reader would skip it, and so do we.
      continue
    }

    // (…) Tj, with PDF's own escapes.
    const src = body.toString('latin1')
    const re = /\(((?:\\.|[^\\()])*)\)\s*Tj/g
    for (const m of src.matchAll(re)) {
      const unescaped = m[1].replace(/\\([\\()nrtbf])/g, (_, c) =>
        ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[c] ?? c,
      )
      out.push(
        [...unescaped]
          .map((ch) => {
            const code = ch.charCodeAt(0)
            return CP1252[code] ?? ch
          })
          .join(''),
      )
    }
  }
  return out
}

const die = (code, ...lines) => {
  for (const line of lines) console.error(line)
  process.exit(code)
}

// ─── produce ─────────────────────────────────────────────────────────────────

let stdout
try {
  stdout = execFileSync('docker', [...COMPOSE, 'eval-file', PROBE], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (e) {
  die(2, `invoice-verify: the mirror could not produce an invoice.\n${e.stderr || e.message}`)
}

const at = stdout.indexOf(MARKER)
if (at === -1) die(2, 'invoice-verify: the probe printed no result. Is the mirror up (npm run wp:up)?')

let data
try {
  data = JSON.parse(stdout.slice(at + MARKER.length).trim())
} catch (e) {
  die(2, `invoice-verify: the probe's output is not JSON: ${e.message}`)
}

for (const key of ['standard', 'franchise', 'stamped', 'long', 'refused', 'mentions']) {
  if (!(key in data)) die(2, `invoice-verify: the probe produced no "${key}" scenario.`)
}

// ─── read ────────────────────────────────────────────────────────────────────

const fails = []
let checks = 0
let charged = 0

const scenario = (name) => {
  const s = data[name]
  if (s.error) {
    fails.push(`${name}: the plugin refused to compose it (${s.error})`)
    return null
  }
  const bytes = Buffer.from(s.pdf, 'base64')
  return { doc: s.doc, bytes, text: textOf(bytes).join(' ') }
}

const must = (name, condition, why) => {
  checks++
  if (!condition) fails.push(`${name}: ${why}`)
}

const mustNot = (name, condition, why) => must(name, !condition, why)

for (const name of ['standard', 'franchise', 'stamped', 'long']) {
  const s = scenario(name)
  if (!s) continue

  /*
   * NOTHING IS DRAWN OFF THE SHEET, and the `long` scenario is here because of
   * it: the mandatory late-payment and recovery-indemnity mentions used to be
   * drawn at 299 mm on a 297 mm page once an order carried a dozen lines, so
   * the tail of a clause article L. 441-9 makes mandatory was simply gone. A
   * page-height check costs nothing and would have caught it on the first run.
   */
  const A4 = 841.89
  const placed = placedTextOf(s.bytes)
  must(name, placed.length > 5, 'the reader found almost no positioned text')
  const off = placed.filter((p) => p.y < 6 || p.y > A4 - 6)
  must(
    name,
    off.length === 0,
    `${off.length} line(s) drawn off the sheet, lowest at ${Math.min(...placed.map((p) => p.y)).toFixed(1)} pt`,
  )

  must(name, s.bytes.subarray(0, 5).toString() === '%PDF-', 'is not a PDF at all')
  must(name, s.text.length > 200, 'the reader found almost no text, so nothing below means anything')

  must(name, s.text.includes(s.doc.number), 'the invoice number is not on the page')
  // Only when there IS one: the stamped scenario has an empty identity on
  // purpose, and demanding a name that does not exist would be asking the
  // document to invent one, which is the whole thing this refuses to do.
  if (s.doc.seller.raison_sociale) {
    must(name, s.text.includes(s.doc.seller.raison_sociale), 'the seller is not on the page')
    must(name, s.text.includes('SIRET'), 'the SIRET is not on the page')
    must(name, /RCS\s+\w/.test(s.text), 'the RCS mention is not on the page')
  } else {
    must(name, s.doc.missing.length > 0, 'a document with no seller does not say what is missing')
  }
  must(name, s.text.includes(s.doc.buyer.company), 'the buyer is not on the page')
  /*
   * WHAT THE PAGE SAYS IT IS, AND WHAT IT SAYS IT IS NOT.
   *
   * Question 24, applied 2 September 2026: the legal invoice stays in the
   * associate's accounting system and this document stops being one. Read back
   * here rather than asserted in PHP for the same reason as everything else in
   * this file: the plugin renaming its own title and then checking its own
   * rename proves nothing about the page a customer opens.
   *
   * All three are needed. The title alone would still pass if the mentions
   * block went on calling the document a facture; the sentence alone would pass
   * on a page headed FACTURE; and the refusal of the standalone word is what
   * catches a half-done rename, which is what the first attempt at this change
   * actually was.
   */
  must(name, s.text.includes('RÉCAPITULATIF'), 'the page does not say what it is')
  must(name, /DE COMMANDE|D’ACOMPTE/.test(s.text), 'the page does not say which kind of récapitulatif it is')
  must(
    name,
    /la facture est établie séparément par notre service comptable|la facture d’acompte est établie séparément par notre service comptable/.test(s.text),
    'the page does not say where the facture is issued, so a customer could file this as one',
  )
  mustNot(
    name,
    /\bFACTURE\b/.test(s.text),
    'the page still presents itself as a facture, which question 24 forbids',
  )
  must(
    name,
    /^(TS|ESSAI)\d{4}-\d{4,}$/.test(s.doc.number),
    `the reference ${s.doc.number} is not a commercial one: FA reads as facture and is the collision question 24 asks us to avoid`,
  )

  /*
   * Amounts, as a French document writes them, compared with every kind of
   * space treated alike. `Money::format` groups thousands with a NARROW
   * no-break space and this helper wrote a plain one, so every assertion about
   * a four-figure amount looked for a string that is not on the page. Below
   * 1 000 EUR the two are identical and nothing showed it, which is why the
   * twelve-line scenario found it and three one-line scenarios did not.
   */
  const flat = (t) => String(t).replace(/[\u00a0\u202f\u2009\s]+/g, ' ')
  const eur = (cents) =>
    (cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  must(
    name,
    flat(s.text).includes(flat(eur(s.doc.total_ttc))),
    `the total ${eur(s.doc.total_ttc)} is not on the page`,
  )
  must(name, s.doc.total_ht + s.doc.total_vat === s.doc.total_ttc, 'the document does not add up')

  /*
   * The carriage is a line of the table, not a footnote, and it is only there
   * when the customer pays for it: the twelve-line scenario passes the franco
   * on purpose, so the free branch is rendered too. What must never happen is
   * that NO scenario charges one, which is checked once at the end.
   */
  if (s.doc.shipping_ht > 0) {
    must(name, /Livraison/.test(s.text), 'the delivery is not on the page')
    charged++
  }
  const goods = s.doc.lines.reduce((n, l) => n + l.total_ht, 0)
  must(
    name,
    goods + s.doc.shipping_ht - s.doc.discount_ht + s.doc.fees_ht === s.doc.total_ht,
    'the lines plus the delivery do not make the HT total',
  )

  // Mandatory professional mentions (code de commerce L. 441-9).
  must(name, /Escompte/i.test(s.text), 'no escompte clause')
  must(name, /P.nalit.s de retard/i.test(s.text), 'no late-payment clause')
  must(name, /40,00/.test(s.text), 'no recovery indemnity')
  must(name, /livraisons de biens/i.test(s.text), 'the nature of the operations is not stated')

  if (name === 'franchise') {
    must(name, s.text.includes(data.mentions.franchise), 'the article 293 B mention is missing')
    must(name, s.doc.total_vat === 0, 'a franchise invoice carries VAT')
    // BOFiP BOI-TVA-DECLA-30-20-20-10 § 460: showing VAT under the franchise
    // makes the issuer liable for it by the sole fact of having invoiced it.
    mustNot(name, /Total TTC/i.test(s.text), 'a franchise invoice separates HT from TTC')
    mustNot(name, /\bTVA\s+\d/.test(s.text), 'a rate is printed on a franchise invoice')
    mustNot(name, /\b20\s*%/.test(s.text), 'a 20 % appears on a franchise invoice')
  } else {
    must(name, /Total HT/i.test(s.text), 'no HT total')
    must(name, /Total TTC/i.test(s.text), 'no TTC total')
    must(name, /TVA\s*20\s*%/.test(s.text), 'the rate is not printed')
    mustNot(name, s.text.includes(data.mentions.franchise), 'the 293 B mention is on a taxable invoice')
  }

  if (name === 'stamped') {
    must(name, s.text.includes(data.mentions.stamp), 'a non-conforming document is not marked as one')
    must(name, /Document incomplet/i.test(s.text), 'and does not say so in words')
  } else {
    mustNot(name, s.text.includes(data.mentions.stamp), 'a conforming document is stamped')
  }
}

// A run in which every scenario happened to pass the franco would never render
// a charged delivery, and that half of the table would go unchecked for ever.
checks++
if (charged === 0) {
  fails.push('no scenario charged for a delivery, so the priced carriage line was never rendered')
}

// The one that must produce nothing at all.
checks++
if (!data.refused.error) {
  fails.push('refused: production issued an invoice with no seller identity on it')
} else if (!data.refused.error.startsWith('teeshoop_no_identity')) {
  fails.push(`refused: production refused for the wrong reason (${data.refused.error})`)
}

// ─── a second opinion, when the machine has one ──────────────────────────────

let poppler = 'not installed'
let hasPoppler = false
try {
  execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
  hasPoppler = true
} catch {
  // Genuinely absent. Reported below, never counted as agreement.
}

/*
 * A POPPLER THAT CRASHED ON OUR FILE IS NOT A POPPLER THAT IS NOT INSTALLED.
 * One `try` around both used to swallow the difference, so a PDF this reader
 * choked on came out of the run looking exactly like a machine without the
 * tool, and the script still exited 0. Same rule as everywhere else here:
 * "nothing found" and "nothing looked" are different results.
 */
if (hasPoppler) {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-invoice-'))
  try {
    let agreed = 0
    for (const name of ['standard', 'franchise', 'stamped', 'long']) {
      if (data[name].error) continue
      const file = join(dir, `${name}.pdf`)
      writeFileSync(file, Buffer.from(data[name].pdf, 'base64'))
      const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
      checks++
      if (!text.includes(data[name].doc.number)) {
        fails.push(`${name}: poppler cannot find the invoice number, so a real reader would not either`)
      } else {
        agreed++
      }
      if (name === 'franchise' && !text.includes(data.mentions.franchise)) {
        fails.push('franchise: poppler cannot find the article 293 B mention')
      }
    }
    poppler = `${agreed} document(s) agreed`
  } catch (e) {
    checks++
    fails.push(`poppler: it is installed and it failed on our PDF (${String(e.message).split('\n')[0]})`)
    poppler = 'installed, and it failed'
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─── report ──────────────────────────────────────────────────────────────────

if (checks === 0) {
  die(2, 'invoice-verify: checked nothing at all. A pass here would mean nothing.')
}

if (fails.length > 0) {
  console.error(`invoice-verify: ${fails.length} problem(s) with the documents this shop would send.`)
  for (const f of fails) console.error(`  ${f}`)
  process.exit(1)
}

console.log(
  `invoice-verify: ${checks} checks on 4 rendered invoices plus one refusal, read back independently. Clean.`,
)
console.log(`  poppler second opinion: ${poppler}`)
