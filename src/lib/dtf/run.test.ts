/**
 * Pooling several orders onto one roll.
 *
 * Two things are being defended here and they have different costs. The first
 * is DETERMINISM: pooling is assembled from whatever arrived in whatever order,
 * and `scripts/dtf-verify.mjs` promises the workshop that the same job produces
 * the same film. The second is that the saving reported is a REAL saving, that
 * the counterfactual each order is measured against is the same order, packed
 * the same way, and that no transfer is lost between the two arms.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRun,
  compareOrderIds,
  groupCandidates,
  joinRefusal,
  measureRun,
  minimumRunLengthCm,
  runPieceKey,
  runRectangles,
  type RunCandidate,
  type RunOrder,
} from './run'
import { nestRoll, type NestOptions } from './nesting'
import type { ShapePiece } from './trueshape'

const OPTS: NestOptions = {
  printableWidthCm: 58,
  maxLengthCm: 250,
  gapCm: 0.5,
  edgeMarginCm: 0,
  billingStepCm: 10,
}

const pack = (pieces: ShapePiece[]) => nestRoll(pieces, OPTS)

const order = (id: string, pieces: [string, number, number, number][]): RunOrder => ({
  id,
  ref: `#${id}`,
  pieces: pieces.map(([key, wCm, hCm, qty]) => ({ key, wCm, hCm, qty })),
})

/** Three orders whose transfers are worth pooling: none fills a row alone. */
const POOL: RunOrder[] = [
  order('1042', [
    ['front#M~1', 24, 18, 6],
    ['front#M~2', 9, 4, 6],
  ]),
  order('1043', [['back#L', 30, 22, 4]]),
  order('99', [
    ['front#S', 14, 14, 12],
    ['sleeve#S', 5, 20, 12],
  ]),
]

describe('run assembly', () => {
  it('numbers order ids the way a workshop reads them, not the way strings sort', () => {
    expect(compareOrderIds('99', '1042')).toBeLessThan(0)
    expect(compareOrderIds('1042', '99')).toBeGreaterThan(0)
    expect(compareOrderIds('devis-2', 'devis-10')).toBeGreaterThan(0)
    expect(compareOrderIds('a', 'a')).toBe(0)
  })

  it('renames every transfer under its order and can always name the owner', () => {
    const run = buildRun(POOL)
    expect(run.pieces).toHaveLength(5)
    for (const p of run.pieces) {
      const owner = run.ownerOf.get(p.sourceKey)
      expect(owner).toBeTruthy()
      expect(p.sourceKey.startsWith(`${owner}/`)).toBe(true)
    }
    expect(run.ownerOf.get(runPieceKey('1043', 'back#L'))).toBe('1043')
  })

  it('is byte-identical whatever order the orders and their pieces arrive in', () => {
    const forwards = buildRun(POOL)
    const backwards = buildRun(
      [...POOL].reverse().map((o) => ({ ...o, pieces: [...o.pieces].reverse() })),
    )
    expect(backwards.orderIds).toEqual(forwards.orderIds)
    expect(JSON.stringify(runRectangles(backwards))).toBe(JSON.stringify(runRectangles(forwards)))
    expect(JSON.stringify(pack(backwards.pieces))).toBe(JSON.stringify(pack(forwards.pieces)))
  })

  it('refuses the same order twice rather than letting one silently win', () => {
    expect(() => buildRun([POOL[0], POOL[0]])).toThrow(/twice/)
  })

  it('refuses two transfers with the same key inside one order', () => {
    expect(() =>
      buildRun([order('1', [['same', 5, 5, 1], ['same', 6, 6, 1]])]),
    ).toThrow(/twice/)
  })

  it('never lets an order rotate a transfer into an upside-down press by default', () => {
    for (const p of buildRun(POOL).pieces) {
      expect(p.allowRotate).toBe(true)
      expect(p.allowFlip).toBeUndefined()
    }
  })
})

describe('what pooling saves', () => {
  it('places every copy of every order, pooled and alone', () => {
    const run = buildRun(POOL)
    const m = measureRun(run, pack, { restarts: 1, flip: false })
    const copies = POOL.reduce((a, o) => a + o.pieces.reduce((b, p) => b + p.qty, 0), 0)
    expect(m.unplaceable).toEqual([])
    expect(m.solos.reduce((a, s) => a + s.placed, 0)).toBe(copies)
    expect(pack(run.pieces).totalPieces).toBe(copies)
  })

  it('measures a saving on this pool rather than merely not losing', () => {
    const m = measureRun(buildRun(POOL), pack, { restarts: 1, flip: false })
    expect(m.soloLengthCm - m.pooledLengthCm).toBeGreaterThan(0)
  })

  /*
   * POOLING DOES NOT ALWAYS SAVE FILM, and this is the counterexample, measured
   * rather than imagined. Two 30 x 20 cm transfers cannot share a row on a 58 cm
   * roll (30,5 + 30,5 = 61 cm of inflated width against 58,5 available), so the
   * pool pays one inter-shelf gap that neither order pays alone, and 40,5 cm of
   * artwork rounds up to 50 cm of billing where 20 + 20 rounds to 40.
   *
   * It is here because the whole session rests on a saving, and a saving that is
   * asserted instead of priced is how a workshop ends up buying more film to be
   * clever. `Cost::attribute()` therefore compares MONEY and reports a negative
   * saving rather than hiding it: on this very pool the euro answer still favours
   * the run, because two orders are two supplier minimums and two delivery
   * charges, and `tests/test-cost.php` holds both numbers.
   */
  it('can cost MORE film pooled than apart, and says so instead of pretending', () => {
    const twins: RunOrder[] = [order('1', [['back', 30, 20, 1]]), order('2', [['back', 30, 20, 1]])]
    const m = measureRun(buildRun(twins), pack, { restarts: 1, flip: false })
    expect(m.soloLengthCm).toBe(40)
    expect(m.pooledLengthCm).toBe(50)
  })

  it('gives one order alone exactly what it cost alone', () => {
    const m = measureRun(buildRun([POOL[1]]), pack, { restarts: 1, flip: false })
    expect(m.pooledLengthCm).toBe(m.soloLengthCm)
    expect(m.solos).toHaveLength(1)
  })

  it('reports an impossible transfer instead of costing the run without it', () => {
    const wide = order('7', [['banner', 90, 90, 1]])
    const m = measureRun(buildRun([wide, POOL[1]]), pack, { restarts: 1, flip: false })
    expect(m.unplaceable).toContain('7/banner')
  })
})

describe('the lower bound the shop checks a reported length against', () => {
  it('is the ink that has to fit, divided by the roll', () => {
    expect(minimumRunLengthCm(5800, 58)).toBe(100)
  })

  it('is never above a length the packer actually produced', () => {
    const run = buildRun(POOL)
    const result = pack(run.pieces)
    const ink = run.pieces.reduce((a, p) => a + p.wCm * p.hCm * p.qty, 0)
    expect(minimumRunLengthCm(ink, OPTS.printableWidthCm)).toBeLessThanOrEqual(result.totalLengthCm)
  })

  it('refuses to invent a bound it cannot derive', () => {
    expect(minimumRunLengthCm(0, 58)).toBe(0)
    expect(minimumRunLengthCm(100, 0)).toBe(0)
  })
})

const cand = (
  id: string,
  origin: 'fr' | 'es',
  orderByOn: string,
  dueOn: string,
  late = false,
): RunCandidate => ({ id, ref: `#${id}`, origin, orderByOn, dueOn, urgency: 'standard', garments: 10, late })

describe('which orders share a run', () => {
  it('makes one run per origin and dates it on the earliest deadline in it', () => {
    const groups = groupCandidates([
      cand('3', 'es', '2026-09-02', '2026-09-18'),
      cand('1', 'fr', '2026-08-24', '2026-08-28'),
      cand('2', 'es', '2026-08-28', '2026-09-14'),
    ])
    expect(groups.map((g) => g.origin)).toEqual(['es', 'fr'])
    expect(groups[0].orderByOn).toBe('2026-08-28')
    expect(groups[0].dueOn).toBe('2026-09-14')
    expect(groups[0].candidates.map((c) => c.id)).toEqual(['2', '3'])
    expect(groups[0].garments).toBe(20)
  })

  it('counts the orders that hold no date any more instead of dropping them', () => {
    const groups = groupCandidates([cand('1', 'fr', '2026-08-10', '2026-08-14', true)])
    expect(groups[0].late).toBe(1)
    expect(groups[0].candidates).toHaveLength(1)
  })

  it('lets anything move to France and refuses to drag a French order to Spain', () => {
    const es: RunCandidate = cand('2', 'es', '2026-09-02', '2026-09-18')
    const fr: RunCandidate = cand('1', 'fr', '2026-08-24', '2026-08-28')
    const [esGroup, frGroup] = groupCandidates([es, fr])
    expect(joinRefusal(frGroup, es)).toBe('')
    expect(joinRefusal(esGroup, fr)).toContain('24/08/2026')
    expect(joinRefusal(esGroup, es)).toBe('')
  })
})
