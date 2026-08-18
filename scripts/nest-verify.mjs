#!/usr/bin/env node
/**
 * NEST VERIFY: the film metrage the shop costs on is the one the packer gives.
 *
 * The cost engine in `wp-plugins/teeshoop-core/` never packs anything. It asks
 * `POST /api/nest`, which runs `src/lib/dtf/nesting.ts`, the same packer the
 * workshop's gang sheets come out of. That indirection is the whole point (one
 * packer, not two), and it is only worth anything if the route really works, is
 * really closed to anyone without the token, and really refuses geometry it
 * cannot pack.
 *
 * WHAT IT PROVES, four things, against a REAL `wrangler dev` and a REAL php:
 *
 *   1. THE GATE. No credentials → 401. Wrong token → 401. Right token → 200.
 *      Checked first, because a route that answers everybody makes the other
 *      three checks meaningless.
 *   2. THE ANSWER. The length the route returns is the length `nestRoll`
 *      returns for the same pieces, called directly in this process. If those
 *      two ever differ, the shop is costing on something other than what the
 *      workshop will print.
 *   3. THE BOUND. `Cost::prudent_length_cm` in PHP is the fallback used when the
 *      Worker cannot be reached, and it is only safe if it is genuinely an
 *      UPPER bound on what the packer would have done. Every corpus order is
 *      run through both, in their own languages, and the bound must never come
 *      out under the real packing. A bound that is too low is a floor price that
 *      is too low, which authorises a sale.
 *   4. THE REFUSALS. Bad JSON, no pieces, a piece bigger than the roll can ever
 *      take, and a quantity past the instance cap each get their own status.
 *
 * A test that re-implements what it checks proves only self-consistency, so
 * nothing here re-implements a packing or a bound: check 2 imports the shipped
 * module and check 3 shells out to the shipped PHP.
 *
 * Exit: 0 clean · 1 a check failed · 2 the run is not trustworthy (wrangler or
 *       php unavailable, no token, or nothing was checked).
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.TSHOP_NEST_PORT ?? 8791)
const BASE = `http://127.0.0.1:${PORT}`

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

let checks = 0
let failures = 0

function ok(name) {
  checks++
  console.log(`  ${GREEN}✓${OFF} ${name}`)
}

function bad(name, detail) {
  checks++
  failures++
  console.log(`  ${RED}✗${OFF} ${name}\n      ${detail}`)
}

function is(name, actual, expected) {
  if (actual === expected) ok(name)
  else bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// The token, from the same file `wrangler dev` reads.

function devToken() {
  const path = join(ROOT, '.dev.vars')
  if (!existsSync(path)) return ''
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*ADMIN_TOKEN\s*=\s*(.+?)\s*$/.exec(line)
    if (m) return m[1].replace(/^['"]|['"]$/g, '')
  }
  return ''
}

const TOKEN = devToken()
if (TOKEN.length < 24) {
  console.error('nest-verify: no usable ADMIN_TOKEN in .dev.vars. The gate cannot be tested, and a pass would mean nothing.')
  process.exit(2)
}

// ─────────────────────────────────────────────────────────────────────────────
// The corpus: real transfer shapes at real garment sizes, plus the awkward ones.

const CORPUS = [
  {
    name: 'un logo cœur sur trente pièces',
    pieces: [{ id: 'a', w_cm: 9.5, h_cm: 7.2, qty: 30 }],
  },
  {
    name: 'devant et dos, deux tailles',
    pieces: [
      { id: 'f-m', w_cm: 28.4, h_cm: 34.1, qty: 18 },
      { id: 'b-m', w_cm: 24.0, h_cm: 8.5, qty: 18 },
      { id: 'f-xl', w_cm: 32.6, h_cm: 39.2, qty: 12 },
      { id: 'b-xl', w_cm: 27.6, h_cm: 9.8, qty: 12 },
    ],
  },
  {
    name: 'un visuel plus large que la laize',
    pieces: [{ id: 'wide', w_cm: 62.0, h_cm: 18.0, qty: 4 }],
  },
  {
    name: 'beaucoup de très petits transferts',
    pieces: Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`,
      w_cm: 3 + i * 0.4,
      h_cm: 2.5 + (i % 5) * 0.6,
      qty: 25,
    })),
  },
  {
    name: 'une seule pièce, sous le mètre minimum',
    pieces: [{ id: 'one', w_cm: 12.0, h_cm: 9.0, qty: 1 }],
  },
  {
    /*
     * SEVERAL SHEETS, which nothing else in this corpus produced. The shop
     * ships a 100 cm print-file limit (the smallest any surveyed roll supplier
     * publishes), so an ordinary order already spans a dozen files, each
     * rounded up to its own billing step. Until this row existed, the
     * multi-sheet term of the PHP bound was never once exercised by the check
     * that exists to prove that bound.
     */
    name: 'une série qui déborde de la longueur de fichier',
    pieces: [
      { id: 'front', w_cm: 28.4, h_cm: 34.1, qty: 40 },
      { id: 'back', w_cm: 24.0, h_cm: 8.5, qty: 40 },
    ],
  },
]

const OPTIONS = { width_cm: 56, gap_cm: 0.5, max_length_cm: 100, billing_step_cm: 10 }

// ─────────────────────────────────────────────────────────────────────────────
// Boot wrangler dev.

async function waitFor(url, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (res.status > 0) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 350))
  }
  return false
}

const worker = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--log-level', 'error'],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
)
let workerErr = ''
worker.stderr.on('data', (d) => {
  workerErr += d.toString()
})

const stop = () => {
  try {
    worker.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

if (!(await waitFor(`${BASE}/api/nest`, 60_000))) {
  stop()
  console.error(`nest-verify: wrangler dev never answered on ${BASE}.\n${workerErr.slice(0, 800)}`)
  process.exit(2)
}

const post = (body, token = TOKEN) =>
  fetch(`${BASE}/api/nest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

// ─────────────────────────────────────────────────────────────────────────────
// 1. The gate.

console.log(`${DIM}the gate${OFF}`)
{
  const anon = await post({ pieces: CORPUS[0].pieces, ...OPTIONS }, '')
  is('refuses a request with no credentials', anon.status, 401)

  const wrong = await post({ pieces: CORPUS[0].pieces, ...OPTIONS }, 'x'.repeat(40))
  is('refuses a wrong token', wrong.status, 401)

  const good = await post({ pieces: CORPUS[0].pieces, ...OPTIONS })
  is('accepts the real one', good.status, 200)
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The route answers what the packer answers.

console.log(`${DIM}the answer${OFF}`)
const { nestRoll } = await import(new URL('../src/lib/dtf/nesting.ts', import.meta.url).href).catch(
  async () => {
    // TypeScript is not importable directly; bundle it the way the hypotheses
    // guard does. Failing to load it is a broken run, not a failed check.
    const { build } = await import('esbuild')
    const dir = mkdtempSync(join(tmpdir(), 'nest-verify-'))
    const out = join(dir, 'nesting.mjs')
    await build({
      entryPoints: [join(ROOT, 'src/lib/dtf/nesting.ts')],
      outfile: out,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      alias: { '@': join(ROOT, 'src') },
    })
    const mod = await import(`file://${out}`)
    rmSync(dir, { recursive: true, force: true })
    return mod
  },
)

const direct = (pieces) =>
  nestRoll(
    pieces.map((p) => ({ id: p.id, sourceKey: p.id, wCm: p.w_cm, hCm: p.h_cm, qty: p.qty, allowRotate: true })),
    {
      printableWidthCm: OPTIONS.width_cm,
      gapCm: OPTIONS.gap_cm,
      maxLengthCm: OPTIONS.max_length_cm,
      edgeMarginCm: 0,
      billingStepCm: OPTIONS.billing_step_cm,
    },
  )

const routed = []
for (const order of CORPUS) {
  const res = await post({ pieces: order.pieces, ...OPTIONS })
  const body = await res.json()
  const here = direct(order.pieces)

  if (res.status !== 200) {
    bad(`${order.name}: the route answered`, `status ${res.status}: ${JSON.stringify(body)}`)
    continue
  }
  if (Math.abs(body.billed_m - here.totalLengthM) > 1e-9) {
    bad(
      `${order.name}: the route and the packer agree`,
      `route ${body.billed_m} m, packer ${here.totalLengthM} m`,
    )
    continue
  }
  ok(
    `${order.name}: ${body.billed_m} m, ${body.total_pieces} transferts, ${body.sheets} feuille(s), ${(body.utilization * 100).toFixed(0)} % de remplissage`,
  )
  routed.push({ order, billed_m: body.billed_m, sheets: body.sheets })
}

if (routed.length !== CORPUS.length) {
  bad('every corpus order was packed', `${routed.length} of ${CORPUS.length}`)
}

/*
 * A corpus that never splits a sheet cannot prove the part of the bound that
 * deals with splitting, and "nothing found" is not "nothing looked".
 */
if (routed.some((r) => r.sheets > 1)) ok('at least one order really spans several sheets')
else bad('at least one order really spans several sheets', 'the multi-sheet term of the bound was never exercised')

// ─────────────────────────────────────────────────────────────────────────────
// 3. The PHP bound is really above the real packing.

console.log(`${DIM}the prudent bound${OFF}`)
{
  const slack = []
  const dir = mkdtempSync(join(tmpdir(), 'nest-verify-php-'))
  const driver = join(dir, 'bound.php')
  const input = join(dir, 'orders.json')
  writeFileSync(
    driver,
    `<?php
declare(strict_types=1);
define('TEESHOOP_TEST', 1);
require_once $argv[1] . '/Cost.php';
$config = \\Teeshoop\\Core\\Cost::merge_config(['film' => array_merge(
    \\Teeshoop\\Core\\Cost::default_config()['film'],
    ['width_cm' => ${OPTIONS.width_cm}, 'gap_cm' => ${OPTIONS.gap_cm}]
)]);
$out = [];
foreach (json_decode(file_get_contents($argv[2]), true) as $key => $pieces) {
    $b = \\Teeshoop\\Core\\Cost::prudent_length_cm($pieces, $config);
    $out[$key] = $b['ok'] ? $b['length_cm'] / 100 : -1.0;
}
echo json_encode($out);
`,
  )
  writeFileSync(input, JSON.stringify(Object.fromEntries(CORPUS.map((o, i) => [i, o.pieces]))))

  let bounds
  try {
    bounds = JSON.parse(
      execFileSync('php', [driver, join(ROOT, 'wp-plugins/teeshoop-core/includes'), input], {
        encoding: 'utf8',
      }),
    )
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    stop()
    console.error(`nest-verify: php could not run the bound: ${String(e.message).split('\n')[0]}`)
    process.exit(2)
  }
  rmSync(dir, { recursive: true, force: true })

  for (const [i, order] of CORPUS.entries()) {
    const bound = bounds[i]
    const real = direct(order.pieces).totalLengthM
    if (bound < 0) {
      bad(`${order.name}: the bound is computable`, 'php refused to bound geometry the packer accepted')
      continue
    }
    if (!(bound >= real - 1e-9)) {
      bad(`${order.name}: the bound is above the packing`, `bound ${bound.toFixed(2)} m < packed ${real.toFixed(2)} m`)
      continue
    }
    const over = real > 0 ? ((bound / real - 1) * 100).toFixed(0) : '0'
    const steps = Math.round(((bound - real) * 100) / OPTIONS.billing_step_cm)
    slack.push(steps)
    ok(
      `${order.name}: borne ${bound.toFixed(2)} m contre ${real.toFixed(2)} m imbriqués (+${over} %, ${steps} pas de facturation de marge)`,
    )
  }

  /*
   * WHAT THIS CORPUS DOES NOT PROVE, said out loud rather than left to be
   * assumed. The bound adds one billing step per sheet past the first, because
   * Σ⌈xₛ⌉ ≤ ⌈Σxₛ⌉ + (N−1) and each sheet is rounded up on its own. That term is
   * a necessity of the inequality, and on every order here the rest of the
   * bound is loose enough that removing it would still pass. So this run does
   * not exercise it, and a reader should not read a green tick as if it did.
   */
  const sheets = routed.map((r) => r.sheets)
  const tight = slack.some((steps, i) => steps < sheets[i] - 1)
  console.log(
    tight
      ? `  ${DIM}the per-sheet rounding term is load-bearing on at least one order here${OFF}`
      : `  ${DIM}note: no order here comes within its own multi-sheet allowance, so the (N−1) rounding term of the bound is NOT exercised by this corpus. It is kept because Σ⌈xₛ⌉ ≤ ⌈Σxₛ⌉ + (N−1) needs it, not because this run proves it.${OFF}`,
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. What it refuses.

console.log(`${DIM}what it refuses${OFF}`)
{
  is('bad JSON', (await post('{nope')).status, 400)
  is('no pieces at all', (await post({ pieces: [], ...OPTIONS })).status, 422)
  is('pieces that are not an array', (await post({ pieces: 3, ...OPTIONS })).status, 422)
  is('a piece with no id', (await post({ pieces: [{ w_cm: 5, h_cm: 5, qty: 1 }], ...OPTIONS })).status, 422)
  is(
    'a transfer larger than any roll',
    (await post({ pieces: [{ id: 'x', w_cm: 400, h_cm: 400, qty: 1 }], ...OPTIONS })).status,
    422,
  )
  is(
    'a quantity past the instance cap',
    (await post({ pieces: [{ id: 'x', w_cm: 5, h_cm: 5, qty: 999_999 }], ...OPTIONS })).status,
    422,
  )

  // A piece that fits on no roll must be REPORTED, not silently dropped: the
  // shop refuses to state a film cost when this list is not empty.
  const tall = await post({
    pieces: [
      { id: 'ok', w_cm: 10, h_cm: 10, qty: 1 },
      { id: 'endless', w_cm: 40, h_cm: 199, qty: 1 },
    ],
    ...OPTIONS,
    max_length_cm: 100,
  })
  const tallBody = await tall.json()
  if (tall.status === 200 && Array.isArray(tallBody.unplaceable) && tallBody.unplaceable.includes('endless')) {
    ok('names a transfer no roll can take instead of dropping it')
  } else {
    bad('names a transfer no roll can take', JSON.stringify(tallBody))
  }
}

// ─────────────────────────────────────────────────────────────────────────────

stop()

if (checks === 0) {
  console.error('\nnest-verify: nothing was checked at all. A pass here would mean nothing.')
  process.exit(2)
}
if (failures > 0) {
  console.error(`\n${RED}nest-verify: ${failures} failed${OFF} of ${checks} checks.`)
  process.exit(1)
}
console.log(`\n${GREEN}nest-verify: ${checks} checks, all green.${OFF}`)
process.exit(0)
