#!/usr/bin/env node
/**
 * Write the two files the shop reads about garments, from the studio's own
 * definitions.
 *
 *   wp-plugins/teeshoop-core/data/garments.json     what it measures, in cm
 *   wp-plugins/teeshoop-core/data/garment-art.json  what it looks like, as SVG
 *
 *   node scripts/gen-garment-data.mjs        # rewrite both files
 *   node scripts/gen-garment-data.mjs --check # exit 1 if either is stale
 *
 * TWO FILES BECAUSE THEY ARE READ BY DIFFERENT PAGES AT DIFFERENT COSTS. Every
 * product page asks the first one for a print size; one page asks the second
 * one for 48 kB of path data. Folding the drawings into `garments.json` would
 * charge the whole shop for the homepage.
 *
 * The plugin cannot import TypeScript and must not retype print sizes (see the
 * header of src/content/garmentData.ts). So the numbers are derived here, from
 * the shipped modules, by actually calling them.
 *
 * esbuild rather than a hand-rolled parser: it is already a vite dependency,
 * it understands the `@/` alias, and bundling means the derivation runs the
 * real `printScaleK` instead of a regex's opinion of it.
 */
import { build } from 'esbuild'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'wp-plugins/teeshoop-core/data/garments.json')
const OUT_ART = join(ROOT, 'wp-plugins/teeshoop-core/data/garment-art.json')
const CHECK = process.argv.includes('--check')

/** Bundle the pure derivation to one ESM file and import it. */
async function load() {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-garment-'))
  const file = join(dir, 'garmentData.mjs')
  try {
    await build({
      entryPoints: [join(ROOT, 'src/content/garmentData.ts')],
      outfile: file,
      bundle: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'warning',
      alias: { '@': join(ROOT, 'src') },
    })
    return await import(pathToFileURL(file).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const { buildGarmentData, buildGarmentArt } = await load()
const data = buildGarmentData()
const art = buildGarmentArt()

if (!data || !data.garments || Object.keys(data.garments).length === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('gen-garment-data: the derivation produced no garments. Refusing to write.')
  process.exit(2)
}

/*
 * THE DRAWINGS ARE CHECKED, NOT ASSUMED.
 *
 * An illustration that lost its `__COLOR__` token still renders: it renders a
 * garment permanently in whatever fill was hard-coded, and the homepage's
 * colour switcher becomes a row of controls that change nothing. That is the
 * failure this refuses, because it is the one that looks like it works.
 */
for (const [id, g] of Object.entries(art.garments ?? {})) {
  for (const side of g.sides ?? []) {
    if (!side.body.includes('__COLOR__')) {
      console.error(
        `gen-garment-data: ${id}/${side.side} carries no __COLOR__ token, so it could not be tinted. Refusing to write.`,
      )
      process.exit(2)
    }
    const a = side.printAreaPx
    if (!a || a.w <= 0 || a.h <= 0) {
      console.error(`gen-garment-data: ${id}/${side.side} has no print rectangle. Refusing to write.`)
      process.exit(2)
    }
  }
}
if (Object.keys(art.garments ?? {}).length === 0) {
  console.error('gen-garment-data: the derivation produced no drawings. Refusing to write.')
  process.exit(2)
}

const json = JSON.stringify(data, null, '\t') + '\n'
const jsonArt = JSON.stringify(art, null, '\t') + '\n'

/** Both files are compared before either verdict is printed, so one run names both. */
const WANTED = [
  { path: OUT, body: json, what: 'the studio’s print areas, size chart or colours' },
  { path: OUT_ART, body: jsonArt, what: 'the studio’s garment illustrations' },
]

if (CHECK) {
  const stale = []
  for (const { path, body, what } of WANTED) {
    let current = null
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      stale.push(`${path.replace(ROOT + '/', '')} is missing`)
      continue
    }
    if (current !== body) stale.push(`${path.replace(ROOT + '/', '')} is stale (${what} changed and the shop was not told)`)
  }
  if (stale.length > 0) {
    console.error('gen-garment-data:\n  ' + stale.join('\n  ') + '\nRun: node scripts/gen-garment-data.mjs')
    process.exit(1)
  }
  console.log(
    `gen-garment-data: up to date (${Object.keys(data.garments).length} garments, ${data.colors.length} colours, ` +
      `${Object.values(art.garments).reduce((n, g) => n + g.sides.length, 0)} drawings)`,
  )
  process.exit(0)
}

for (const { path, body } of WANTED) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}
console.log(
  `gen-garment-data: wrote ${OUT} (${Object.keys(data.garments).length} garments, ${data.colors.length} colours) ` +
    `and ${OUT_ART} (${Object.values(art.garments).reduce((n, g) => n + g.sides.length, 0)} drawings)`,
)
