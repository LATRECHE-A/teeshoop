#!/usr/bin/env node
/**
 * PALETTE GUARD: the shop's colours exist in three places and must agree.
 *
 * WHY THREE. `assets/tokens.css` is the one home, and two copies of it are
 * FORCED rather than sloppy:
 *
 *   `includes/Notify.php` writes the hexadecimal out because no mail client
 *   resolves a CSS custom property, and the layout is a table because that is
 *   what Outlook renders.
 *
 *   `includes/BatPage.php` inlines its own `:root` because the proof page is
 *   served from `admin-post.php` with no theme and no enqueue, and a linked
 *   stylesheet would be one more request on a phone for two kilobytes. It also
 *   names its properties differently (`--accent`, not `--ts-accent`), which is
 *   exactly how a divergence hides: nothing greps them together.
 *
 * So the duplication stays and the AGREEMENT is enforced here. A customer who
 * gets an e-mail in one blue, approves a proof in a second and buys on a third
 * is looking at three companies.
 *
 * IT DOES NOT COMPARE FILES, IT COMPARES VALUES. Each source is parsed for the
 * colours it actually declares, keyed by role, and the roles are compared.
 *
 * Exit: 0 clean · 1 a divergence · 2 the scan is not trustworthy.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** The roles every source has to hold, and nothing else is compared. */
const ROLES = ['ink', 'muted', 'line', 'surface', 'paper', 'accent', 'good', 'warn', 'bad']

const SOURCES = [
  {
    file: 'wp-plugins/teeshoop-core/assets/tokens.css',
    what: 'the home',
    // `--ts-ink: #14171a;`
    read: (text, role) => {
      const alias = { muted: 'muted', surface: 'surface', paper: 'paper' }[role] ?? role
      const m = text.match(new RegExp(`--ts-${alias}:\\s*(#[0-9a-fA-F]{3,8})`))
      return m && m[1].toLowerCase()
    },
  },
  {
    file: 'wp-plugins/teeshoop-core/includes/Notify.php',
    what: 'the e-mails',
    // `$ink   = '#14171a';` — five roles only; the others are not used there.
    read: (text, role) => {
      const name = { ink: 'ink', muted: 'soft', line: 'line', surface: 'wash', accent: 'blue' }[role]
      if (!name) return null
      const m = text.match(new RegExp(`\\$${name}\\s*=\\s*'(#[0-9a-fA-F]{3,8})'`))
      return m && m[1].toLowerCase()
    },
  },
  {
    file: 'wp-plugins/teeshoop-core/includes/BatPage.php',
    what: 'the proof page',
    // `--ink:#14171a; --ink-soft:#5b6470; …` in one inline :root
    read: (text, role) => {
      const name = { ink: 'ink', muted: 'ink-soft', line: 'line', surface: 'wash', paper: 'paper', accent: 'accent', good: 'good', warn: 'warn', bad: 'bad' }[role]
      if (!name) return null
      const m = text.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))
      return m && m[1].toLowerCase()
    },
  },
]

/** #fff and #ffffff are the same colour and only one of them is written. */
const norm = (hex) =>
  hex && hex.length === 4 ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex

const texts = SOURCES.map((s) => ({ ...s, text: read(s.file) }))

const problems = []
let compared = 0

for (const role of ROLES) {
  const seen = texts
    .map((s) => ({ file: s.file, what: s.what, value: norm(s.read(s.text, role)) }))
    .filter((s) => s.value)

  // The home must carry every role. A role that vanished from tokens.css is a
  // token somebody deleted while three files still paint with it.
  const home = seen.find((s) => s.file.endsWith('tokens.css'))
  if (!home) {
    problems.push(`${role}: absent de tokens.css, qui est pourtant son unique foyer`)
    continue
  }

  for (const other of seen) {
    if (other === home) continue
    compared++
    if (other.value !== home.value) {
      problems.push(`${role}: ${other.what} (${other.file}) ne dit pas la même chose que tokens.css`)
    }
  }
}

if (compared === 0) {
  console.error('palette-guard: aucune comparaison n’a été faite, ce qui ne prouve rien.')
  process.exit(2)
}

/*
 * --self-test: break the home in memory and require every copy to disagree.
 * A guard that cannot be made to fail is a green tick with nothing behind it.
 */
if (process.argv.includes('--self-test')) {
  const broken = texts.map((s) =>
    s.file.endsWith('tokens.css') ? { ...s, text: s.text.replace('#1f4fd8', '#0f0f0f') } : s,
  )
  const homeBroken = broken.find((s) => s.file.endsWith('tokens.css'))
  const others = broken.filter((s) => !s.file.endsWith('tokens.css'))
  const caught = others.filter((s) => norm(s.read(s.text, 'accent')) !== norm(homeBroken.read(homeBroken.text, 'accent')))
  if (caught.length !== others.length) {
    console.error(`palette-guard --self-test: ${others.length - caught.length} copie(s) n’ont pas vu la divergence.`)
    process.exit(2)
  }
  console.log(`palette-guard --self-test: les ${others.length} copies voient une divergence de l’accent.`)
}

if (problems.length) {
  console.error('palette-guard: la palette diverge.\n')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}

console.log(`palette-guard: ${ROLES.length} rôles, ${compared} comparaisons sur ${texts.length} sources. Clean.`)
