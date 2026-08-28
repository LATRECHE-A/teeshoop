#!/usr/bin/env node
/**
 * The punctuation rule, enforced.
 *
 *   node scripts/style-guard.mjs
 *   node scripts/style-guard.mjs --self-test    proves it can still fail
 *
 * CLAUDE.md section 6: no em-dashes. Use a comma, a colon, a full stop, or
 * parentheses. It applies to every character this project writes, including code
 * comments and commit messages.
 *
 * The rule was written on 2026-08-13, after about 2 300 of them had already been
 * written into roughly 190 files. Session 13 swept them in one deliberate pass,
 * in two commits (the mechanical one and the editorial one), and this is what
 * stops them coming back one feature diff at a time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ALSO REFUSES A SOURCE FILE THAT IS NOT TEXT, and that is not scope creep.
 *
 * This session found TWO committed TypeScript files carrying a raw NUL character
 * inside a string literal, where the escape was meant: src/lib/teeshoop/upload.ts
 * and src/lib/ingest/frCache.ts. Both produced the correct string at run time and
 * both were BINARY to every text tool. `file` reported `data`, `git diff` would
 * have shown "Binary files differ" instead of a reviewable change, and `grep -I`
 * skipped them, which meant the em-dash inventory this guard exists to enforce
 * had silently excluded them.
 *
 * A guard that quietly skips a file is the failure this repository has spent
 * several sessions removing. So a tracked source file that is not valid UTF-8
 * text is an error here, not a skip.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS EXCLUDED, and why each one
 *
 *   docs/bible/    the associate's own text, vendored verbatim. Not ours to edit.
 *   public/        vendored: a supplier's catalogue snapshot and the onnxruntime
 *                  wasm build, both copied in whole.
 *   docs/screens/  screenshots. Binary, and the byte pair that spells U+2014 in
 *                  UTF-8 turns up in PNG data by chance.
 *   node_modules, dist, .qa   not tracked by git, so never reached.
 *
 * Exit: 0 clean, 1 a violation, 2 it scanned nothing or could not run, which is
 * never a pass.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SELF_TEST = process.argv.includes('--self-test')

/** U+2014. Written as an escape so this file passes its own guard. */
const EM_DASH = '—'

const EXCLUDED_PREFIXES = ['docs/bible/', 'public/', 'docs/screens/']

/**
 * WHEN THE CHARACTER IS NOT PUNCTUATION.
 *
 * CLAUDE.md bans the em-dash as a mark of punctuation. It says nothing about the
 * glyph, and the corpus uses it for two other things where no comma, colon or
 * full stop could stand in its place:
 *
 *   AS "NO VALUE" IN A COLUMN. `worst: '—'`, `tierLabel: '—'`, `cost ?? '—'`.
 *   Twenty-odd of these sit in aligned console tables in the verify scripts and
 *   in admin screens where a figure is not known yet. Replacing them with a
 *   comma would print a comma; replacing them with nothing would break the
 *   column. It is a symbol standing for an absent number.
 *
 *   AS A CODEPOINT. `scripts/invoice-verify.mjs` decodes Windows-1252, where
 *   byte 0x97 IS this character. Editing the table would make the decoder wrong.
 *
 * The rule below is a rule and not a list of files, so it keeps working as the
 * code moves: a string literal whose entire content is an em-dash and optional
 * spaces is a placeholder. Anything with a word next to it is prose and is
 * refused. The three places where the character is quoted EVIDENCE, rather than
 * either of those, are named individually with the reason.
 */
const PLACEHOLDER = /(['"`])\s*\u2014\s*\1/
const QUOTED_EVIDENCE = [
  {
    file: 'scripts/invoice-verify.mjs',
    why: 'the Windows-1252 decode table: byte 0x97 IS this character, so the table is data',
  },
  {
    file: 'docs/credits/DTF.md',
    why: 'quotes the accented order name a test fixture actually used; rewriting it would document a test that was never run',
  },
  {
    file: 'wp-plugins/teeshoop-core/includes/Cart.php',
    why: 'quotes verbatim what a broken cart displayed, as the evidence for the fix beneath it',
  },
]

/** Extensions that must be readable text, whatever else is in the tree. */
const TEXT_EXT = [
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.php', '.css', '.html', '.md',
  '.json', '.jsonc', '.yml', '.yaml', '.sh', '.txt', '.svg',
]

/** Things that are legitimately not text and are never scanned. */
const BINARY_EXT = [
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.glb', '.usdz',
  '.woff', '.woff2', '.ttf', '.otf', '.zip', '.gz', '.pdf', '.wasm', '.onnx',
]

const isExcluded = (p) => EXCLUDED_PREFIXES.some((e) => p.startsWith(e))
const hasExt = (p, list) => list.some((e) => p.toLowerCase().endsWith(e))

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer' })
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

function scan(extraFile) {
  const files = tracked()
  if (extraFile) files.push(extraFile)

  const offences = []
  const notText = []
  let scanned = 0
  let skipped = 0

  for (const rel of files) {
    if (isExcluded(rel)) {
      skipped++
      continue
    }
    if (hasExt(rel, BINARY_EXT)) {
      skipped++
      continue
    }
    let buf
    try {
      buf = readFileSync(join(ROOT, rel))
    } catch {
      // A tracked file that is not on disk is somebody else's problem (a bad
      // checkout), not a punctuation violation.
      skipped++
      continue
    }

    /*
     * IS IT TEXT AT ALL. A NUL byte or invalid UTF-8 means every text tool,
     * including this one, would silently read nothing. For a file whose
     * extension says it is source, that is an error; for anything else it is a
     * skip that gets counted.
     */
    const looksBinary = buf.includes(0) || Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) !== 0
    if (looksBinary) {
      if (hasExt(rel, TEXT_EXT)) notText.push(rel)
      else skipped++
      continue
    }

    scanned++
    const text = buf.toString('utf8')
    if (!text.includes(EM_DASH)) continue
    const evidence = QUOTED_EVIDENCE.find((e) => e.file === rel)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(EM_DASH)) continue
      if (evidence) continue
      /*
       * A line may hold a placeholder AND prose. Strip every placeholder literal
       * first, then look again: that way `worst: '—', label: 'a — b'` is still
       * caught on its second half.
       */
      let rest = lines[i]
      while (PLACEHOLDER.test(rest)) rest = rest.replace(PLACEHOLDER, '""')
      if (!rest.includes(EM_DASH)) continue
      offences.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 110) })
    }
  }
  return { offences, notText, scanned, skipped }
}

function report({ offences, notText, scanned, skipped }) {
  if (notText.length) {
    console.error('\nSTYLE GUARD FAILED: a tracked source file is not readable as text.\n')
    for (const f of notText) console.error(`  ${f}`)
    console.error(
      '\nA NUL byte or a broken encoding makes the file BINARY to every text tool:\n' +
        'git shows "Binary files differ" instead of a diff, grep skips it, and this\n' +
        'guard would have skipped it too. If a NUL is genuinely wanted in a string,\n' +
        'write the escape (\\x00) rather than the character.\n',
    )
  }
  if (offences.length) {
    console.error(`\nSTYLE GUARD FAILED: ${offences.length} em-dash(es) in ${new Set(offences.map((o) => o.file)).size} file(s).\n`)
    for (const o of offences.slice(0, 40)) console.error(`  ${o.file}:${o.line}  ${o.text}`)
    if (offences.length > 40) console.error(`  … and ${offences.length - 40} more`)
    console.error(
      '\nCLAUDE.md section 6: no em-dashes. A comma for an appositive, a colon before\n' +
        'an expansion, a full stop between two independent clauses, or parentheses.\n' +
        'Replace by MEANING: a blind substitution produces comma splices, which is\n' +
        'worse writing than the dash was.\n',
    )
  }
}

// ---------------------------------------------------------------------------

if (SELF_TEST) {
  /*
   * BREAK IT ON PURPOSE. A guard nobody has seen fail is a guard nobody knows
   * works. The temporary file is written OUTSIDE git's index and handed to the
   * scanner directly, so a self-test can never leave a violation behind if it
   * crashes: the file is removed in a finally.
   */
  const probe = join(ROOT, '.style-guard-self-test.md')
  const rel = '.style-guard-self-test.md'
  let sawDash = false
  let sawBinary = false
  try {
    writeFileSync(probe, `Une phrase ${EM_DASH} avec un tiret cadratin.\n`)
    sawDash = scan(rel).offences.some((o) => o.file === rel)

    writeFileSync(probe, Buffer.from([0x61, 0x00, 0x62, 0x0a]))
    sawBinary = scan(rel).notText.includes(rel)
  } finally {
    try {
      unlinkSync(probe)
    } catch {
      /* already gone */
    }
  }

  const both = sawDash && sawBinary
  console.log(`style-guard --self-test: em-dash detected ${sawDash}, non-text source detected ${sawBinary}.`)
  if (!both) {
    console.error('style-guard: the self-test did not fire, so a green run means nothing.')
    process.exit(1)
  }
  console.log('style-guard --self-test: both checks fired.')
  process.exit(0)
}

const result = scan()

/*
 * NOTHING SCANNED IS NOT A PASS. If `git ls-files` returns nothing (run outside
 * a checkout, or from the wrong directory) this would otherwise print a clean
 * line over an empty set.
 */
if (result.scanned < 100) {
  console.error(
    `\nSTYLE GUARD SELF-TEST FAILED: only ${result.scanned} file(s) were read.\n` +
      'That is not this repository. A pass here would mean nothing.\n',
  )
  process.exit(2)
}

report(result)
if (result.offences.length || result.notText.length) process.exit(1)

console.log(
  `style-guard: ${result.scanned} text files scanned, ${result.skipped} skipped as binary or vendored, ` +
    `0 em-dashes, 0 unreadable source files.`,
)
