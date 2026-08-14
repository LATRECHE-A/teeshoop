#!/usr/bin/env node
/**
 * Write wp-plugins/teeshoop-core/data/garments.json from the studio's own
 * garment definitions.
 *
 *   node scripts/gen-garment-data.mjs        # rewrite the file
 *   node scripts/gen-garment-data.mjs --check # exit 1 if it is stale
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

const { buildGarmentData } = await load()
const data = buildGarmentData()

if (!data || !data.garments || Object.keys(data.garments).length === 0) {
  // "Nothing found" and "nothing looked" are different results.
  console.error('gen-garment-data: the derivation produced no garments. Refusing to write.')
  process.exit(2)
}

const json = JSON.stringify(data, null, '\t') + '\n'

if (CHECK) {
  let current = ''
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    console.error(`gen-garment-data: ${OUT} is missing. Run: node scripts/gen-garment-data.mjs`)
    process.exit(1)
  }
  if (current !== json) {
    console.error(
      'gen-garment-data: wp-plugins/teeshoop-core/data/garments.json is stale.\n' +
        'The studio’s print areas, size chart or colours changed and the shop was not told.\n' +
        'Run: node scripts/gen-garment-data.mjs',
    )
    process.exit(1)
  }
  console.log(
    `gen-garment-data: up to date (${Object.keys(data.garments).length} garments, ${data.colors.length} colours)`,
  )
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, json)
console.log(
  `gen-garment-data: wrote ${OUT} (${Object.keys(data.garments).length} garments, ${data.colors.length} colours)`,
)
