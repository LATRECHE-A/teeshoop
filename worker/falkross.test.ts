/**
 * The supplier classifier, against real supplier payloads.
 *
 * WHY REAL XML AND NOT A STUB. `classifyKind` and `classifyShelf` decide the
 * family and the aisle of every one of the 2 309 products in the shop, and
 * their whole difficulty is that the supplier's vocabulary is messy in ways
 * nobody would invent: a bib apron whose only sub-category is « Horeca & Care »,
 * a wash glove filed under « Towels », a snood that is also a hat. A fixture
 * written by hand would be a fixture written by whoever wrote the rule, and it
 * would agree with the rule for that reason alone.
 *
 * The files in `__fixtures__/falkross/` are UNMODIFIED documents fetched from
 * download.falk-ross.eu on 04/09/2026, whole, not trimmed. `parseStyle` is the
 * shipped function and it is what runs here.
 *
 * WHAT EACH CASE IS FOR. Every one of them is a style that the measurement of
 * the live catalogue showed to be hard, not a style picked because it passes:
 *
 *   91367  the apron whose sub-categories never say « apron ». It is the whole
 *          argument for reading `style_product_group_list`, which this file
 *          ignored until the 1 744 products in « Autres textiles » were counted.
 *   00264  a WASH GLOVE, grouped « Towels ». The word « glove » is in the name
 *          and must not put it in a glove aisle that does not exist; it is a
 *          bathroom textile.
 *   00869  a snood/hat combo, grouped « Hats / Winter Hats ». Precedence has to
 *          send it to bonnet, not casquette: this is one of the seven styles in
 *          the catalogue where two aisle rules both match.
 *   01334  a trucker cap, grouped « Caps ». The control for the case above.
 *   96069  a beanie whose groups are « Winter Hats / Knitted Hats / Hats ».
 *   90828  a tote and 00730 a backpack: two different group labels, one aisle.
 *   46918  a softshell jacket whose only sub-category is « Softshell ».
 *   20033  a hi-vis zipped safety hoody, grouped « Jackets » AND « Sweatshirts ».
 *          It is the style that shows the family and the aisle are two
 *          questions: the supplier calls it both.
 *   00142  a t-shirt and 00517 a polo, the printable controls. Their aisle must
 *          follow their family with no second opinion.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyShelf, parseStyle, type FrKind, type FrShelf } from './falkross'

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), '__fixtures__/falkross')
const xml = (nr: string) => readFileSync(join(DIR, `${nr}.xml`), 'utf8')

/** style number → what it is, what the supplier says, what we must file it as. */
const CASES: ReadonlyArray<{ nr: string; quoi: string; kind: FrKind; shelf: FrShelf }> = [
  { nr: '00142', quoi: 'B&C #inspire E150, un t-shirt', kind: 'tee', shelf: 'tshirt' },
  { nr: '00517', quoi: 'Regatta Coolweave, un polo', kind: 'polo', shelf: 'polo' },
  { nr: '91367', quoi: 'Karlowsky Bib Apron, sous-categorie « Horeca & Care » seulement', kind: 'other', shelf: 'tablier' },
  { nr: '00264', quoi: 'SG Rhine Wash Glove, groupe « Towels »', kind: 'other', shelf: 'maison' },
  { nr: '00869', quoi: 'Beechfield Snood/Hat Combo, groupes « Hats / Winter Hats »', kind: 'other', shelf: 'bonnet' },
  { nr: '01334', quoi: 'Result Detroit Truckers, groupe « Caps »', kind: 'other', shelf: 'casquette' },
  { nr: '96069', quoi: 'Beechfield Oversized Cuffed Beanie', kind: 'other', shelf: 'bonnet' },
  { nr: '90828', quoi: 'Westford Mill Tote Bag, groupe « Shopping Bags »', kind: 'other', shelf: 'sac' },
  { nr: '00730', quoi: 'Quadra Backpack, groupe « Backpacks »', kind: 'other', shelf: 'sac' },
  { nr: '46918', quoi: 'Stormtech Orbiter Softshell Jacket', kind: 'other', shelf: 'veste' },
  { nr: '20033', quoi: 'Result Safety Hoody, groupes « Jackets » ET « Sweatshirts »', kind: 'sweat', shelf: 'sweat' },
]

describe('classification against real Falk&Ross payloads', () => {
  for (const c of CASES) {
    it(`${c.nr} ${c.quoi} -> ${c.kind} / ${c.shelf}`, () => {
      const style = parseStyle(xml(c.nr), c.nr)
      expect(style.kind).toBe(c.kind)
      expect(style.shelf).toBe(c.shelf)
    })
  }

  /*
   * A fixture nobody exercises is a file that rots. This fails the day somebody
   * adds a payload and forgets the case, which is the only way this suite can
   * quietly stop covering what it claims to.
   */
  it('exercises every fixture on disk', () => {
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.xml')).map((f) => f.replace('.xml', '')).sort()
    expect(CASES.map((c) => c.nr).sort()).toEqual(onDisk)
  })
})

describe('the aisle is a second question, not a second name for the family', () => {
  /*
   * The four printable kinds carry their own aisle and never consult the
   * supplier's groups. If they did, style 20033 would be filed under « Vestes »
   * on the strength of its « Jackets » group, and a hooded sweatshirt the studio
   * prints every week would leave the sweat aisle.
   */
  it('a printable kind decides its own aisle, whatever the supplier groups say', () => {
    expect(classifyShelf('sweat', ['Hoods', 'Workwear'], ['Jackets', 'Sweatshirts'])).toBe('sweat')
    expect(classifyShelf('tee', ['T-Shirts'], ['Bags & Accessories'])).toBe('tshirt')
  })

  /*
   * MEASURED: 41 of the 410 styles the supplier files under « Caps & Hats » are
   * not headwear, 19 of them gloves. The associate has no glove aisle, so they
   * stay in « Autres textiles » and say so, rather than being sold as caps.
   */
  it('refuses an aisle the shop does not have rather than choosing the nearest', () => {
    expect(classifyShelf('other', ['Caps & Hats'], ['Gloves'])).toBe('autre')
    expect(classifyShelf('other', ['Caps & Hats'], ['Scarfs'])).toBe('autre')
    expect(classifyShelf('other', ['Workwear'], ['Trousers'])).toBe('autre')
    expect(classifyShelf('other', ['Shoes'], ['Shoes'])).toBe('autre')
  })

  /* The group is the fine signal and wins over the sub-category. */
  it('reads the product group before the sub-category', () => {
    expect(classifyShelf('other', ['Horeca & Care'], ['Aprons'])).toBe('tablier')
    expect(classifyShelf('other', ['Horeca & Care'], ['Towels'])).toBe('maison')
    // and falls back to the sub-category when no group places it
    expect(classifyShelf('other', ['Bags & Accessories'], [])).toBe('sac')
    expect(classifyShelf('other', ['Beanies & Accessories'], ['Something Unlisted'])).toBe('bonnet')
  })

  /* Nothing is guessed from a name: the trap this file records twice. */
  it('never reads the style name', () => {
    expect(classifyShelf('other', [], [])).toBe('autre')
  })
})
