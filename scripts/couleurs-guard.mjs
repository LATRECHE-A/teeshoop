#!/usr/bin/env node
/**
 * COULEURS GUARD: the swatches on the filter are a measurement, and this
 * proves they still are.
 *
 * `docs/couleurs.json` is the reviewable record of a sweep: every colour name
 * in the catalogue, the value measured from the manufacturer's own images, the
 * family it was sorted into, and for the ones with no swatch, the reason. It is
 * committed so that a boundary moving in `Swatch` shows up as a diff of colours
 * rather than as a silent reclassification of four hundred of them.
 *
 * IT DOES NOT COMPARE FILES, IT RUNS THE CODE. Every row is re-decided by the
 * real `Swatch::family_for()` and `Swatch::verify()`, through PHP, from the
 * row's own stored OKLab. A guard that re-implemented the boundaries in
 * JavaScript would be a second copy of the rule and would agree with itself for
 * ever.
 *
 * IT READS `lab`, NOT `oklch`. They are the same measurement, one exact and one
 * rounded for a person to read. Reading the rounded one made this guard cry
 * wolf: « Lime » measures h=114,972 and « Acid Lime » h=114,989, both print as
 * 115,0, and 115,0 was the far side of a boundary, so two colours were reported
 * as disagreeing with code that had not changed. It checks that the two forms
 * still describe each other instead.
 *
 * WHAT IT REFUSES:
 *
 *   A supplier reference in the record. The images that fed the measurement
 *   live at paths carrying the supplier's style numbers, and this file is
 *   committed. Colour NAMES are on every product page already and are not a
 *   leak; the paths are, and `Shelf::SEALED` exists for that reason.
 *
 *   A family the code no longer agrees with, in either direction: a published
 *   colour the code would refuse, and a refused colour the code would publish.
 *
 *   A swatch that is not a colour, a published row with no family, a refused
 *   row with no reason, and a sweep that measured almost nothing.
 *
 * Exit: 0 clean, 1 the record and the code disagree, 2 the scan is not
 * trustworthy (no record, no rows, php unavailable, or a self-test did not
 * fire).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LEDGER = join(ROOT, 'docs/couleurs.json')
const PLUGIN_INCLUDES = join(ROOT, 'wp-plugins/teeshoop-core/includes')

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

/**
 * A supplier reference, in any of the shapes this catalogue produces.
 *
 * The image paths are `/media/blank/picture/001_42_000_f-2020_01.jpg`: a style
 * number, a colour code and a year. Any one of those is enough to walk back to
 * the supplier's own catalogue, so all three patterns are refused.
 */
const SUPPLIER = [
  [/\/media\//, 'a supplier media path'],
  [/\b\d{3}_\d{2}_\d{3}\b/, 'a supplier style and colour code'],
  [/\.(jpe?g|png|webp)\b/i, 'an image filename'],
]

/** Re-decide every row through the real PHP, from its own stored OKLab. */
function askPhp(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'teeshoop-couleurs-'))
  const driver = join(dir, 'driver.php')
  const input = join(dir, 'rows.json')
  try {
    writeFileSync(input, JSON.stringify(rows))
    writeFileSync(
      driver,
      `<?php
declare(strict_types=1);
define('ABSPATH', __DIR__ . '/');
define('TEESHOOP_TEST', 1);
require_once $argv[1] . '/Swatch.php';
use Teeshoop\\Core\\Swatch;
$out = [];
foreach (json_decode(file_get_contents($argv[2]), true) as $i => $row) {
    $labs = $row['lab'];
    if (empty($labs)) { $out[$i] = null; continue; }

    // The whole rule, not half of it: family_for() is the measurement AND the
    // near-neutral tie-break, and verify() is the last gate the sweep applies.
    $verdict = Swatch::verify([
        'ok'     => true,
        'why'    => '',
        'stops'  => array_map([Swatch::class, 'hex'], $labs),
        'lab'    => $labs[0],
        'labs'   => $labs,
        'family' => Swatch::family($labs[0]),
        'photos' => 1,
        'seen'   => 1,
        'spread' => 0.0,
    ], $row['nom']);

    [$L, $C, $h] = Swatch::oklch($labs[0]);
    $out[$i] = [
        'famille'  => Swatch::family_for($labs[0], $row['nom']),
        'nue'      => Swatch::family($labs[0]),
        'nom_dit'  => Swatch::name_families($row['nom']),
        'publie'   => !empty($verdict['ok']),
        'oklch'    => [round($L, 4), round($C, 4), round($h, 1)],
        'saturation' => round(Swatch::saturation($L, $C), 4),
        'hex'      => array_map([Swatch::class, 'hex'], $labs),
        'familles' => array_keys(Swatch::families()),
    ];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
`,
    )
    const stdout = execFileSync('php', [driver, PLUGIN_INCLUDES, input], { encoding: 'utf8' })
    return { ok: true, said: JSON.parse(stdout) }
  } catch (e) {
    return { ok: false, why: `php could not run Swatch: ${String(e.message).split('\n')[0]}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * A SWEEP THAT MEASURED ALMOST NOTHING IS NOT A CLEAN RUN.
 *
 * Every other check passes trivially on a record where every colour was
 * refused or never looked at, and a boundary moved the wrong way in `Swatch`
 * produces exactly that: four hundred refusals and a green tick. The floor is
 * well under what has been measured (see docs/COULEURS.md) so ordinary
 * variation does not trip it and a collapse does.
 */
const FLOOR = 0.5

/**
 * The three roads a published colour can have come down.
 *
 * Copied from `Colours::SOURCE_*` rather than read from it, like the needles in
 * `scripts/php-guard.mjs`: a gate that takes its expectations from the code it
 * is checking agrees with that code whatever the code does.
 */
const SOURCES = ['déclarée', 'pastille', 'photo']

/**
 * Every check, over a record and what PHP said about it.
 *
 * Separated from the reading so the self-tests at the bottom can feed it a
 * record they have broken on purpose and watch this same code catch it.
 */
function check(ledger, said, raw) {
  const problems = []
  const rows = ledger.couleurs ?? []
  const ecartMax = Number(ledger.ecart_max)

  for (const [pattern, what] of SUPPLIER) {
    const hit = raw.match(pattern)
    if (hit) problems.push(`${what} is in the record: ${JSON.stringify(hit[0])}`)
  }

  if (!Number.isFinite(ecartMax)) {
    problems.push('the record does not carry `ecart_max`, so the distances in it mean nothing here')
  }

  const families = said.find((s) => s && s.familles)?.familles ?? []
  let published = 0
  let waiting = 0
  let far = 0
  let moved = 0

  rows.forEach((row, i) => {
    const where = `« ${row.nom} »`
    const mine = said[i]

    if (row.jamais_mesuré) {
      waiting++
      if (row.pastille || row.refus) {
        problems.push(`${where} is marked never measured and carries a verdict anyway`)
      }
      return
    }

    if (mine && row.oklch) {
      /*
       * The two forms of one measurement must still describe each other. If
       * they drift, the human-readable column is telling a reviewer something
       * different from what the code decided on.
       */
      const same = JSON.stringify(mine.oklch) === JSON.stringify(row.oklch)
      if (!same) {
        problems.push(
          `${where}: oklch in the record is ${JSON.stringify(row.oklch)} and the code makes ${JSON.stringify(mine.oklch)} of the same lab`,
        )
      }
    }

    if (row.refus !== undefined) {
      if (row.pastille) problems.push(`${where} is refused and still carries a swatch`)
      if (!String(row.refus).trim()) problems.push(`${where} is refused with no reason given`)
      /*
       * A refusal keeps the numbers behind it so a person can decide whether
       * the image was wrong or a boundary is. Those numbers are checked too:
       * a refusal recording a family the code no longer computes is a refusal
       * nobody can act on, and a refusal the code would now publish means a
       * boundary moved and `wp teeshoop couleurs reclasser` was not run.
       */
      if (row.vue !== undefined && mine && mine.nue !== row.vue) {
        problems.push(
          `${where} was refused for looking « ${row.vue} », and the code now sees « ${mine.nue} »`,
        )
      }
      if (mine && mine.publie && row.vue !== undefined) {
        problems.push(
          `${where} is refused in the record and the code would publish it as « ${mine.famille} »`,
        )
      }
      return
    }

    published++
    if ((row.ecart_photo ?? 0) > ecartMax) far++
    if (mine && row.famille && mine.nue !== row.famille) moved++

    if (!SOURCES.includes(row.source)) {
      problems.push(
        `${where} is published with source ${JSON.stringify(row.source)}, which is none of ${SOURCES.join(', ')}`,
      )
    }
    if (row.ecart_photo !== undefined && !Number.isFinite(row.ecart_photo)) {
      problems.push(`${where} has a photo distance that is not a number`)
    }
    /*
     * A colour whose value came from the garment photograph cannot also carry a
     * distance to it: the distance is the CHECK on a chip, and a row holding
     * both would mean the fallback and the check had run on the same source.
     */
    if (row.source === 'photo' && row.ecart_photo !== undefined) {
      problems.push(`${where} fell back to the photograph and still records a distance to it`)
    }
    /*
     * NOR CAN A DECLARED COLOUR. `Colours` does not fetch anything on that road,
     * deliberately: `PHOTO_MAX` was fitted on the chip-against-photograph
     * distribution and a declared number against a lit garment has neither the
     * same distribution nor any measurement behind its threshold. A distance on
     * such a row means the fetch came back, so the decision was undone without
     * the number being refitted.
     */
    if (row.source === 'déclarée' && row.ecart_photo !== undefined) {
      problems.push(`${where} was taken from the maker's declared hexadecimal and records a distance to a photograph`)
    }
    /*
     * And the two counters are exclusive by construction: `images` is what was
     * downloaded and `declarations` is what was read out of the payload.
     */
    if (row.images !== undefined && row.declarations !== undefined) {
      problems.push(`${where} counts both images and declarations, and only one of them was the source`)
    }
    if (row.source === 'déclarée' && row.images !== undefined) {
      problems.push(`${where} was declared, not photographed, and counts ${row.images} image(s)`)
    }

    const stops = row.pastille ?? []
    if (stops.length < 1 || stops.length > 2) {
      problems.push(`${where} has ${stops.length} swatch values, which is neither one nor two`)
    }
    for (const stop of stops) {
      if (!/^#[0-9a-f]{6}$/.test(String(stop))) {
        problems.push(`${where} has a swatch that is not a colour: ${JSON.stringify(stop)}`)
      }
    }
    if (!families.includes(row.famille)) {
      problems.push(`${where} is in the family « ${row.famille} », which is not one of the eleven`)
    }
    if (!mine) {
      problems.push(`${where} is published with no measurement to re-decide it from`)
      return
    }
    if (mine.famille !== row.famille) {
      problems.push(`${where}: the record says « ${row.famille} », the code says « ${mine.famille} »`)
    }
    /*
     * THE SWATCH IS THE MEASUREMENT. Every published hex has to be what the
     * stored OKLab converts to, or the drawn colour and the recorded number
     * have parted company.
     */
    if (JSON.stringify(mine.hex) !== JSON.stringify(stops)) {
      problems.push(
        `${where} draws ${JSON.stringify(stops)} and its own measurement makes ${JSON.stringify(mine.hex)}`,
      )
    }
    /*
     * `Swatch::verify()` refuses a colour whose measured families do not cover
     * what its name claims, and refuses one that shows a strong colour the name
     * does not mention. A published row that fails it means the gate was
     * skipped. It runs here over ALL the row's stops, which is why the record
     * carries every stop's lab and not only the first.
     */
    if (!mine.publie) {
      problems.push(
        `${where} is published as « ${row.famille} » and Swatch::verify() refuses it: its name says « ${(mine.nom_dit ?? []).join('+') || 'rien' } »`,
      )
    }
  })

  const total = rows.length
  const share = total > 0 ? published / total : 0
  if (share < FLOOR) {
    problems.push(
      `only ${published} of ${total} colours carry a swatch (${(share * 100).toFixed(1)} %), ` +
        `under the ${(FLOOR * 100).toFixed(0)} % floor: something has stopped measuring`,
    )
  }

  const byPhoto = rows.filter((r) => r.source === 'photo').length
  const byHex = rows.filter((r) => r.source === 'déclarée').length
  return { problems, published, waiting, total, far, byPhoto, byHex, moved, ecartMax }
}

function run() {
  if (!existsSync(LEDGER)) {
    console.error(`${RED}No docs/couleurs.json. Run: npm run couleurs:relever${OFF}`)
    return 2
  }

  const raw = readFileSync(LEDGER, 'utf8')
  let ledger
  try {
    ledger = JSON.parse(raw)
  } catch (e) {
    console.error(`${RED}docs/couleurs.json is not readable JSON: ${e.message}${OFF}`)
    return 2
  }

  const rows = ledger.couleurs ?? []
  if (rows.length === 0) {
    console.error(`${RED}The record holds no colours. Nothing was checked.${OFF}`)
    return 2
  }

  // The exact triples, which is what the shop classified. A row with none (a
  // colour nobody has looked at, or one whose image could not be read at all)
  // is asked about anyway and comes back null.
  const askable = rows.map((r) => ({ nom: r.nom, lab: r.lab ?? [] }))
  const php = askPhp(askable)
  if (!php.ok) {
    console.error(`${RED}${php.why}${OFF}`)
    return 2
  }

  const { problems, published, waiting, total, far, byPhoto, byHex, moved, ecartMax } = check(ledger, php.said, raw)

  /*
   * THE SELF-TESTS. Break the record on purpose, twice, and require this same
   * comparison to say so. A guard that cannot fail is the thing this repository
   * has shipped before and will not ship again.
   */
  const fired = []

  const wrongFamily = JSON.parse(raw)
  const victim = wrongFamily.couleurs.find((r) => r.pastille && r.famille !== 'violet')
  if (!victim) {
    console.error(`${RED}No published colour to break: the family self-test proved nothing.${OFF}`)
    return 2
  }
  victim.famille = 'violet'
  if (
    check(wrongFamily, php.said, JSON.stringify(wrongFamily)).problems.some((p) => p.includes(victim.nom))
  ) {
    fired.push(`a wrong family on « ${victim.nom} »`)
  }

  /*
   * A colour taken from the maker's declared number, carrying a distance to a
   * photograph nobody fetched. It is the one rule this record cannot exercise
   * on its own today: every row in it predates the declared road, so without
   * this the branch would ship unproven.
   */
  const declaredWithGap = JSON.parse(raw)
  const declared = declaredWithGap.couleurs.find((r) => r.pastille)
  if (!declared) {
    console.error(`${RED}No published colour to break: the declared-source self-test proved nothing.${OFF}`)
    return 2
  }
  declared.source = 'déclarée'
  declared.ecart_photo = 0.5
  if (
    check(declaredWithGap, php.said, JSON.stringify(declaredWithGap)).problems.some(
      (p) => p.includes(declared.nom) && p.includes('declared hexadecimal'),
    )
  ) {
    fired.push(`a declared colour carrying a photograph distance on « ${declared.nom} »`)
  }

  // And a half-finished sweep, which every other check passes.
  const halfDone = JSON.parse(raw)
  halfDone.couleurs = halfDone.couleurs.map((r) =>
    r.pastille ? { nom: r.nom, slug: r.slug, articles: r.articles, jamais_mesuré: true } : r,
  )
  if (check(halfDone, php.said, JSON.stringify(halfDone)).problems.some((p) => p.includes('floor'))) {
    fired.push('a sweep that measured nothing')
  }

  if (fired.length < 3) {
    console.error(
      `${RED}Only ${fired.length} of 3 self-tests fired: this guard cannot be trusted to detect ${fired.length === 0 ? 'anything' : 'every fault'}.${OFF}`,
    )
    return 2
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`  ${RED}x${OFF} ${p}`)
    console.error(`\n${RED}${problems.length} problem(s) in docs/couleurs.json${OFF}`)
    console.error(
      `${DIM}A family that disagrees is the database, not this file: run` +
        ` « wp teeshoop couleurs reclasser » then « npm run couleurs:relever ».${OFF}`,
    )
    return 1
  }

  const refused = total - published - waiting
  console.log(
    `${GREEN}✓${OFF} ${published} colour(s) measured (${byHex} from a maker's declared hexadecimal, ` +
      `${published - byPhoto - byHex} from a maker's chip, ` +
      `${byPhoto} from a photograph), ${refused} refused, ${waiting} not looked at yet, ` +
      `${far} photograph(s) further than ${ecartMax} from their chip, ` +
      `${moved} grouped by their name because too pale to group by measurement, ` +
      `${total} checked against Swatch ${DIM}(self-tests fired on ${fired.join(' and ')})${OFF}`,
  )
  return 0
}

process.exit(run())
