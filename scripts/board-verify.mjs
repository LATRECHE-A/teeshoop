/**
 * Headless BOARD-MODE verification.
 *
 * Board mode shows several basket products at once and lets the user focus one
 * to edit it. Almost everything that can go wrong is invisible on screen, so
 * this script checks the invisible things:
 *
 *   A  layout math — pure, deterministic, no viewport needed
 *   B  the texture budget — what the board ACTUALLY allocates, in bytes
 *   C  store semantics — focus/unfocus/write-back, the autosave guard, and the
 *      PER-DOCUMENT undo history: each document's stacks travel with it (the
 *      draft's in BoardStash, a line's in the session registry), so coming back
 *      from the board restores the user's own undo AND redo — while undo inside
 *      a focused line still cannot reach another document, proved by exhausting
 *      the stack. Ends with a negative control so the check cannot be vacuous.
 *   C2 cross-document corruption — two basket lines CLONED FROM ONE DESIGN
 *      share a design id and layer ids, which is the one case the undo/gesture
 *      machinery cannot tell apart by id (and the reason parked history is keyed
 *      by LINE id)
 *   C3 the parked-history registry on its own — LRU eviction, no browser needed
 *   C4 the toolbar in the DOM — the undo/redo buttons follow the swap, in
 *      exactly one depth change, so they never blink through a disabled frame,
 *      and stay DEAD for as long as the board is on: the restored stacks belong
 *      to a draft that is not on screen, and Ctrl+Z already refuses there
 *   D  per-line size parity — every render path uses `line.size`, so the 3D
 *      decal, the 2D tile and the graded print area agree to <0.01 in. Getting
 *      this wrong is a wrong physical transfer, and nothing on screen says so.
 *   G  camera framing — a garment is framed by its BODY, not by the arm span an
 *      A-pose adds to its bounding box, and nothing is ever cropped
 *   E  the 2D board in the DOM — tiles, timing, pan/zoom, tap slop, a11y
 *   H  data loss — reload while focused, including the race where the focus
 *      lands inside the draft's own 700 ms autosave debounce
 *   K  write-back — the last keystroke reaches the basket AND idb on unfocus
 *   O  the board is genuinely NOT editable while unfocused
 *   N  mobile + accessibility — tap, pinch, Escape, disabled (not hidden) tools
 *   F  the 3D board — geometry sharing, decal cost, billboard degradation, and
 *      both a static and a live proof that no DecalGeometry reaches the board
 *   L  picking — a pointer move must not raycast half a million triangles
 *   M  degradation — over the cap, purged uploads, an empty basket
 *
 *   node scripts/board-verify.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { chromium } from 'playwright'

const PORT = 5196
const BASE = `http://localhost:${PORT}`

let verdict = 'PASS'
const fail = (msg) => {
  console.log(`  ✗ FAIL ${msg}`)
  verdict = 'FAIL'
}
const warn = (msg) => {
  console.log(`  ! WARN ${msg}`)
  if (verdict === 'PASS') verdict = 'WARN'
}
const ok = (msg) => console.log(`  ✓ ${msg}`)
const check = (cond, msg) => (cond ? ok(msg) : fail(msg))

const waitFor = (url, ms = 45000) =>
  new Promise((res, rej) => {
    const s = Date.now()
    const t = async () => {
      try {
        if ((await fetch(url)).ok) return res()
      } catch {}
      if (Date.now() - s > ms) return rej(new Error('dev server timeout'))
      setTimeout(t, 400)
    }
    t()
  })

// ---------------------------------------------------------------------------
// F (static): the board must never mount drei's <Decal>.
//
// <Decal> builds a DecalGeometry by CPU-clipping every triangle of the parent
// mesh — measured at 56 ms for the tee and 613 ms for the hoodie, per decal.
// Eight hoodies with two sides each is ~10 s of synchronous main-thread work.
// This is the one failure mode that cannot be caught after the fact, because it
// looks like "the board is just slow". Section L re-proves it from the LIVE
// scene, because a static grep only covers the files it was told about.
// ---------------------------------------------------------------------------
/** Code only — the modules TALK about <Decal> at length, which is the point. */
function codeOf(path) {
  return fs
    .readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function staticChecks() {
  console.log('\n=== F · board never uses drei <Decal> (static) ===')
  const files = [
    'src/three/Board3D.tsx',
    'src/three/BoardGarment.tsx',
    'src/three/garmentCache.ts',
    'src/app/Board3DStage.tsx',
  ]
  for (const f of files) {
    const src = codeOf(f)
    const usesDecal = /\bDecal\b\s*[,}]/.test(src) || /<Decal[\s/>]/.test(src)
    check(!usesDecal, `${f} does not mount <Decal>`)
    if (/buildFabricOverlay/.test(src))
      fail(`${f} builds the FULL-MESH fabric overlay (36k verts on the hoodie)`)
  }
  const garment = codeOf('src/three/BoardGarment.tsx')
  check(
    /buildFabricDecal/.test(garment),
    'BoardGarment uses buildFabricDecal (the coarse fabric grid AR already ships)',
  )
  check(
    /colorWrite=\{false\}/.test(garment) && !/visible=\{false\}/.test(garment),
    'hit proxy is colorWrite:false, not visible:false (Raycaster skips invisible objects)',
  )
  const board3d = codeOf('src/three/Board3D.tsx')
  check(/frameloop="demand"/.test(board3d), 'the 3D board renders on demand, not in a loop')
  check(!/<Float[\s/>]/.test(board3d), 'no sway on the board (it would pin the GPU at 60 fps)')
}

// ---------------------------------------------------------------------------
// Basket seeding, shared by every section that needs products. Runs IN THE PAGE.
// `custom: true` seeds a ship-your-own garment from a 600x900 photo — a 1.5
// aspect, deliberately far from the 1.25 the layout assumes before it has
// measured one.
// ---------------------------------------------------------------------------
async function seedBasket(page, seeds) {
  return page.evaluate(async (seeds) => {
    const st = () => window.__tshop.getState()
    const assets = await window.__assets()
    if (st().board.on) st().exitBoard()
    st().clearBasket()
    st().newDesign()
    st().renameDesign('MY DRAFT')
    st().addTextLayer('DRAFT ART')
    const draftId = st().design.id

    let customAsset = null
    for (const seed of seeds) {
      const cur = st()
      if (seed.garment === 'custom') {
        if (!customAsset) {
          const c = document.createElement('canvas')
          c.width = 600
          c.height = 900
          const x = c.getContext('2d')
          x.fillStyle = '#2f6fd0'
          x.fillRect(0, 0, 600, 900)
          x.fillStyle = '#ffffff'
          x.fillRect(120, 200, 360, 300)
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
          customAsset = await assets.addAsset(blob, 'custom-front')
          st().setAssets(await assets.listAssets())
        }
        cur.setCustom({
          widthIn: 22,
          front: {
            assetId: customAsset.id,
            useCutout: false,
            printArea: { xIn: 5, yIn: 6, wIn: 12, hIn: 16 },
          },
          back: null,
        })
        st().addTextLayer('CUSTOM ART')
      } else {
        cur.setGarment(seed.garment)
        st().setColor(seed.color)
        if (st().design.layers.length === 0) st().addTextLayer('BOARD ART')
      }
      st().setPreviewSize(seed.size)
      st().renameDesign(seed.name)
      st().addToBasket()
    }
    // Leave the user on a clean OWN document, not on the last seeded product.
    st().newDesign()
    st().renameDesign('MY DRAFT')
    st().addTextLayer('DRAFT ART')
    return {
      lines: st().basket.length,
      draftId,
      customAssetId: customAsset?.id ?? null,
    }
  }, seeds)
}

const SEEDS = [
  { garment: 'tee', color: 'white', size: 'S', name: 'Alpha' },
  { garment: 'tee', color: 'black', size: '3XL', name: 'Bravo' },
  { garment: 'hoodie', color: 'navy', size: 'M', name: 'Charlie' },
  { garment: 'tee', color: 'white', size: 'L', name: 'Delta' },
  { garment: 'hoodie', color: 'white', size: 'XL', name: 'Echo' },
  { garment: 'tee', color: 'black', size: '2XL', name: 'Foxtrot' },
  { garment: 'custom', size: 'M', name: 'Golf-custom' },
  { garment: 'tee', color: 'navy', size: 'M', name: 'Hotel' },
  { garment: 'hoodie', color: 'black', size: 'S', name: 'India' },
]

// ---------------------------------------------------------------------------
// A, B, C, C2, D, G, J — everything that can be decided from the modules.
// ---------------------------------------------------------------------------
/**
 * Import a module THE WAY THE APP DID — see `appImport` below, defined inside
 * every probe because page.evaluate ships one function at a time.
 *
 * Vite appends `?t=<hmr timestamp>` to a module it has invalidated, and a
 * plain-path `import()` from a test then gets a SECOND instance with its own
 * module state. Reading a cache through that copy reports an empty board while
 * the real one is full — which is a lie, not a finding.
 */
async function inPage() {
  const appImport = (path) => {
    const fetched = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes(path))
    return import(fetched.find((n) => n.includes('?t=')) ?? fetched[0] ?? path)
  }
  const board = await import('/src/state/board.ts')
  const render = await import('/src/lib/renderDesign.ts')
  const printScale = await import('/src/lib/printScale.ts')
  const decal = await import('/src/three/decalGeom.ts')
  const frameMod = await import('/src/three/garmentFrame.ts')
  const calib = await import('/src/three/calibration.ts')
  const stage = await import('/src/three/Stage.tsx')
  const garments = await import('/src/garments/index.ts')
  const chartMod = await import('/src/content/sizeChart.ts')
  const mock = await appImport('/src/app/board/mockupCache.ts')
  // Through appImport, not a bare one: parkedHistorySlots() reads a module-level
  // registry, and a second HMR instance would report an empty one forever.
  const storeMod = await appImport('/src/state/store.ts')
  const THREE = await window.__three()
  const { GLTFLoader } = await window.__gltf()
  const store = window.__tshop
  const out = {}

  // The live undo history and the document it belongs to. Both C and C2 need
  // them: history is per DOCUMENT, so every assertion about a stack is really an
  // assertion about which document that stack describes.
  const depth = () => ({
    past: store.temporal.getState().pastStates.length,
    future: store.temporal.getState().futureStates.length,
  })
  const doc = () => {
    const d = store.getState().design
    return { id: d.id, name: d.name, layers: d.layers.length }
  }

  // ---- A · layout math ----------------------------------------------------
  {
    const items = [
      { wIn: 20, hIn: 26 },
      { wIn: 24, hIn: 30 },
      { wIn: 20, hIn: 26 },
      { wIn: 20, hIn: 26 },
      { wIn: 20, hIn: 26 },
      { wIn: 20, hIn: 26 },
    ]
    const a = board.layoutBoard(items, { gapW: 3, gapH: 3, aspect: 1.6, maxCols: 99 })
    const b = board.layoutBoard(items, { gapW: 3, gapH: 3, aspect: 1.6, maxCols: 99 })
    let overlaps = 0
    for (let i = 0; i < a.places.length; i++)
      for (let j = i + 1; j < a.places.length; j++) {
        const p = a.places[i]
        const q = a.places[j]
        if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h)
          overlaps++
      }
    out.layout = {
      cols: a.cols,
      rows: a.rows,
      cellW: a.cellW,
      cellH: a.cellH,
      width: a.width,
      height: a.height,
      deterministic: JSON.stringify(a) === JSON.stringify(b),
      overlaps,
      // Cell must be sized from the BIGGEST item, or a 3XL clips its neighbour.
      cellFromBiggest: a.cellW === 27 && a.cellH === 33,
      // Every item centred in its cell.
      centred: a.places.every(
        (p) =>
          Math.abs((p.x % a.cellW) - (a.cellW - p.w) / 2) < 1e-9 &&
          Math.abs((p.y % a.cellH) - (a.cellH - p.h) / 2) < 1e-9,
      ),
      wideVsTall: {
        wide: board.layoutBoard(items, { gapW: 3, gapH: 3, aspect: 3, maxCols: 99 }).cols,
        tall: board.layoutBoard(items, { gapW: 3, gapH: 3, aspect: 0.5, maxCols: 99 }).cols,
      },
      mobileCap: board.layoutBoard(items, { gapW: 3, gapH: 3, aspect: 0.6, maxCols: 2 }).cols,
      empty: board.layoutBoard([], { gapW: 3, gapH: 3, aspect: 1, maxCols: 4 }).places.length,
    }
  }

  // ---- B · texture budget -------------------------------------------------
  {
    const rows = []
    for (const n of [2, 4, 8, 16]) {
      for (const mobile of [false, true]) {
        const px = board.boardTextureTargetPx(n, mobile)
        // A tee front panel is 12x16 in => 3:4, so the long edge is the height.
        const bytes = board.textureBytes(Math.round(px * 0.75), px)
        rows.push({
          n,
          mobile,
          px,
          perDecalMiB: bytes / 1048576,
          totalMiB: (bytes * 2 * n) / 1048576,
        })
      }
    }
    out.budget = rows
    out.legacy2048MiB = (board.textureBytes(1536, 2048) * 2 * 8) / 1048576
  }

  const basket0 = store.getState().basket
  const draftDesign = store.getState().design
  const draftSize = store.getState().previewSize

  // ---- C · store semantics ------------------------------------------------
  {
    const st = () => store.getState()
    st().openModal('basket')
    st().enterBoard()
    const afterEnter = st()
    const basket = afterEnter.basket
    const target = basket[2]

    const temporal = () => store.temporal.getState()
    // Give the draft BOTH stacks before the swap. Past-only would let a half
    // restore (undo comes back, redo is gone) pass: the redo stack is half the
    // user's position in their own work.
    st().addTextLayer('DRAFT EDIT')
    st().addTextLayer('DRAFT EDIT 2')
    temporal().undo()
    const draftDepth = depth()
    const draftDoc = doc()

    st().focusLine(target.id)
    const focused = st()
    const focusDepth = depth()

    // Edit the focused line the way a user would.
    st().renameDesign('Charlie edited')
    st().setColor('red')
    st().setPreviewSize('2XL')
    const editedHistory = temporal().pastStates.length

    // An undo inside the line rewinds THAT line…
    temporal().undo()
    const lineUndo = doc()
    temporal().redo()

    // …and exhausting the stack bottoms out on the line's own first state.
    // Every seed carries a distinct name, so this discriminates the line from
    // the draft AND from its neighbours on the board.
    for (let i = 0; i < 25; i++) temporal().undo()
    const exhausted = { ...doc(), past: depth().past }
    for (let i = 0; i < 25; i++) temporal().redo()

    // That undo is a real edit, not a cosmetic one: the rewound name is what
    // the next write-back must carry into the basket.
    st().renameDesign('UNDO ME')
    temporal().undo()

    st().flushFocusedLine()
    const lineAfterFlush = st().basket.find((l) => l.id === target.id)
    const undoReachesBasket = lineAfterFlush?.design.name !== 'UNDO ME'
    // The basket SNAPSHOT of a different line must not have moved.
    const neighbourBefore = JSON.stringify(basket[3].design)
    const neighbourAfter = JSON.stringify(st().basket[3].design)

    st().unfocusLine()
    const afterUnfocus = st()
    const unfocusDepth = depth()

    // Ctrl+Z after the board walks the user's OWN edits — the reported bug.
    temporal().undo()
    const draftUndo = doc()
    temporal().redo()

    // Re-focusing the same line in the same board session restores ITS stack.
    st().focusLine(target.id)
    const refocusDepth = depth()
    temporal().undo()
    const refocusUndo = doc()
    temporal().redo()
    st().unfocusLine()
    const slotsWhileBoardOn = storeMod.parkedHistorySlots()

    // Re-entering the board from the basket while focused must hand the
    // document back — otherwise the line's design becomes the live draft with
    // no focusedId guarding it, and the next autosave overwrites the user.
    st().focusLine(basket[4].id)
    st().enterBoard()
    const afterReenter = st()

    // Deleting the focused line must hand the document back first — and its
    // parked history must go with the document. Edited first: an empty stack
    // never takes a slot (src/state/history.ts), so an untouched line could
    // not show a drop at all.
    st().focusLine(basket[0].id)
    st().renameDesign('DOOMED LINE')
    st().unfocusLine()
    const slotsBeforeRemove = storeMod.parkedHistorySlots()
    st().focusLine(basket[0].id)
    st().removeBasketLine(basket[0].id)
    const afterRemove = st()
    const slotsAfterRemove = storeMod.parkedHistorySlots()

    // Leaving the board is the boundary that forgets: the LINES' stacks go, the
    // draft's (parked in BoardStash, not in the registry) stays.
    st().exitBoard()
    st().enterBoard()
    st().focusLine(target.id)
    const refocusAfterExit = depth()
    st().unfocusLine()
    st().exitBoard()
    const slotsAfterExit = storeMod.parkedHistorySlots()

    // NEGATIVE CONTROL, last, with the draft live and its stacks restored: a
    // clear() at exactly the point HEAD had one must take the measured quantity
    // to zero. Without this, `historyRestoredOnUnfocus` could be vacuously true.
    // It destroys nothing — C2 opens with newDesign().
    const controlBefore = depth().past
    temporal().clear()
    const controlAfter = depth().past

    out.store = {
      enterSelectsAll: afterEnter.board.selectedIds.length === basket.length,
      enterClosesModal: afterEnter.modals.basket === false,
      enterClearsPanel: afterEnter.activePanel === null,
      focusSwapsDesign: focused.design.id === target.design.id,
      focusUsesLineSize: focused.previewSize === target.size,
      focusIsDeepCopy: focused.design !== target.design,
      draftDepth,
      focusStartsEmpty: focusDepth.past === 0 && focusDepth.future === 0,
      editedHistory,
      lineUndoStaysInLine: lineUndo.id === target.design.id && lineUndo.name !== draftDoc.name,
      exhausted,
      exhaustedStaysInLine:
        exhausted.name === 'Charlie' && exhausted.id !== draftDoc.id && exhausted.past === 0,
      undoReachesBasket,
      flushWritesDesign: lineAfterFlush?.design.name === 'Charlie edited',
      flushRederivesLabel: lineAfterFlush?.label === 'Charlie edited',
      flushRederivesColor: lineAfterFlush?.colorHex !== target.colorHex,
      flushWritesSize: lineAfterFlush?.size === '2XL',
      neighbourUntouched: neighbourBefore === neighbourAfter,
      unfocusRestoresDraft: afterUnfocus.design.id === draftDesign.id,
      unfocusRestoresSize: afterUnfocus.previewSize === draftSize,
      unfocusClearsFocus: afterUnfocus.board.focusedId === null,
      reenterUnfocuses:
        afterReenter.board.focusedId === null && afterReenter.design.id === draftDesign.id,
      removeUnfocuses: afterRemove.board.focusedId === null,
      removeDropsSelection: !afterRemove.board.selectedIds.includes(basket[0].id),
      // The user's own draft is untouched by everything above.
      draftLayersIntact: afterUnfocus.design.layers.length === draftDesign.layers.length + 1,
      unfocusDepth,
      historyRestoredOnUnfocus:
        unfocusDepth.past === draftDepth.past && unfocusDepth.future === draftDepth.future,
      draftUndoWalksOwnEdits:
        draftUndo.id === draftDoc.id && draftUndo.layers === draftDoc.layers - 1,
      refocusRestoresLine: refocusDepth.past > 0,
      refocusUndoIsLines: refocusUndo.id !== draftDoc.id && /^Charlie/.test(refocusUndo.name),
      slotsWhileBoardOn,
      slotsBeforeRemove,
      slotsAfterRemove,
      removeDropsHistory: slotsAfterRemove < slotsBeforeRemove,
      exitDropsLineHistory: refocusAfterExit.past === 0 && refocusAfterExit.future === 0,
      slotsAfterExit,
      historyCheckDiscriminates: controlBefore > 0 && controlAfter === 0,
    }
    store.getState().exitBoard()
  }

  // ---- C2 · two lines cloned from ONE design ------------------------------
  //
  // The corruption path the whole focus/unfocus dance exists to close: cloned
  // lines share `design.id` AND every `layer.id`, so patchLayer's gesture-commit
  // guard (`gestureStart.id === design.id && the layer exists`) cannot tell them
  // apart. An interrupted drag on one line would then rewind the OTHER line's
  // document to the first line's content.
  {
    const st = () => store.getState()
    st().newDesign()
    st().renameDesign('SHARED DESIGN')
    st().addTextLayer('SHARED')
    const layerId = st().design.layers[0].id
    const sharedId = st().design.id
    st().addToBasket()
    st().addToBasket()
    const basket = st().basket
    const a = basket[basket.length - 2]
    const b = basket[basket.length - 1]

    st().enterBoard()

    // Control: inside ONE document the gesture-commit rewind must still work,
    // or the cross-document check below would pass for the wrong reason.
    st().focusLine(a.id)
    const startX = st().design.layers[0].xIn
    st().patchLayer(layerId, { xIn: 2 }, { transient: true })
    st().patchLayer(layerId, { xIn: 3 }, { transient: true })
    st().patchLayer(layerId, { xIn: 3 })
    const committedX = st().design.layers[0].xIn
    store.temporal.getState().undo()
    const undoneX = st().design.layers[0].xIn

    // Now the real thing: rename A, leave a drag UNCOMMITTED, jump straight to
    // the twin line, and make an ordinary edit there.
    st().renameDesign('LINE A ONLY')
    st().patchLayer(layerId, { xIn: 9 }, { transient: true })
    st().focusLine(b.id)
    const bNameOnFocus = st().design.name
    const bHistoryOnFocus = store.temporal.getState().pastStates.length
    st().patchLayer(layerId, { xIn: 1 })
    st().flushFocusedLine()
    const bLine = st().basket.find((l) => l.id === b.id)
    const aLine = st().basket.find((l) => l.id === a.id)

    // Undo, hard, from inside B: it must never reach A's document.
    const t = store.temporal.getState()
    for (let i = 0; i < 12; i++) t.undo()
    const afterUndo = st().design

    // Which line does a parked stack belong to? The two twins share design.id,
    // so a registry keyed by the DESIGN has ONE slot for both. Park A, then park
    // B by way of a THIRD document (a seeded line, whose design id differs), then
    // come back to A: line-keyed hands A back its own {1 undo, 0 redo}, while
    // design-keyed hands it B's {0 undo, 1 redo} — the stack left by the twelve
    // undos above. Alternating A↔B alone cannot tell the two keys apart.
    const third = st().basket.find((l) => l.design.id !== sharedId)
    st().focusLine(third.id)
    st().focusLine(a.id)
    const aRefocus = depth()
    t.undo()
    const aRefocusUndo = { name: st().design.name, xIn: st().design.layers[0].xIn }
    t.redo()

    st().exitBoard()
    out.clones = {
      sameDesignId: a.design.id === sharedId && b.design.id === sharedId,
      sameLayerId: a.design.layers[0].id === b.design.layers[0].id,
      differentLineIds: a.id !== b.id,
      gestureCommitWorks: committedX === 3 && undoneX === startX,
      focusIsCleanDocument: bNameOnFocus === 'SHARED DESIGN' && bHistoryOnFocus === 0,
      bKeptItsOwnName: bLine?.design.name === 'SHARED DESIGN',
      bTookOnlyItsOwnEdit: bLine?.design.layers[0].xIn === 1,
      aKeptItsOwnEdits: aLine?.design.name === 'LINE A ONLY' && aLine?.design.layers[0].xIn === 9,
      undoStayedInB: afterUndo.name === 'SHARED DESIGN',
      undoKeptLayerCount: afterUndo.layers.length === 1,
      aRefocus,
      aRefocusUndo,
      refocusIsKeyedByLine:
        aRefocus.past === 1 && aRefocus.future === 0 && aRefocusUndo.name === 'SHARED DESIGN',
    }
  }

  // ---- C3 · the parked-history registry, on its own -----------------------
  //
  // A BARE import on purpose, against the rule the rest of this file follows:
  // the block builds its OWN registry with createHistoryRegistry(3), so a second
  // HMR module instance changes nothing here. That is exactly why history.ts
  // exports a factory instead of a module singleton.
  {
    const hist = await import('/src/state/history.ts')
    const reg = hist.createHistoryRegistry(3)
    const stack = (n) => ({ past: Array.from({ length: n }, () => ({})), future: [] })
    reg.save('a', stack(1))
    reg.save('b', stack(2))
    reg.save('c', stack(3))
    reg.save('a', stack(4)) // re-saving 'a' makes it the most RECENT slot…
    reg.save('d', stack(5)) // …so the one evicted here is 'b', not 'a'
    const b = reg.take('b')
    const a = reg.take('a')
    const aTwice = reg.take('a')
    reg.save('e', { past: [], future: [] })
    const e = reg.take('e')
    const dropped = hist.createHistoryRegistry(3)
    dropped.save('x', stack(1))
    dropped.drop('x')
    const sizeBeforeReset = reg.size
    reg.reset()
    out.registry = {
      lruEvictsOldest: b === null,
      reSaveIsMostRecent: a !== null && a.past.length === 4,
      takeRemoves: aTwice === null,
      emptyNotStored: e === null,
      dropForgets: dropped.take('x') === null,
      sizeBeforeReset,
      resetEmpties: reg.size === 0,
      slots: hist.HISTORY_SLOTS,
    }
  }

  // ---- D · per-line size parity (3D decal) + J · the 2D tile --------------
  {
    const gltfCache = new Map()
    const loadFrame = async (garment, sizeId) => {
      const url = calib.CALIBRATION[garment].url
      let scene = gltfCache.get(url)
      if (!scene) {
        scene = (await new GLTFLoader().loadAsync(url)).scene
        gltfCache.set(url, scene)
      }
      scene.updateMatrixWorld(true)
      let src = null
      scene.traverse((o) => {
        if (!src && o.isMesh) src = o
      })
      return frameMod.buildGarmentFrame(garment, src, sizeId)
    }

    const rows = []
    const lines = store.getState().basket.slice(0, 8)
    for (const line of lines) {
      const design = line.design
      const side = 'front'
      const k = printScale.printScaleK(design, line.size)
      const area = render.getAreaSizeIn(design, side, line.size)

      // --- the 2D TILE. Render the real thing THROUGH THE BOARD'S OWN CACHE at
      // a known density, then convert the print rectangle renderMockup draws
      // back into inches via the tile's own scale (its inch extent / its pixel
      // width). That ties three modules together: the art the tile draws, the
      // physical extent the board lays the tile out at, and the graded area
      // everything else quotes.
      const widthPx = 512
      const canvas = await mock.requestMockup(line, side, widthPx).promise
      const extent = mock.mockupExtentIn(design, side, line.size)
      const inPerPx = extent.wIn / canvas.width
      let tilePrintWIn = null
      let tilePrintHIn = null
      if (design.garmentId === 'custom') {
        const setup = design.custom?.[side]
        const ppiOut = widthPx / (design.custom?.widthIn ?? 20)
        tilePrintWIn = setup.printArea.wIn * k * ppiOut * inPerPx
        tilePrintHIn = setup.printArea.hIn * k * ppiOut * inPerPx
      } else {
        const art = garments.GARMENTS[design.garmentId]
        const pa = art.sides[side].printAreaPx
        const s = widthPx / 800
        tilePrintWIn = pa.w * k * s * inPerPx
        tilePrintHIn = pa.h * k * s * inPerPx
      }

      const row = {
        id: line.id,
        name: line.label,
        garment: design.garmentId,
        size: line.size,
        k,
        areaWIn: area.wIn,
        areaHIn: area.hIn,
        tilePrintWIn,
        tilePrintHIn,
        tileAspect: canvas.height / canvas.width,
        extentAspect: extent.hIn / extent.wIn,
        canvasW: canvas.width,
        canvasH: canvas.height,
      }

      if (design.garmentId !== 'custom') {
        const frame = await loadFrame(design.garmentId, line.size)
        const ff = frameMod.fabricFrameFor(design.garmentId, side, frame, area.wIn, area.hIn, k)
        const geo = decal.buildFabricDecal(ff, 0.06, 20, 20)
        const pos = geo.getAttribute('position')
        // Arc length across the decal's top row == the print width in cloth. Also
        // measured at zero lift: a decal held proud of a curved surface is
        // necessarily a little longer, and that term should be the ONLY error.
        const topArc = (attr) => {
          let acc = 0
          for (let i = 1; i <= 20; i++)
            acc += Math.hypot(
              attr.getX(i) - attr.getX(i - 1),
              attr.getY(i) - attr.getY(i - 1),
              attr.getZ(i) - attr.getZ(i - 1),
            )
          return acc
        }
        const flat = decal.buildFabricDecal(ff, 0, 20, 20)
        const arcNoLift = topArc(flat.getAttribute('position'))
        flat.dispose()
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i)
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
        row.decalArcIn = topArc(pos)
        row.decalArcNoLiftIn = arcNoLift
        row.decalHIn = maxY - minY
        row.triangles = geo.getIndex().count / 3
        geo.dispose()
      }
      // Wrong-size control: the same area at the GLOBAL preview size, to show
      // the parity check can actually fail.
      row.wrongSizeAreaWIn = render.getAreaSizeIn(design, side, 'M').wIn
      rows.push(row)
    }
    out.parity = rows

    // The cost the board actually avoids: the single-garment preview paints its
    // print by copying the WHOLE garment mesh into a fabric-UV overlay. Timed
    // here against the board's coarse grid, on the real meshes. Medians of 5:
    // a single sample of a sub-millisecond build is mostly scheduler noise.
    const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const cost = {}
    for (const garment of ['tee', 'hoodie']) {
      const frame = await loadFrame(garment, 'L')
      const ff = frameMod.fabricFrameFor(garment, 'front', frame, 12, 16, 1)
      const decalMs = []
      const overlayMs = []
      let decalTris = 0
      let overlayTris = 0
      for (let i = 0; i < 5; i++) {
        let t0 = performance.now()
        const grid = decal.buildFabricDecal(ff, 0.06, 20, 20)
        decalMs.push(performance.now() - t0)
        t0 = performance.now()
        const overlay = decal.buildFabricOverlay(frame.geometry, ff)
        overlayMs.push(performance.now() - t0)
        decalTris = grid.getIndex().count / 3
        overlayTris = overlay.getIndex().count / 3
        grid.dispose()
        overlay.dispose()
      }
      cost[garment] = {
        decalMs: median(decalMs),
        overlayMs: median(overlayMs),
        decalTris,
        overlayTris,
      }
    }
    out.cost = cost

    // ---- geometry sharing (deterministic, module level) -----------------
    //
    // The board's whole affordability claim: N products of the same (garment,
    // size) upload ONE mesh. Asserted here rather than from a live scene,
    // because a scene only proves what that particular basket happened to hold.
    {
      const cacheMod = await appImport('/src/three/garmentCache.ts')
      const url = calib.CALIBRATION.tee.url
      let scene = gltfCache.get(url)
      if (!scene) {
        scene = (await new GLTFLoader().loadAsync(url)).scene
        gltfCache.set(url, scene)
      }
      cacheMod.disposeBoardGarments()
      const a1 = cacheMod.boardGarmentFrame('tee', 'L', scene)
      const a2 = cacheMod.boardGarmentFrame('tee', 'L', scene)
      const b = cacheMod.boardGarmentFrame('tee', '3XL', scene)
      const m1 = cacheMod.boardGarmentMaterial('tee', '#ff0000', scene)
      const m2 = cacheMod.boardGarmentMaterial('tee', '#ff0000', scene)
      const m3 = cacheMod.boardGarmentMaterial('tee', '#00ff00', scene)
      const stats = cacheMod.boardGarmentStats()
      out.sharing = {
        sameSizeShares: a1 === a2,
        differentSizeDoesNot: a1 !== b && a1.widthIn !== b.widthIn,
        sameColourShares: m1 === m2,
        differentColourDoesNot: m1 !== m3,
        frames: stats.frames,
        materials: stats.materials,
        triangles: stats.triangles,
      }
      cacheMod.disposeBoardGarments()
      out.sharing.freed = cacheMod.boardGarmentStats().frames === 0
    }

    // ---- G · camera framing --------------------------------------------
    //
    // Physically-true inches mean a 3XL hoodie's bounding box is 52.5 in wide,
    // almost all of it arm span. Framing THAT in a narrow portrait pane pushes
    // the camera so far back that the hoodie reads smaller on screen than a tee
    // it dwarfs in real life. The rig must frame the BODY and merely avoid
    // cropping the span.
    const FOV = 26
    const oldFit = (h, aspect, w) => {
      const halfV = Math.tan((FOV * Math.PI) / 360)
      const halfH = halfV * Math.max(aspect, 0.2)
      return Math.max(24, Math.max((h * 1.22) / 2 / halfV, (w * 1.22) / 2 / halfH))
    }
    const panes = [
      { name: 'portrait 390x700', aspect: 390 / 700 },
      { name: 'portrait 520x900', aspect: 520 / 900 },
      { name: 'landscape 1100x740', aspect: 1100 / 740 },
    ]
    const biggest = chartMod.SIZE_IDS[chartMod.SIZE_IDS.length - 1]
    const framing = []
    for (const garment of ['tee', 'hoodie']) {
      const torso = chartMod.garmentWidthInFor(garment, biggest)
      for (const size of ['S', '3XL']) {
        const frame = await loadFrame(garment, size)
        for (const pane of panes) {
          const dOld = oldFit(frame.fitHeightIn, pane.aspect, frame.fitWidthIn)
          const dNew = stage.fitRadius(
            frame.fitHeightIn,
            FOV,
            pane.aspect,
            frame.fitWidthIn,
            torso,
          )
          const halfV = Math.tan((FOV * Math.PI) / 360)
          const halfH = halfV * Math.max(pane.aspect, 0.2)
          framing.push({
            garment,
            size,
            pane: pane.name,
            aspect: pane.aspect,
            torso,
            fitWidthIn: frame.fitWidthIn,
            fitHeightIn: frame.fitHeightIn,
            widthIn: frame.widthIn,
            heightIn: frame.heightIn,
            dOld,
            dNew,
            // Half-extents the frustum shows at that distance.
            visHalfW: halfH * dNew,
            visHalfH: halfV * dNew,
            // How much of the pane's height this SIZE fills.
            fracOld: frame.heightIn / (2 * halfV * dOld),
            fracNew: frame.heightIn / (2 * halfV * dNew),
          })
        }
        frame.geometry.dispose()
      }
    }
    out.framing = framing
  }

  return out
}

// ---------------------------------------------------------------------------
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: process.cwd(),
  stdio: 'ignore',
})
let browser
const done = (code) => {
  try {
    browser?.close()
  } catch {}
  try {
    server.kill('SIGTERM')
  } catch {}
  process.exit(code)
}

try {
  staticChecks()
  await waitFor(BASE)
  browser = await chromium.launch({
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        'tshop:prefs',
        JSON.stringify({ theme: 'dark', lang: 'en', scene: 'studio', previewSize: 'M' }),
      )
    } catch {}
  })
  const page = await context.newPage()
  const errors = []
  let loads = 0
  page.on('load', () => loads++)
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 220)))
  const ready = () =>
    page.waitForFunction(() => window.__tshop && window.__three && window.__gltf, {
      timeout: 45000,
    })

  /**
   * Vite reloads the page whenever anything under src/ changes, and board state
   * is deliberately session-only — so a save landing mid-run destroys the
   * execution context. Retry, re-establishing the board each time.
   */
  const attempt = async (label, fn) => {
    for (let i = 0; i < 4; i++) {
      try {
        return await fn()
      } catch (e) {
        const msg = String(e)
        const reloaded =
          /[Ee]xecution context was destroyed|Target closed|frame was detached/.test(msg) ||
          // The reload landed between `ready()` and the evaluate: the document
          // is new and has not booted yet.
          /Cannot read properties of undefined \(reading '(temporal|getState|board)'\)/.test(msg)
        if (!reloaded) throw e
        console.log(`  … the dev server reloaded the page during "${label}" — retrying`)
        await ready()
        await page.waitForTimeout(1000)
      }
    }
    throw new Error(`too many reloads during ${label}`)
  }

  /** Put the app back on the board (in `mode`), whatever happened before. */
  const ensureBoard = async (mode, focus) => {
    await ready()
    // After a reload the basket rehydrates from idb asynchronously; entering
    // the board first would select nothing and show an empty board.
    await page.waitForFunction(() => window.__tshop.getState().basket.length > 0, {
      timeout: 30000,
    })
    await page.evaluate(
      ([m, wantFocus]) => {
        const st = window.__tshop.getState()
        st.setMode(m)
        if (!st.board.on) st.enterBoard()
        const now = window.__tshop.getState()
        if (wantFocus && !now.board.focusedId) now.focusLine(now.board.selectedIds[0])
        if (!wantFocus && now.board.focusedId) now.unfocusLine()
      },
      [mode, focus],
    )
    await page.waitForTimeout(400)
  }

  const allTilesPainted = () =>
    page.waitForFunction(
      () => {
        const tiles = document.querySelectorAll('.board-tile')
        const painted = document.querySelectorAll('.board-tile canvas')
        return tiles.length > 0 && painted.length === tiles.length
      },
      { timeout: 30000 },
    )

  await page.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 })
  await ready()
  // WARM-UP. Vite pre-bundles dependencies on first sight and then forces a
  // full page reload — which would drop the board's (deliberately session-only)
  // state mid-run. Touch every lazy corner first, then reload once on purpose.
  await page
    .evaluate(async () => {
      await window.__three()
      await window.__gltf()
      await import('/src/three/Board3D.tsx')
      await import('/src/three/Stage.tsx')
      await import('/src/app/board/useBoardTextures.ts')
    })
    .catch(() => {})
  await page.waitForTimeout(2500)
  await page.reload({ waitUntil: 'load', timeout: 60000 })
  await ready()
  await page.waitForTimeout(1200)
  const loadsBefore = loads

  const seeded = await attempt('seeding', () => seedBasket(page, SEEDS))
  const r = await attempt('module checks', () => page.evaluate(inPage))
  await ready()

  console.log('\n=== A · layout math (pure) ===')
  const L = r.layout
  console.log(
    `  6 items, aspect 1.6 → ${L.cols}×${L.rows} of ${L.cellW}×${L.cellH} in (board ${L.width}×${L.height} in)`,
  )
  check(L.deterministic, 'layout is deterministic for identical inputs')
  check(L.overlaps === 0, `no two products overlap (${L.overlaps} overlaps)`)
  check(L.cellFromBiggest, 'cell is sized from the biggest product, not the average')
  check(L.centred, 'every product is centred in its cell')
  check(
    L.wideVsTall.wide >= L.wideVsTall.tall,
    `a wide viewport gets at least as many columns as a tall one (${L.wideVsTall.wide} vs ${L.wideVsTall.tall})`,
  )
  check(L.mobileCap === 2, `the mobile column cap is honoured (got ${L.mobileCap})`)
  check(L.empty === 0, 'an empty board lays out without throwing')

  console.log('\n=== B · texture budget (per side, per product) ===')
  for (const row of r.budget)
    console.log(
      `  n≤${String(row.n).padStart(2)} ${row.mobile ? 'mobile ' : 'desktop'} → ${String(row.px).padStart(4)} px · ${row.perDecalMiB.toFixed(2)} MiB/decal · ${row.totalMiB.toFixed(1)} MiB for ${row.n} products`,
    )
  console.log(
    `  the single-garment target (2048 px) would want ${r.legacy2048MiB.toFixed(0)} MiB for 8 products`,
  )
  const eight = r.budget.find((x) => x.n === 8 && !x.mobile)
  check(eight.totalMiB < 20, `8 desktop products fit in ${eight.totalMiB.toFixed(1)} MiB of decal texture`)
  const eightMobile = r.budget.find((x) => x.n === 8 && x.mobile)
  check(eightMobile.totalMiB < 12, `8 mobile products fit in ${eightMobile.totalMiB.toFixed(1)} MiB`)
  check(r.legacy2048MiB > 200, 'the 2048 px target really is the unviable one (>200 MiB)')

  console.log('\n=== C · store semantics ===')
  const S = r.store
  console.log(`  seeded ${seeded.lines} basket lines (incl. one ship-your-own)`)
  check(S.enterSelectsAll, 'entering the board selects EVERY basket line by default')
  check(S.enterClosesModal, 'entering the board closes the basket modal in the same set()')
  check(S.enterClearsPanel, 'entering the board closes any open tool panel')
  check(S.focusSwapsDesign, 'focusing swaps the line into the live document')
  check(S.focusIsDeepCopy, 'the focused document is a COPY (the basket snapshot is untouched)')
  check(S.focusUsesLineSize, "focusing adopts the LINE's size, not the global preview size")
  console.log(
    `  draft history before focus: ${S.draftDepth.past} undo / ${S.draftDepth.future} redo · after un-focus: ${S.unfocusDepth.past} / ${S.unfocusDepth.future} · parked line slots: ${S.slotsWhileBoardOn}`,
  )
  check(S.focusStartsEmpty, "the first focus of a line starts it on an EMPTY history (never the draft's)")
  check(S.editedHistory > 0, `edits inside the focused line are undoable (${S.editedHistory} entries)`)
  check(S.lineUndoStaysInLine, 'undo inside a focused line rewinds THAT line')
  check(
    S.exhaustedStaysInLine,
    `25 undos inside a focused line bottom out on its own first state ("${S.exhausted.name}"), never the draft`,
  )
  check(S.undoReachesBasket, 'an undo inside a focused line reaches the basket snapshot')
  check(S.flushWritesDesign, 'write-back stores the edited design')
  check(S.flushRederivesLabel, 'write-back re-derives the line label')
  check(S.flushRederivesColor, 'write-back re-derives the colour swatch')
  check(S.flushWritesSize, 'write-back stores the size the user chose while focused')
  check(S.neighbourUntouched, 'writing one line back leaves the other snapshots byte-identical')
  check(S.unfocusRestoresDraft, "un-focusing restores the user's own document")
  check(S.unfocusRestoresSize, "un-focusing restores the user's own preview size")
  check(S.unfocusClearsFocus, 'un-focusing clears focusedId')
  check(S.draftLayersIntact, 'the draft still carries the layer added before focusing')
  check(
    S.historyRestoredOnUnfocus,
    `un-focusing restores the draft's own stacks (${S.draftDepth.past} undo / ${S.draftDepth.future} redo)`,
  )
  check(S.draftUndoWalksOwnEdits, "Ctrl+Z after the board walks the user's OWN edits")
  check(
    S.refocusRestoresLine && S.refocusUndoIsLines,
    're-focusing a line in the same board session restores ITS stack',
  )
  check(S.exitDropsLineHistory, 'leaving the board forgets the lines’ stacks (re-focusing starts clean)')
  check(S.slotsAfterExit === 0, `no parked history survives the board session (${S.slotsAfterExit} slots)`)
  check(
    S.removeDropsHistory,
    `deleting a line drops its parked history with it (${S.slotsBeforeRemove} → ${S.slotsAfterRemove} slots)`,
  )
  check(
    S.historyCheckDiscriminates,
    'control: clearing at that same point drops the restored depth to 0 (the check is not vacuous)',
  )
  check(
    S.reenterUnfocuses,
    'entering the board again while focused hands the document back (no draft overwrite)',
  )
  check(S.removeUnfocuses, 'deleting the focused line hands the document back first')
  check(S.removeDropsSelection, 'deleting a line drops it from the board selection')

  console.log('\n=== C2 · two basket lines cloned from ONE design ===')
  const K2 = r.clones
  check(
    K2.sameDesignId && K2.sameLayerId && K2.differentLineIds,
    'the two lines really do share a design id AND a layer id (only the line ids differ)',
  )
  check(
    K2.gestureCommitWorks,
    'the gesture-commit rewind is live inside one document (control: undo returns to the pre-drag value)',
  )
  check(K2.focusIsCleanDocument, 'focusing the twin starts from ITS snapshot with an empty history')
  check(K2.bKeptItsOwnName, "an interrupted drag on the twin does NOT rewind this line to the other's document")
  check(K2.bTookOnlyItsOwnEdit, 'the edit made on the second line is the only one it received')
  check(K2.aKeptItsOwnEdits, 'the first line kept its own edits (flushed on the focus swap)')
  check(K2.undoStayedInB && K2.undoKeptLayerCount, 'twelve undos cannot walk into the twin document')
  check(
    K2.refocusIsKeyedByLine,
    `the parked history is keyed by LINE id — the twin cannot inherit it (${K2.aRefocus.past} undo / ${K2.aRefocus.future} redo back on line A, rewinding to "${K2.aRefocusUndo.name}")`,
  )

  console.log('\n=== C3 · the parked-history registry (pure, no board) ===')
  const RG = r.registry
  check(RG.lruEvictsOldest, 'the LRU evicts the least recently parked document')
  check(RG.reSaveIsMostRecent, 'parking a document again makes its slot the most recent one')
  check(RG.takeRemoves, 'a stack is REMOVED as it is handed back (the live store owns it after that)')
  check(RG.emptyNotStored, 'an empty stack never takes a slot (it would evict a real one)')
  check(RG.dropForgets, 'dropping a document forgets its history')
  check(RG.resetEmpties, `reset() empties the registry (${RG.sizeBeforeReset} slots → 0)`)
  check(
    RG.slots === 8,
    `HISTORY_SLOTS is ${RG.slots} — the number the ≈0.9 MB worst-case bound was computed for`,
  )

  // ---- C4 · the toolbar follows the swap ----------------------------------
  //
  // useHistoryDepth subscribes to the temporal store, so the two <TopBar>
  // buttons ARE the user-visible face of the swap. Read from the DOM, because
  // "the stacks came back" and "the button came back" are two different claims.
  //
  // The stacks and the BUTTONS are measured separately on purpose, because they
  // are allowed to disagree in exactly one place: while browsing the board the
  // draft's stacks are full but no editable document is on screen, so both
  // buttons must be dead even though the depth is not zero — the same rule
  // useKeyboardShortcuts already applies to Ctrl+Z (section O). A restore that
  // only lights the toolbar back up after exitBoard is the honest one.
  console.log('\n=== C4 · the undo/redo buttons follow the document (DOM) ===')
  const toolbar = await attempt('toolbar buttons', async () => {
    await ensureBoard('2d', false)
    return page.evaluate(async () => {
      const st = () => window.__tshop.getState()
      const t = () => window.__tshop.temporal.getState()
      // TWO frames between a store write and a DOM read: `disabled` is React
      // state, and a read inside the same synchronous evaluate is always stale.
      const settle = () =>
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const depthPair = () => ({ past: t().pastStates.length, future: t().futureStates.length })
      const buttons = () => {
        const q = (label) => document.querySelector(`button[aria-label="${label}"]`)
        return {
          found: !!q('Undo') && !!q('Redo'),
          undo: q('Undo')?.disabled === false,
          redo: q('Redo')?.disabled === false,
        }
      }
      // Count only the notifications where the DEPTH PAIR moved: pause()/resume()
      // notify too, and useHistoryDepth bails out on those (Object.is on the two
      // lengths). A clear()-then-install() swap would score 2 and blink.
      let last = ''
      let flips = 0
      const unsub = window.__tshop.temporal.subscribe((s) => {
        const now = `${s.pastStates.length}/${s.futureStates.length}`
        if (now !== last) flips++
        last = now
      })
      last = `${t().pastStates.length}/${t().futureStates.length}`
      st().addTextLayer('TOOLBAR A')
      st().addTextLayer('TOOLBAR B')
      t().undo()
      await settle()
      const before = { ...buttons(), ...depthPair() }
      flips = 0
      st().focusLine(st().board.selectedIds[0])
      const flipsOnFocus = flips
      await settle()
      const focused = buttons()
      flips = 0
      st().unfocusLine()
      const flipsOnUnfocus = flips
      await settle()
      const after = { ...buttons(), ...depthPair() }
      // A click on the lit-looking button, at the one moment the restore makes
      // it tempting: still on the board, draft stacks full, draft off screen.
      const layersBefore = st().design.layers.length
      const q = (label) => document.querySelector(`button[aria-label="${label}"]`)
      q('Undo').click()
      q('Redo').click()
      await settle()
      const layersAfterClick = st().design.layers.length
      st().exitBoard()
      await settle()
      const off = { ...buttons(), ...depthPair() }
      unsub()
      return { before, focused, after, off, layersBefore, layersAfterClick, flipsOnFocus, flipsOnUnfocus }
    })
  })
  const B = toolbar
  console.log(
    `  browsing ${JSON.stringify(B.before)} → focused ${JSON.stringify(B.focused)} → back ${JSON.stringify(B.after)} → off the board ${JSON.stringify(B.off)}`,
  )
  check(B.before.found, 'the undo and redo buttons are on screen in board mode')
  check(
    B.before.past > 0 && B.before.future > 0 && !B.before.undo && !B.before.redo,
    `browsing the board, the draft's ${B.before.past}/${B.before.future} stacks are intact but BOTH buttons are dead — the toolbar cannot offer to edit an off-screen document`,
  )
  check(!B.focused.undo && !B.focused.redo, 'a freshly focused line offers nothing to undo')
  check(
    B.after.past === B.before.past && B.after.future === B.before.future,
    `un-focusing restores the draft's depth (${B.after.past}/${B.after.future}) — useHistoryDepth saw it`,
  )
  check(
    !B.after.undo && !B.after.redo && B.layersAfterClick === B.layersBefore,
    'and the buttons STAY dead while still on the board: clicking both changes nothing',
  )
  check(
    B.off.undo && B.off.redo && B.off.past === B.before.past,
    'leaving the board lights both buttons again, on the restored stacks',
  )
  check(
    B.flipsOnFocus === 1 && B.flipsOnUnfocus === 1,
    `each swap changes the depth exactly once (${B.flipsOnFocus}/${B.flipsOnUnfocus}) — no disabled frame in between`,
  )
  // C4 ends off the board; every later section re-enters through ensureBoard.

  console.log('\n=== D · per-line size parity (3D decal, 2D tile, graded area) ===')
  for (const row of r.parity) {
    const tileWErrMm = (row.tilePrintWIn - row.areaWIn) * 25.4
    const tileHErrMm = (row.tilePrintHIn - row.areaHIn) * 25.4
    if (row.decalArcIn === undefined) {
      console.log(
        `  ${row.name.padEnd(14)} ${row.garment.padEnd(6)} ${row.size.padStart(3)} k=${row.k.toFixed(3)} · area ${row.areaWIn.toFixed(2)}×${row.areaHIn.toFixed(2)}in · 2D tile ${row.tilePrintWIn.toFixed(2)}×${row.tilePrintHIn.toFixed(2)}in (${tileWErrMm >= 0 ? '+' : ''}${tileWErrMm.toFixed(2)}mm) · no mesh (ship-your-own)`,
      )
    } else {
      const arcErrMm = (row.decalArcIn - row.areaWIn) * 25.4
      const liftErrMm = (row.decalArcNoLiftIn - row.areaWIn) * 25.4
      const hErrMm = (row.decalHIn - row.areaHIn) * 25.4
      console.log(
        `  ${row.name.padEnd(14)} ${row.garment.padEnd(6)} ${row.size.padStart(3)} k=${row.k.toFixed(3)} · area ${row.areaWIn.toFixed(2)}×${row.areaHIn.toFixed(2)}in · 2D tile ${row.tilePrintWIn.toFixed(2)}×${row.tilePrintHIn.toFixed(2)}in (${tileWErrMm >= 0 ? '+' : ''}${tileWErrMm.toFixed(2)}mm) · 3D arc ${row.decalArcIn.toFixed(2)}in (${liftErrMm >= 0 ? '+' : ''}${liftErrMm.toFixed(1)}mm on the surface) · h ${row.decalHIn.toFixed(2)}in (${hErrMm >= 0 ? '+' : ''}${hErrMm.toFixed(1)}mm) · ${row.triangles} tris`,
      )
      if (Math.abs(row.decalHIn - row.areaHIn) > 0.01)
        fail(`${row.name}: 3D decal height is ${hErrMm.toFixed(1)}mm off the graded print area`)
      if (Math.abs(liftErrMm) > 1.5)
        fail(
          `${row.name}: on the surface the decal covers ${liftErrMm.toFixed(1)}mm more cloth than the print is wide`,
        )
      if (Math.abs(arcErrMm) > 4)
        fail(`${row.name}: decal covers ${arcErrMm.toFixed(1)}mm more cloth than the print is wide`)
      if (row.triangles > 1000)
        fail(`${row.name}: board decal is ${row.triangles} triangles (the coarse grid should be ~800)`)
    }
    if (Math.abs(row.tilePrintWIn - row.areaWIn) > 0.01)
      fail(`${row.name}: the 2D TILE prints ${tileWErrMm.toFixed(2)}mm wider than the graded area`)
    if (Math.abs(row.tilePrintHIn - row.areaHIn) > 0.01)
      fail(`${row.name}: the 2D TILE prints ${tileHErrMm.toFixed(2)}mm taller than the graded area`)
    // The tile's own geometry: the physical extent the board lays it out at must
    // be the shape of the bitmap it hosts, or the canvas is stretched to fit.
    const aspectErr = Math.abs(row.tileAspect / row.extentAspect - 1)
    if (aspectErr > 0.01)
      fail(
        `${row.name}: the laid-out tile is ${(aspectErr * 100).toFixed(1)}% off the mockup's real proportions (${row.extentAspect.toFixed(3)} vs ${row.tileAspect.toFixed(3)})`,
      )
  }
  const graded = r.parity.filter((x) => Math.abs(x.k - 1) > 0.01)
  check(graded.length > 0, `${graded.length} lines actually grade away from the base size`)
  const wrongSizeWouldDiffer = r.parity.some((x) => Math.abs(x.areaWIn - x.wrongSizeAreaWIn) > 0.05)
  check(
    wrongSizeWouldDiffer,
    'using the global preview size instead of line.size WOULD change the print — the check has teeth',
  )
  check(
    r.parity.some((x) => x.garment === 'custom'),
    'a ship-your-own product is on the board and measured like the rest',
  )

  console.log('\n=== D2 · what the coarse decal saves (per side, per product) ===')
  for (const [garment, c] of Object.entries(r.cost)) {
    const ratio = c.overlayMs / Math.max(c.decalMs, 0.001)
    console.log(
      `  ${garment.padEnd(6)} board grid ${c.decalMs.toFixed(2)} ms / ${c.decalTris} tris · full-mesh overlay ${c.overlayMs.toFixed(1)} ms / ${c.overlayTris.toLocaleString()} tris (${ratio.toFixed(0)}× )`,
    )
    // Triangles are deterministic; milliseconds are a machine. Assert the
    // structural win and keep the timing as a loose tripwire.
    check(
      c.decalTris <= 1000 && c.overlayTris > 10 * c.decalTris,
      `${garment}: the board's decal is ${c.decalTris} triangles against the overlay's ${c.overlayTris.toLocaleString()}`,
    )
    check(
      c.decalMs < 3,
      `${garment}: building a board decal costs ${c.decalMs.toFixed(2)} ms (budget 3 ms)`,
    )
    if (ratio < 3)
      warn(`${garment}: the overlay is only ${ratio.toFixed(1)}× the decal on this machine`)
  }
  const worst = Object.values(r.cost).reduce((a, b) => (a.overlayMs > b.overlayMs ? a : b))
  console.log(
    `  an 8-product board of the worst case would pay ${(worst.overlayMs * 16).toFixed(0)} ms and ${(worst.overlayTris * 16).toLocaleString()} extra triangles the overlay way; it pays ${(worst.decalMs * 16).toFixed(1)} ms and ${(worst.decalTris * 16).toLocaleString()} instead`,
  )

  console.log('\n=== D3 · shared geometry (the board’s affordability claim) ===')
  const SH = r.sharing
  console.log(
    `  2 sizes + 2 colours → ${SH.frames} geometries (${SH.triangles.toLocaleString()} tris), ${SH.materials} materials`,
  )
  check(SH.sameSizeShares, 'two products of the same (garment, size) share ONE geometry')
  check(SH.differentSizeDoesNot, 'a different size gets its own, correctly rescaled geometry')
  check(SH.sameColourShares && SH.differentColourDoesNot, 'materials are shared per (garment, colour)')
  check(SH.frames === 2 && SH.materials === 2, `nothing extra was uploaded (${SH.frames}/${SH.materials})`)
  check(SH.freed, 'disposing the board frees every shared geometry')

  // ---- G · camera framing -------------------------------------------------
  console.log('\n=== G · camera framing (body, not arm span — and never cropped) ===')
  for (const f of r.framing) {
    const cropW = f.visHalfW < f.fitWidthIn / 2 - 1e-6
    const cropH = f.visHalfH < f.fitHeightIn / 2 - 1e-6
    console.log(
      `  ${f.garment.padEnd(6)} ${f.size.padStart(3)} ${f.pane.padEnd(18)} span ${f.fitWidthIn.toFixed(1)}in body ${f.torso.toFixed(1)}in → d ${f.dOld.toFixed(0)}→${f.dNew.toFixed(0)} in · fills ${(f.fracOld * 100).toFixed(0)}%→${(f.fracNew * 100).toFixed(0)}% of the pane height`,
    )
    if (cropW || cropH)
      fail(
        `${f.garment} ${f.size} in ${f.pane}: the framed distance CROPS the garment (${(f.visHalfW * 2).toFixed(1)}×${(f.visHalfH * 2).toFixed(1)} in visible vs ${f.fitWidthIn.toFixed(1)}×${f.fitHeightIn.toFixed(1)} needed)`,
      )
    if (f.dNew > f.dOld + 1e-6)
      fail(`${f.garment} ${f.size} in ${f.pane}: the new framing is FURTHER away than the old one`)
  }
  // Within one garment the camera must not move between sizes, or the size
  // selector would silently change the viewing distance instead of the garment.
  for (const garment of ['tee', 'hoodie'])
    for (const pane of [...new Set(r.framing.map((f) => f.pane))]) {
      const rows = r.framing.filter((f) => f.garment === garment && f.pane === pane)
      const spread = Math.max(...rows.map((f) => f.dNew)) - Math.min(...rows.map((f) => f.dNew))
      check(
        spread < 1e-6,
        `${garment} in ${pane}: the framed distance is the same for S and 3XL (spread ${spread.toFixed(3)} in)`,
      )
      const s = rows.find((f) => f.size === 'S')
      const big = rows.find((f) => f.size === '3XL')
      check(
        big.fracNew > s.fracNew * 1.05,
        `${garment} in ${pane}: a 3XL really does read bigger than an S (${(s.fracNew * 100).toFixed(0)}% → ${(big.fracNew * 100).toFixed(0)}%)`,
      )
    }
  for (const pane of r.framing.filter((f) => f.garment === 'hoodie' && f.size === '3XL')) {
    const gain = pane.fracNew / pane.fracOld - 1
    if (pane.aspect < 1)
      check(
        gain > 0.12,
        `${pane.pane}: the hoodie gains ${(gain * 100).toFixed(0)}% of on-screen height (arm span no longer sets the distance)`,
      )
    else
      console.log(`  ${pane.pane}: landscape is height-limited already (gain ${(gain * 100).toFixed(0)}%)`)
  }

  // ---- E · the 2D board in the DOM ---------------------------------------
  console.log('\n=== E · 2D board (DOM) ===')
  await attempt('re-seed for the DOM sections', () => seedBasket(page, SEEDS))
  const t0 = Date.now()
  await ensureBoard('2d', false)
  await page.waitForSelector('.board-tile', { timeout: 15000 })
  const firstTile = Date.now() - t0
  await allTilesPainted().catch(() => {})
  const allTiles = Date.now() - t0
  const dom = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.board-tile')]
    const world = document.querySelector('.board-world')
    const buttons = [...document.querySelectorAll('.board-tile-btn')]
    return {
      tiles: tiles.length,
      canvases: document.querySelectorAll('.board-tile canvas').length,
      roving: buttons.filter((b) => b.getAttribute('tabindex') === '0').length,
      labelled: buttons.filter((b) => (b.getAttribute('aria-label') || '').length > 8).length,
      checkboxes: document.querySelectorAll('.board-tile-check input[type=checkbox]').length,
      transform: world?.style.transform ?? '',
      touchAction: getComputedStyle(document.querySelector('.board-viewport')).touchAction,
      liveRegions: document.querySelectorAll('[aria-live="polite"]').length,
      canvasBytes: [...document.querySelectorAll('.board-tile canvas')].reduce(
        (n, c) => n + c.width * c.height * 4,
        0,
      ),
      // The laid-out tile against the bitmap it hosts: a mismatch is a stretched
      // product, which is exactly what a "true relative scale" board must not do.
      worstStretch: tiles.reduce((worst, li) => {
        const c = li.querySelector('canvas')
        if (!c || !c.width) return worst
        const rect = { w: parseFloat(li.style.width), h: parseFloat(li.style.height) }
        const err = Math.abs(rect.h / rect.w / (c.height / c.width) - 1)
        return err > worst.err ? { err, name: li.textContent.slice(0, 24) } : worst
      }, { err: 0, name: '' }),
    }
  })
  console.log(
    `  ${dom.tiles} tiles · first painted ${firstTile} ms · all painted ${allTiles} ms · ${(dom.canvasBytes / 1048576).toFixed(1)} MB of tile canvas`,
  )
  check(dom.tiles === seeded.lines, `every selected line has a tile (${dom.tiles})`)
  check(dom.canvases === dom.tiles, `every tile painted its mockup (${dom.canvases}/${dom.tiles})`)
  check(dom.roving === 1, `exactly one tile holds the roving tabindex (${dom.roving})`)
  check(dom.labelled === dom.tiles, 'every tile button has a descriptive accessible name')
  check(dom.checkboxes === dom.tiles, 'every tile has its own membership checkbox')
  check(dom.touchAction === 'none', `the viewport owns touch gestures (touch-action: ${dom.touchAction})`)
  check(dom.liveRegions >= 1, 'a polite live region narrates focus changes')
  check(/scale\(/.test(dom.transform), 'the board pans/zooms through one composited transform')
  check(
    dom.worstStretch.err < 0.01,
    `no tile is stretched (worst ${(dom.worstStretch.err * 100).toFixed(1)}% on "${dom.worstStretch.name.trim()}")`,
  )
  if (firstTile > 1500) warn(`first tile took ${firstTile} ms (budget 1500 ms under a dev server)`)
  if (allTiles > 6000) warn(`all tiles took ${allTiles} ms`)
  check(
    dom.canvasBytes < 40 * 1048576,
    `tile canvases stay under 40 MB (${(dom.canvasBytes / 1048576).toFixed(1)} MB)`,
  )

  // pan + wheel zoom through the same path a user takes
  const before = await page.evaluate(() => document.querySelector('.board-world').style.transform)
  // Start the drag ON a product: the point is that a pan which happens to end
  // over a tile must not be mistaken for a click on it.
  const tileBox = await page.locator('.board-tile-btn').first().boundingBox()
  await page.mouse.move(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tileBox.x + tileBox.width / 2 - 90, tileBox.y + tileBox.height / 2 - 60, {
    steps: 8,
  })
  await page.mouse.up()
  const afterPan = await page.evaluate(() => document.querySelector('.board-world').style.transform)
  await page.mouse.wheel(0, -240)
  await page.waitForTimeout(120)
  const afterZoom = await page.evaluate(() => document.querySelector('.board-world').style.transform)
  check(before !== afterPan, 'dragging pans the board')
  check(afterPan !== afterZoom, 'the wheel zooms the board')
  const stillBrowsing = await page.evaluate(() => window.__tshop.getState().board.focusedId)
  check(stillBrowsing === null, 'a pan that ends on a product does NOT open it')

  // A pointer NEVER lands and lifts on the same pixel. A tap with 2 px of
  // wobble is a tap; it must still open the product.
  const wobble = await attempt('tap slop', async () => {
    await ensureBoard('2d', false)
    await page.waitForSelector('.board-tile-btn', { timeout: 20000 })
    const box = await page.locator('.board-tile-btn').first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 1, { steps: 2 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    return page.evaluate(() => window.__tshop.getState().board.focusedId)
  })
  check(wobble !== null, 'a tap with 2 px of wobble still opens the product')

  // Keyboard: arrows rove, Space selects, Enter opens. The checkbox is out of
  // the tab order on purpose (one Tab must leave the board), so Space has to be
  // handled on the tile itself or membership becomes mouse-only.
  const keyboard = await attempt('keyboard navigation', async () => {
    await ensureBoard('2d', false)
    await page.waitForSelector('.board-tile-btn', { timeout: 20000 })
    await page.evaluate(() => document.querySelector('.board-tile-btn[tabindex="0"]')?.focus())
    const first = await page.evaluate(
      () => document.activeElement?.getAttribute('data-board-tile') ?? null,
    )
    await page.keyboard.press('ArrowRight')
    const afterRight = await page.evaluate(
      () => document.activeElement?.getAttribute('data-board-tile') ?? null,
    )
    const before = await page.evaluate(() => window.__tshop.getState().board.selectedIds.length)
    await page.keyboard.press('Space')
    await page.waitForTimeout(250)
    const after = await page.evaluate(() => ({
      selected: window.__tshop.getState().board.selectedIds.length,
      focusedId: window.__tshop.getState().board.focusedId,
    }))
    return { first, afterRight, before, after }
  })
  check(
    keyboard.afterRight !== null && keyboard.afterRight !== keyboard.first,
    'arrow keys move the roving focus between products',
  )
  check(
    keyboard.after.selected === keyboard.before - 1,
    `Space removes a product from the board (${keyboard.before} → ${keyboard.after.selected})`,
  )
  check(keyboard.after.focusedId === null, 'Space does NOT open the product (Enter does)')
  await page.evaluate(() =>
    window.__tshop.getState().setBoardSelection(window.__tshop.getState().basket.map((l) => l.id)),
  )
  await page.waitForTimeout(400)

  // click to focus, then back
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('tshop:zoom', { detail: 'fit' }))
  })
  await page.waitForTimeout(320)
  await page.click('.board-tile-btn')
  await page.waitForTimeout(600)
  const focusState = await page.evaluate(() => {
    const st = window.__tshop.getState()
    return {
      focusedId: st.board.focusedId,
      hasBoardTiles: document.querySelectorAll('.board-tile').length,
      arButtons: [...document.querySelectorAll('button')].filter((b) =>
        /(view in ar|voir en ra)/i.test(b.textContent || ''),
      ).length,
      rail: [...document.querySelectorAll('nav button')]
        .filter((b) => b.getBoundingClientRect().width > 8)
        .map((b) => b.disabled),
    }
  })
  check(focusState.focusedId !== null, 'clicking a product focuses it')
  check(focusState.hasBoardTiles === 0, 'the board yields to the real editor while focused')
  check(focusState.arButtons === 0, 'no AR call to action anywhere in board mode')
  check(
    focusState.rail.length > 0 && focusState.rail.every((d) => !d),
    `every tool comes back on when a product is focused (${focusState.rail.length} live buttons)`,
  )

  // ---- O · the board is NOT an editor while unfocused ---------------------
  console.log('\n=== O · the unfocused board is read-only ===')
  const readOnly = await attempt('read-only board', async () => {
    await ensureBoard('2d', false)
    await page.waitForSelector('.board-tile-btn', { timeout: 20000 })
    await page.evaluate(() => {
      const st = window.__tshop.getState()
      window.__probe = {
        design: JSON.stringify(st.design),
        basket: JSON.stringify(st.basket),
      }
      document.body.focus()
    })
    for (const key of ['Delete', 'Backspace', 't', 'Control+z', 'Control+d', 'ArrowLeft'])
      await page.keyboard.press(key)
    await page.waitForTimeout(400)
    // The POINTER is the other door to the same actions, and the only one the
    // keyboard handler cannot close: click every toolbar button that edits.
    await page.evaluate(() => {
      for (const label of ['Undo', 'Redo'])
        document.querySelector(`button[aria-label="${label}"]`)?.click()
    })
    await page.waitForTimeout(200)
    // …and the tool panels must refuse to open even if something asks.
    await page.evaluate(() => window.__tshop.getState().setPanel('text'))
    await page.waitForTimeout(200)
    return page.evaluate(() => {
      const st = window.__tshop.getState()
      // Only the rail that is actually on screen: the phone nav is display:none
      // on a desktop viewport, and a hidden button proves nothing either way.
      const rail = [...document.querySelectorAll('nav button')].filter(
        (b) => b.getBoundingClientRect().width > 8,
      )
      const locked = rail.filter((b) => b.disabled)
      return {
        designUnchanged: JSON.stringify(st.design) === window.__probe.design,
        basketUnchanged: JSON.stringify(st.basket) === window.__probe.basket,
        selectedId: st.selectedId,
        // PanelHost and PropertiesPanel are the only <aside>s in the app.
        panelOpen: document.querySelectorAll('aside').length,
        railTotal: rail.length,
        railLocked: locked.length,
        railAria: locked.every((b) => b.getAttribute('aria-disabled') === 'true'),
        // FOUND is reported separately: the aria-label is the ENGLISH string
        // this run seeds into prefs, and a miss would leave the click above
        // clicking nothing — a vacuous pass instead of a loud failure.
        historyFound: ['Undo', 'Redo'].every(
          (l) => !!document.querySelector(`button[aria-label="${l}"]`),
        ),
        historyLocked: ['Undo', 'Redo'].every(
          (l) => document.querySelector(`button[aria-label="${l}"]`)?.disabled === true,
        ),
      }
    })
  })
  check(readOnly.designUnchanged, 'neither a shortcut nor a toolbar click can mutate the design from the board')
  check(
    readOnly.historyFound && readOnly.historyLocked,
    'the undo and redo buttons are disabled while browsing, like the tools beside them',
  )
  check(readOnly.basketUnchanged, 'no keyboard shortcut can mutate the basket from the board')
  check(readOnly.selectedId === null, 'nothing is selectable on the board')
  check(
    readOnly.railLocked >= 5,
    `every tool tab is disabled while browsing (${readOnly.railLocked} of ${readOnly.railTotal} visible rail buttons)`,
  )
  check(readOnly.railAria, 'disabled tools are aria-disabled too')
  check(
    readOnly.railTotal === focusState.rail.length,
    `the tools are DISABLED, not hidden: the same ${readOnly.railTotal} buttons are on screen focused or not`,
  )
  check(readOnly.panelOpen === 0, 'no tool panel can float over the board')

  // ---- H · data loss ------------------------------------------------------
  console.log('\n=== H · the user’s own draft survives (reload while focused) ===')
  const reloadCase = async (label, prep) => {
    await attempt(label, async () => {
      await ready()
      await page.waitForFunction(() => window.__tshop.getState().basket.length > 0, {
        timeout: 30000,
      })
      await page.evaluate(prep)
    })
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: 'load', timeout: 60000 })
    await ready()
    await page.waitForFunction(() => window.__tshop.getState().hydrated, { timeout: 30000 })
    await page.waitForFunction(() => window.__tshop.getState().basket.length > 0, { timeout: 30000 })
    return page.evaluate(async () => {
      const appImport = (path) => {
        const fetched = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes(path))
        return import(fetched.find((n) => n.includes('?t=')) ?? fetched[0] ?? path)
      }
      const storeMod = await appImport('/src/state/store.ts')
      const st = window.__tshop.getState()
      return {
        design: st.design.name,
        boardOn: st.board.on,
        focusedId: st.board.focusedId,
        lines: st.basket.map((l) => l.design.name),
        // History is session state exactly like `board`: nothing about it is
        // persisted, so a reload must land on an empty stack and an empty
        // registry — a parked stack that outlived the tab could only reattach to
        // a document another tab has since edited or deleted.
        past: window.__tshop.temporal.getState().pastStates.length,
        slots: storeMod.parkedHistorySlots(),
      }
    })
  }

  // 1. The ordinary case: draft saved, THEN a line is focused and edited.
  const settled = await reloadCase('reload while focused', () => {
    const st = () => window.__tshop.getState()
    if (st().board.on) st().exitBoard()
    st().newDesign()
    st().renameDesign('DRAFT SETTLED')
  })
  check(
    settled.design === 'DRAFT SETTLED',
    `a reload restores the user's OWN draft, not the line (got "${settled.design}")`,
  )
  const edited = await reloadCase('reload after a focused edit', () => {
    const st = () => window.__tshop.getState()
    st().enterBoard()
    st().focusLine(st().board.selectedIds[1])
    st().renameDesign('LINE EDITED WHILE FOCUSED')
  })
  check(
    edited.design === 'DRAFT SETTLED',
    `editing a focused line does not become the draft (got "${edited.design}")`,
  )
  check(
    edited.lines.includes('LINE EDITED WHILE FOCUSED'),
    'the focused edit reached the basket in idb (it survived the reload)',
  )
  check(!edited.boardOn, 'board mode does not survive a reload (session state, by design)')
  check(
    edited.past === 0 && edited.slots === 0,
    `undo history and parked stacks do not survive a reload either (${edited.past} entries, ${edited.slots} slots)`,
  )

  // 2. The race: the focus lands INSIDE the draft's own 700 ms debounce, so the
  //    pending write is still queued when the guard starts refusing writes.
  const raced = await reloadCase('autosave debounce race', () => {
    const st = () => window.__tshop.getState()
    if (st().board.on) st().exitBoard()
    st().newDesign()
    st().renameDesign('DRAFT INSIDE THE DEBOUNCE')
    // No await, no timeout: this is the same tick.
    st().enterBoard()
    st().focusLine(st().board.selectedIds[2])
    st().renameDesign('LINE STOLE THE DRAFT')
  })
  check(
    raced.design === 'DRAFT INSIDE THE DEBOUNCE',
    `a focus inside the 700 ms debounce still saves the draft (got "${raced.design}")`,
  )

  // ---- K · write-back loses nothing, including the last keystroke ---------
  console.log('\n=== K · write-back (memory + idb, no debounce grace) ===')
  const writeBack = await attempt('write-back', async () => {
    await ensureBoard('2d', true)
    return page.evaluate(async () => {
      const readBasket = () =>
        new Promise((res) => {
          const req = indexedDB.open('keyval-store')
          req.onsuccess = () => {
            try {
              const tx = req.result.transaction('keyval', 'readonly')
              const g = tx.objectStore('keyval').get('tshop:basket')
              g.onsuccess = () => res(g.result ?? null)
              g.onerror = () => res(null)
            } catch {
              res(null)
            }
          }
          req.onerror = () => res(null)
        })
      const st = () => window.__tshop.getState()
      const id = st().board.focusedId
      // The "last keystroke": a mutation and an IMMEDIATE unfocus, with no time
      // for the 700 ms mirror to fire.
      st().renameDesign('LAST KEYSTROKE')
      st().setColor('red')
      st().setPreviewSize('3XL')
      st().unfocusLine()
      const line = st().basket.find((l) => l.id === id)
      await new Promise((r) => setTimeout(r, 900))
      const stored = (await readBasket())?.find((l) => l.id === id)
      return {
        memoryName: line?.design.name ?? null,
        memoryLabel: line?.label ?? null,
        memorySize: line?.size ?? null,
        storedName: stored?.design.name ?? null,
        storedSize: stored?.size ?? null,
        storedColor: stored?.design.colorId ?? null,
        draftUntouched: st().design.name,
      }
    })
  })
  console.log(
    `  memory "${writeBack.memoryName}" (${writeBack.memorySize}) · idb "${writeBack.storedName}" (${writeBack.storedSize}, ${writeBack.storedColor})`,
  )
  check(writeBack.memoryName === 'LAST KEYSTROKE', 'unfocusing flushes the last edit into the line')
  check(writeBack.memoryLabel === 'LAST KEYSTROKE', 'the line label is re-derived on that flush')
  check(writeBack.memorySize === '3XL', 'the size chosen while focused is written back')
  check(writeBack.storedName === 'LAST KEYSTROKE', 'the same edit reached idb')
  check(writeBack.storedSize === '3XL' && writeBack.storedColor === 'red', 'idb has the size and the colour')
  check(writeBack.draftUntouched !== 'LAST KEYSTROKE', "the user's own document is not the line")

  // The autosave guard: editing a focused line must not touch tshop:current.
  const autosave = await attempt('autosave guard', async () => {
    await ensureBoard('2d', true)
    return page.evaluate(async () => {
      const readCurrent = () =>
        new Promise((res) => {
          const req = indexedDB.open('keyval-store')
          req.onsuccess = () => {
            try {
              const tx = req.result.transaction('keyval', 'readonly')
              const g = tx.objectStore('keyval').get('tshop:current')
              g.onsuccess = () => res(g.result ?? null)
              g.onerror = () => res(null)
            } catch {
              res(null)
            }
          }
          req.onerror = () => res(null)
        })
      const before = await readCurrent()
      const st = window.__tshop.getState()
      st.renameDesign('FOCUSED EDIT ' + Date.now())
      await new Promise((r) => setTimeout(r, 1500))
      const after = await readCurrent()
      const live = window.__tshop.getState()
      const line = live.basket.find((l) => l.id === live.board.focusedId)
      return {
        currentUnchanged: (before?.name ?? null) === (after?.name ?? null),
        currentName: after?.name ?? null,
        lineName: line?.design.name ?? null,
        liveName: live.design.name,
      }
    })
  })
  console.log(
    `  tshop:current = ${JSON.stringify(autosave.currentName)} · basket line = ${JSON.stringify(autosave.lineName)}`,
  )
  check(autosave.currentUnchanged, "editing a focused line does NOT overwrite the user's autosaved draft")
  check(
    autosave.lineName === autosave.liveName,
    'the focused edit is mirrored into the basket line within the debounce',
  )

  const backOnBoard = await attempt('return to the board', async () => {
    await ensureBoard('2d', false)
    await page.waitForTimeout(600)
    return page.evaluate(() => document.querySelectorAll('.board-tile').length)
  })
  check(backOnBoard > 0, 'un-focusing returns to the board')

  // ---- N · mobile + Escape ------------------------------------------------
  console.log('\n=== N · mobile (tap, pinch) and Escape ===')
  await page.setViewportSize({ width: 390, height: 780 })
  await page.waitForTimeout(600)
  const mobile = await attempt('mobile board', async () => {
    await ensureBoard('2d', false)
    await page.waitForSelector('.board-tile-btn', { timeout: 20000 })
    await allTilesPainted().catch(() => {})
    const cols = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.board-tile')]
      const tops = new Set(tiles.map((t) => Math.round(parseFloat(t.style.top))))
      return { tiles: tiles.length, rows: tops.size }
    })
    // Pinch, dispatched as real pointer events (the board listens to pointers,
    // not to a gesture library).
    const pinch = await page.evaluate(() => {
      const host = document.querySelector('.board-viewport')
      const world = document.querySelector('.board-world')
      const before = world.style.transform
      const send = (type, id, x, y, target) =>
        (target ?? window).dispatchEvent(
          new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true }),
        )
      send('pointerdown', 11, 150, 300, host)
      send('pointerdown', 12, 250, 300, host)
      send('pointermove', 11, 100, 300)
      send('pointermove', 12, 300, 300)
      send('pointerup', 11, 100, 300)
      send('pointerup', 12, 300, 300)
      const after = world.style.transform
      const scale = (s) => parseFloat((s.match(/scale\(([\d.]+)\)/) || [0, '1'])[1])
      return { changed: before !== after, grew: scale(after) > scale(before) }
    })
    // Measured BEFORE the tap: the phone's tool bar must be locked while the
    // board is what the user is looking at.
    const bottomNav = await page.evaluate(() => {
      const nav = [...document.querySelectorAll('nav')].find(
        (n) => getComputedStyle(n).position === 'fixed',
      )
      const tabs = nav ? [...nav.querySelectorAll('button')] : []
      return {
        tabs: tabs.length,
        disabled: tabs.filter((b) => b.disabled).length,
        aria: tabs.filter((b) => b.getAttribute('aria-disabled') === 'true').length,
        visible: tabs.filter((b) => b.getBoundingClientRect().width > 8).length,
      }
    })
    // Tap (finger jitter included) opens a product.
    const box = await page.locator('.board-tile-btn').first().boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 2, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(700)
    const focused = await page.evaluate(() => window.__tshop.getState().board.focusedId)
    // Escape unwinds one level at a time.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const afterEsc1 = await page.evaluate(() => ({
      focusedId: window.__tshop.getState().board.focusedId,
      on: window.__tshop.getState().board.on,
    }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const afterEsc2 = await page.evaluate(() => window.__tshop.getState().board.on)
    return { cols, pinch, focused, afterEsc1, afterEsc2, bottomNav }
  })
  check(mobile.cols.rows >= Math.ceil(mobile.cols.tiles / 2), 'the phone board is at most 2 columns wide')
  check(mobile.pinch.changed && mobile.pinch.grew, 'two fingers pinch-zoom the board')
  check(mobile.focused !== null, 'a tap (with finger jitter) opens a product on a phone')
  check(
    mobile.afterEsc1.focusedId === null && mobile.afterEsc1.on,
    'Escape leaves the focused product and returns to the board',
  )
  check(mobile.afterEsc2 === false, 'a second Escape leaves the board')
  console.log(
    `  phone bottom nav: ${mobile.bottomNav.disabled} of ${mobile.bottomNav.tabs} tabs disabled, ${mobile.bottomNav.visible} on screen`,
  )
  check(
    mobile.bottomNav.disabled >= 5 && mobile.bottomNav.aria === mobile.bottomNav.disabled,
    'the phone tool bar is disabled (and aria-disabled) while browsing the board',
  )
  check(
    mobile.bottomNav.visible === mobile.bottomNav.tabs,
    'the phone tool bar stays on screen — disabled, not hidden',
  )
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(600)

  // ---- F · the 3D board ---------------------------------------------------
  console.log('\n=== F · 3D board ===')
  const t3 = Date.now()
  // The board's own first-frame signal, not a guess. Generous, because the
  // first frame under SwiftShader is dominated by shader compilation and the
  // env-map bake — both CPU-bound here and both free on a real GPU.
  await attempt('3D board first frame', async () => {
    await ensureBoard('3d', false)
    // `attached`, not `visible`: the product list is sr-only (a 1px clipped
    // box), which is precisely the shape Playwright's visibility heuristic is
    // least reliable about.
    await page.waitForSelector('ul.sr-only button', { state: 'attached', timeout: 60000 })
    await page.waitForSelector('[data-board3d-ready]', { state: 'attached', timeout: 240000 })
  }).catch(async (e) => {
    console.log(
      '  diagnostic:',
      JSON.stringify(
        await page.evaluate(() => {
          const st = window.__tshop?.getState?.()
          return {
            mode: st?.mode,
            board: st?.board,
            basket: st?.basket.length,
            srButtons: document.querySelectorAll('ul.sr-only button').length,
            canvases: document.querySelectorAll('canvas').length,
          }
        }),
      ),
    )
    throw e
  })
  const firstFrame = Date.now() - t3
  await page.waitForTimeout(8000)
  const three = await attempt('3D board probe', () =>
    page.evaluate(async () => {
      const appImport = (path) => {
        const fetched = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes(path))
        return import(fetched.find((n) => n.includes('?t=')) ?? fetched[0] ?? path)
      }
      const cache = await appImport('/src/three/garmentCache.ts')
      const tex = await appImport('/src/app/board/useBoardTextures.ts')
      const mock = await appImport('/src/app/board/mockupCache.ts')
      const boardMod = await import('/src/state/board.ts')
      // What the LIVE scene actually holds — the static grep only covers files
      // it was told about, and GPU bytes are a property of the textures the
      // renderer uploaded, not of the cache that made them.
      const scene = window.__board3d?.scene
      const geo = {
        meshes: 0,
        triangles: 0,
        worst: 0,
        worstName: '',
        decalLike: 0,
        heavy: 0,
        grids: 0,
        gridBlank: 0,
      }
      const images = new Map()
      const heavyGeometries = new Set()
      scene?.traverse((o) => {
        if (!o.isMesh) return
        geo.meshes++
        const g = o.geometry
        // A print grid with a zeroed canvas is a garment wearing nothing: the
        // texture cache freed pixels the scene is still sampling.
        {
          const t = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3
          if (t === 800) {
            geo.grids++
            const m = Array.isArray(o.material) ? o.material[0] : o.material
            const img = m?.map?.image
            if (!img || !img.width || !img.height) geo.gridBlank++
          }
        }
        const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3
        geo.triangles += tris
        // "Heavy" = anything that is not a coarse decal grid, a hit proxy or a
        // billboard. Exactly one per solid garment is expected; a <Decal> board
        // would show three times as many (a clipped hoodie decal is 32k tris,
        // which a plain "biggest mesh" ceiling would not catch).
        if (tris > 1000) {
          geo.heavy++
          heavyGeometries.add(g)
        }
        if (tris > geo.worst) {
          geo.worst = tris
          geo.worstName = o.parent?.name || o.name || g?.type || '?'
        }
        if (/decalgeometry/i.test(g?.constructor?.name ?? '')) geo.decalLike++
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats)
          for (const key of ['map', 'normalMap', 'roughnessMap'])
            if (m?.[key]?.image) images.set(m[key].image, m[key])
      })
      let gpuBytes = 0
      for (const [img, t] of images) {
        const w = img.width ?? img.naturalWidth ?? 0
        const h = img.height ?? img.naturalHeight ?? 0
        gpuBytes += w * h * 4 * (t.generateMipmaps === false ? 1 : 4 / 3)
      }
      geo.uniqueHeavy = heavyGeometries.size
      return {
        stats: cache.boardGarmentStats(),
        textureBytes: tex.boardTextureBytes(),
        textureCount: tex.boardTextureCount(),
        mockupBytes: mock.mockupCacheBytes(),
        cap: boardMod.boardCap3D(false),
        srList: document.querySelectorAll('ul.sr-only button').length,
        canvases: document.querySelectorAll('canvas').length,
        capNote: [...document.querySelectorAll('p')].some((p) => /3D/.test(p.textContent || '')),
        geo,
        gpuBytes,
        rendererTextures: window.__board3d?.gl?.info?.memory?.textures ?? -1,
        // Diagnostic: the module-level counters above are read through a
        // dynamic import, which only agrees with the running app while both
        // resolve to the SAME url. Listing what was actually fetched keeps a
        // disagreement explainable instead of mysterious.
        moduleUrls: performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => /garmentCache|useBoardTextures|mockupCache/.test(n))
          .map((n) => n.replace(/^https?:\/\/[^/]+/, '')),
      }
    }),
  )
  console.log(
    `  first frame in ${firstFrame} ms (software GL) · ${three.stats.frames} shared geometries (${three.stats.triangles.toLocaleString()} tris total, ${three.stats.materials} materials)`,
  )
  console.log(
    `  the SCENE holds ${(three.gpuBytes / 1048576).toFixed(1)} MiB across ${three.rendererTextures} uploaded textures · ${three.geo.grids} print grids (${three.geo.gridBlank} blank) · 2D tile canvases ${(three.mockupBytes / 1048576).toFixed(1)} MB · module cache says ${three.textureCount} print canvases / ${(three.textureBytes / 1048576).toFixed(1)} MiB`,
  )
  console.log(
    `  scene: ${three.geo.meshes} meshes, ${three.geo.triangles.toLocaleString()} tris, heaviest ${three.geo.worst.toLocaleString()} ("${three.geo.worstName}")`,
  )
  console.log(`  board module urls fetched: ${three.moduleUrls.join(' | ') || '(none)'}`)
  check(three.canvases > 0, 'the 3D board mounted a WebGL canvas')
  check(
    three.geo.uniqueHeavy > 0 && three.geo.uniqueHeavy <= 12,
    `the wall holds ${three.geo.uniqueHeavy} distinct garment meshes for ${seeded.lines} products (the cache holds ${three.stats.frames})`,
  )
  check(
    three.stats.frames > 0 && three.stats.frames <= 12,
    `the shared-geometry cache holds ${three.stats.frames} frames and ${three.stats.materials} materials`,
  )
  check(
    three.textureBytes < 24 * 1048576,
    `print textures stay inside the budget (${(three.textureBytes / 1048576).toFixed(1)} MiB across ${three.textureCount} canvases)`,
  )
  check(
    three.textureCount <= three.cap * 2,
    `only the ${three.cap} solid products got print textures (${three.textureCount} ≤ ${three.cap * 2})`,
  )
  // Measured from the SCENE, not from the cache that made it: what matters is
  // what the renderer is sampling, and only the scene can say so.
  check(
    three.gpuBytes < 64 * 1048576,
    `everything the scene uploaded fits in ${(three.gpuBytes / 1048576).toFixed(1)} MiB`,
  )
  check(
    three.geo.grids >= 6 && three.geo.gridBlank === 0,
    `every print on the wall has live pixels (${three.geo.grids} grids, ${three.geo.gridBlank} blank)`,
  )
  check(three.geo.decalLike === 0, 'no DecalGeometry exists in the live board scene')
  check(
    three.geo.heavy <= three.cap,
    `only the ${three.cap} garment meshes are heavy — every print is a coarse grid (${three.geo.heavy} meshes over 1k tris)`,
  )
  check(three.srList === seeded.lines, `the canvas has a screen-reader product list (${three.srList} buttons)`)
  check(three.capNote, 'the board says how many products degraded to flat previews')
  if (firstFrame > 45000) warn(`the 3D board took ${firstFrame} ms to first frame (software GL)`)

  // ---- L · picking --------------------------------------------------------
  console.log('\n=== L · picking (a pointer move must not raycast the garments) ===')
  const picking = await attempt('picking', async () => {
    await page.evaluate(async () => {
      const THREE = await window.__three()
      const probe = { calls: 0, worst: 0, worstName: '' }
      window.__pick = probe
      const orig = THREE.Mesh.prototype.raycast
      window.__pickRestore = () => {
        THREE.Mesh.prototype.raycast = orig
      }
      THREE.Mesh.prototype.raycast = function (...args) {
        const g = this.geometry
        const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3
        probe.calls++
        if (tris > probe.worst) {
          probe.worst = tris
          probe.worstName = this.parent?.name || this.name || '?'
        }
        return orig.apply(this, args)
      }
    })
    const box = await page.locator('main canvas').first().boundingBox()
    for (let i = 0; i < 12; i++)
      await page.mouse.move(box.x + 80 + i * 30, box.y + box.height / 2 + (i % 3) * 20)
    await page.waitForTimeout(500)
    return page.evaluate(() => {
      const p = window.__pick
      window.__pickRestore?.()
      return p
    })
  })
  console.log(
    `  ${picking.calls} raycasts across 12 pointer moves · heaviest mesh tested: ${picking.worst} tris ("${picking.worstName}")`,
  )
  check(picking.calls > 0, 'pointer moves really do reach the raycaster (the probe is live)')
  check(
    picking.worst <= 64,
    `only low-poly hit proxies are raycast (heaviest ${picking.worst} tris — a hoodie would be 67,609)`,
  )

  // The point of frameloop="demand": once settled, an untouched board must cost
  // nothing. Under this same software renderer the single-garment preview (a
  // continuous loop with sway) manages ~0.7 fps, so an idle board that keeps up
  // with rAF is proof the loop really is off.
  const idle = await attempt('idle frameloop', () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const t0 = performance.now()
          let n = 0
          const tick = () => {
            if (++n > 90) return res(performance.now() - t0)
            requestAnimationFrame(tick)
          }
          tick()
        }),
    ),
  )
  console.log(`  90 animation frames on an untouched board: ${idle.toFixed(0)} ms`)
  check(idle < 5000, `an idle board does not render (${(90000 / idle).toFixed(0)} rAF/s)`)

  const focus3d = await page.evaluate(() => {
    const btn = document.querySelector('ul.sr-only button')
    btn?.click()
    return window.__tshop.getState().board.focusedId
  })
  check(focus3d !== null, 'the screen-reader product list focuses a product')
  const focused3dStage = await page.evaluate(
    () => document.querySelectorAll('ul.sr-only button').length,
  )
  check(focused3dStage === 0, 'focusing from 3D shows that ONE product, not the board')

  // ---- M · degradation ----------------------------------------------------
  console.log('\n=== M · degradation (over the cap, purged uploads, empty basket) ===')
  const overCap = await attempt('over the cap', async () => {
    // 30 lines: past the 3D cap of 8 AND past the tile cache's 24 entries, so
    // the billboards' canvases are exactly the ones the LRU would zero.
    await page.evaluate(() => {
      const st = () => window.__tshop.getState()
      if (st().board.on) st().exitBoard()
      // Added through the public path so ids and timestamps are real.
      st().newDesign()
      st().renameDesign('BULK')
      st().addTextLayer('BULK')
      for (let i = 0; i < 30; i++) window.__tshop.getState().addToBasket()
    })
    await ensureBoard('3d', false)
    await page.waitForSelector('[data-board3d-ready]', { state: 'attached', timeout: 240000 })
    // Billboards arrive one per frame (deliberately — see the mockup queue), so
    // wait for the wall to be complete rather than sampling it half-built.
    await page
      .waitForFunction(
        () => {
          const scene = window.__board3d?.scene
          if (!scene) return false
          const st = window.__tshop.getState()
          const want = st.board.selectedIds.length - 8
          let planes = 0
          scene.traverse((o) => {
            if (o.isMesh && o.geometry?.type === 'PlaneGeometry') planes++
          })
          return planes >= want
        },
        { timeout: 120000 },
      )
      .catch(() => {})
    return page.evaluate(async () => {
      const appImport = (path) => {
        const fetched = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes(path))
        return import(fetched.find((n) => n.includes('?t=')) ?? fetched[0] ?? path)
      }
      const tex = await appImport('/src/app/board/useBoardTextures.ts')
      // Sampled over time: a count that starts full and falls to zero means
      // something FREED the board's textures while the board was still up.
      const series = []
      for (let i = 0; i < 6; i++) {
        series.push(tex.boardTextureCount())
        await new Promise((r) => setTimeout(r, 600))
      }
      const scene = window.__board3d?.scene
      let planes = 0
      let blank = 0
      let decalGrids = 0
      const seen = new Set()
      const empty = []
      scene?.traverse((o) => {
        if (o.isMesh) {
          const g0 = o.geometry
          const tris0 = g0?.index ? g0.index.count / 3 : (g0?.attributes?.position?.count ?? 0) / 3
          if (tris0 === 800) decalGrids++
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            const img = m?.map?.image
            if (!img || seen.has(img)) continue
            seen.add(img)
            if (img.width === 0 || img.height === 0) blank++
          }
          if (o.geometry?.type === 'PlaneGeometry') planes++
          return
        }
        // A product group that ended up with neither a garment nor a flat
        // preview is an EMPTY SLOT — the failure this section exists to catch.
        if (o.type !== 'Group' || !o.name) return
        let inner = 0
        o.traverse((c) => {
          if (!c.isMesh) return
          const g = c.geometry
          const tris = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3
          if (g?.type === 'PlaneGeometry' || tris > 1000) inner++
        })
        if (inner === 0) empty.push(o.name)
      })
      return {
        lines: window.__tshop.getState().basket.length,
        selected: window.__tshop.getState().board.selectedIds.length,
        planes,
        blank,
        empty,
        decalGrids,
        series,
        mounted: document.querySelectorAll('[data-board3d-ready]').length,
        liveCanvases: document.querySelectorAll('main canvas').length,
        textures: tex.boardTextureCount(),
        textureMiB: tex.boardTextureBytes() / 1048576,
        note: [...document.querySelectorAll('p')].map((p) => p.textContent).find((x) => /3D/.test(x || '')),
      }
    })
  })
  console.log(
    `  ${overCap.lines} lines · ${overCap.planes} billboards in the scene · ${overCap.decalGrids} print grids on the solid garments · ${overCap.textures} print textures (${overCap.textureMiB.toFixed(1)} MiB) · note: ${JSON.stringify(overCap.note)}`,
  )
  console.log(
    `  print-texture count over 4 s: [${overCap.series.join(', ')}] · board3d mounted: ${overCap.mounted} · live canvases: ${overCap.liveCanvases}`,
  )
  // 7, not 8: one of the eight solid products is the ship-your-own garment,
  // which is a photo card and carries no print grid.
  check(
    overCap.decalGrids >= 7,
    `the solid garments still carry their prints past the cap (${overCap.decalGrids} grids)`,
  )
  check(
    overCap.planes >= overCap.selected - 8 && overCap.empty.length === 0,
    `every product past the cap became a billboard, not nothing (${overCap.planes} for ${overCap.selected - 8} overflow lines${overCap.empty.length ? `; empty slots: ${overCap.empty.slice(0, 3).join(', ')}` : ''})`,
  )
  check(
    overCap.blank === 0,
    `no billboard texture was zeroed by the tile cache's LRU (${overCap.blank} blank)`,
  )
  check(
    overCap.decalGrids <= 16 && overCap.textures <= 16,
    `${overCap.lines} lines still cost only ${overCap.decalGrids} print grids and ${overCap.textures} print canvases — the cap holds`,
  )

  const purged = await attempt('purged upload', async () => {
    await page.evaluate(async () => {
      const assets = await window.__assets()
      const st = () => window.__tshop.getState()
      if (st().board.on) st().exitBoard()
      st().clearBasket()
      // One line whose ARTWORK is purged, one whose GARMENT PHOTO is purged.
      const mk = async (name) => {
        const c = document.createElement('canvas')
        c.width = 300
        c.height = 400
        const x = c.getContext('2d')
        x.fillStyle = '#e0308a'
        x.fillRect(0, 0, 300, 400)
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
        return assets.addAsset(blob, name)
      }
      const art = await mk('art')
      const photo = await mk('photo')
      st().setAssets(await assets.listAssets())
      st().newDesign()
      st().setGarment('tee')
      st().addImageLayer(art)
      st().renameDesign('PURGED ART')
      st().addToBasket()
      st().newDesign()
      st().setCustom({
        widthIn: 20,
        front: {
          assetId: photo.id,
          useCutout: false,
          printArea: { xIn: 4, yIn: 5, wIn: 10, hIn: 12 },
        },
        back: null,
      })
      st().renameDesign('PURGED GARMENT')
      st().addToBasket()
      st().newDesign()
      // Now purge BOTH uploads from the library, exactly as the uploads panel does.
      await assets.removeAsset(art.id)
      await assets.removeAsset(photo.id)
      window.__tshop.getState().setAssets(await assets.listAssets())
    })
    await ensureBoard('2d', false)
    await page.waitForSelector('.board-tile', { timeout: 20000 })
    await page.waitForTimeout(3000)
    return page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.board-tile')]
      return {
        tiles: tiles.length,
        badges: tiles.filter((t) => /missing image|image manquante/i.test(t.textContent || '')).length,
        stillLoading: tiles.filter((t) => t.querySelector('.board-tile-skeleton')).length,
        broken: tiles.filter((t) => t.querySelector('.board-tile-broken')).length,
      }
    })
  })
  console.log(
    `  ${purged.tiles} tiles · ${purged.badges} carry a "missing image" badge · ${purged.broken} show the unavailable frame · ${purged.stillLoading} still skeletons`,
  )
  check(purged.tiles === 2, 'both damaged lines still get a tile')
  check(purged.badges === 2, 'a line with a purged upload says so on the tile')
  check(purged.stillLoading === 0, 'no tile is left pretending to still be loading')
  check(purged.broken >= 1, 'the line whose garment photo is gone shows an explicit unavailable frame')

  const empty = await attempt('empty basket', async () => {
    await page.evaluate(() => {
      const st = window.__tshop.getState()
      st.clearBasket()
      st.enterBoard()
      st.setMode('2d')
    })
    await page.waitForTimeout(800)
    const twoD = await page.evaluate(() => ({
      on: window.__tshop.getState().board.on,
      tiles: document.querySelectorAll('.board-tile').length,
      text: document.body.innerText.slice(0, 4000),
    }))
    await page.evaluate(() => window.__tshop.getState().setMode('3d'))
    await page.waitForTimeout(1200)
    const threeD = await page.evaluate(() => ({
      canvases: document.querySelectorAll('main canvas').length,
      text: document.body.innerText.slice(0, 4000),
    }))
    return { twoD, threeD }
  })
  check(empty.twoD.on && empty.twoD.tiles === 0, 'an empty board opens without tiles instead of crashing')
  check(
    /no product|aucun produit/i.test(empty.twoD.text),
    'the empty 2D board explains itself',
  )
  check(
    empty.threeD.canvases === 0 && /no product|aucun produit/i.test(empty.threeD.text),
    'the empty 3D board does not even start a WebGL context',
  )

  // ---- P · garment switching + side integrity -----------------------------
  //
  // Not board mode, but the same store: a garment switch that leaves activeSide
  // on a side the new garment does not have strands the user on a locked side
  // with a disabled way back — and a RECONSTRUCTED back is a side that exists
  // and must be marked, not one that is missing and must be locked.
  console.log('\n=== P · garment switch keeps the active side real ===')
  const sides = await attempt('side integrity', async () => {
    await ready()
    const snap = await page.evaluate(async () => {
      const assets = await window.__assets()
      const st = () => window.__tshop.getState()
      if (st().board.on) st().exitBoard()
      const mk = async (name, fill) => {
        const c = document.createElement('canvas')
        c.width = 400
        c.height = 560
        const x = c.getContext('2d')
        x.fillStyle = fill
        x.fillRect(0, 0, 400, 560)
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
        return assets.addAsset(blob, name)
      }
      const front = await mk('own-front', '#3a7bd5')
      const back = await mk('own-back', '#2b5ea8')
      st().setAssets(await assets.listAssets())
      const area = { xIn: 4, yIn: 5, wIn: 10, hIn: 12 }

      // 1. A custom garment with NO back, reached while the editor sits on the
      //    back of a catalog garment.
      st().newDesign()
      st().setCustom({ widthIn: 20, front: { assetId: front.id, useCutout: false, printArea: area }, back: null })
      st().setGarment('tee')
      st().setSide('back')
      const beforeSwitch = st().activeSide
      st().setGarment('custom')
      const noBack = st().activeSide

      // 2. The sleeve, which no custom garment has.
      st().setGarment('tee')
      st().setSide('sleeve')
      st().setGarment('custom')
      const noSleeve = st().activeSide

      // 3. A GENERATED back is a back: the switch must keep it.
      st().setCustom({
        widthIn: 20,
        front: { assetId: front.id, useCutout: false, printArea: area },
        back: { assetId: back.id, useCutout: false, printArea: area, origin: 'generated' },
      })
      st().setGarment('tee')
      st().setSide('back')
      st().setGarment('custom')
      const withGenerated = st().activeSide
      st().setMode('2d')
      return { beforeSwitch, noBack, noSleeve, withGenerated }
    })
    await page.waitForTimeout(600)
    const dom = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button[aria-pressed]')].find((b) =>
        /^(Back|Dos)/.test((b.textContent || '').trim()),
      )
      return {
        found: !!btn,
        disabled: btn?.disabled ?? null,
        label: btn?.getAttribute('aria-label') ?? null,
        marked: !!btn?.querySelector('svg'),
      }
    })
    return { ...snap, dom }
  })
  console.log(
    `  custom without a back: ${sides.beforeSwitch} → ${sides.noBack} · sleeve → ${sides.noSleeve} · with a generated back: ${sides.withGenerated}`,
  )
  check(sides.noBack === 'front', 'switching to a garment with no back snaps the active side to front')
  check(sides.noSleeve === 'front', 'switching to a garment with no sleeve snaps the active side to front')
  check(sides.withGenerated === 'back', 'a RECONSTRUCTED back is a real side — the switch keeps it')
  check(sides.dom.found && sides.dom.disabled === false, 'the Back button is not disabled when the back was reconstructed')
  check(
    /reconstructed|reconstitué/i.test(sides.dom.label ?? ''),
    `the reconstructed back is announced (${JSON.stringify(sides.dom.label)})`,
  )
  check(sides.dom.marked, 'and it carries a visible mark, not just a tooltip')

  // ---- exit ---------------------------------------------------------------
  const afterExit = await attempt('exit', async () => {
    await ready()
    await page.evaluate(() => {
      const st = window.__tshop.getState()
      if (!st.board.on) st.enterBoard()
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__tshop.getState().exitBoard())
    // Frees are deferred by ~1.5 s (StrictMode remounts must not lose the cache).
    await page.waitForTimeout(2600)
    return page.evaluate(async () => {
      const appImport = (path) => {
        const fetched = performance
          .getEntriesByType('resource')
          .map((e) => e.name)
          .filter((n) => n.includes(path))
        return import(fetched.find((n) => n.includes('?t=')) ?? fetched[0] ?? path)
      }
      const mock = await appImport('/src/app/board/mockupCache.ts')
      const tex = await appImport('/src/app/board/useBoardTextures.ts')
      const cache = await appImport('/src/three/garmentCache.ts')
      const st = window.__tshop.getState()
      return {
        boardOff: st.board.on === false && st.board.focusedId === null,
        designName: st.design.name,
        mockupBytes: mock.mockupCacheBytes(),
        textureBytes: tex.boardTextureBytes(),
        frames: cache.boardGarmentStats().frames,
        // The 3D board's own handle on its scene: gone means the canvas and
        // everything hanging off it went with it.
        sceneGone: window.__board3d === undefined,
        canvases: document.querySelectorAll('main canvas').length,
      }
    })
  })
  console.log('\n=== exit ===')
  check(afterExit.boardOff, 'exiting the board clears its state')
  check(afterExit.mockupBytes === 0, `tile canvases are freed on exit (${afterExit.mockupBytes} B)`)
  check(afterExit.textureBytes === 0, `print canvases are freed on exit (${afterExit.textureBytes} B)`)
  check(afterExit.frames === 0, `shared garment geometry is freed on exit (${afterExit.frames} frames)`)
  check(afterExit.sceneGone, 'the 3D board scene is gone (its canvas went with it)')

  console.log('\n=== page errors ===')
  check(
    errors.length === 0,
    `no uncaught page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`,
  )
  if (loads !== loadsBefore)
    console.log(`  (the page reloaded ${loads - loadsBefore}× — 3 of those are this script's own)`)

  console.log('\nverdict:', verdict)
  done(verdict === 'FAIL' ? 3 : verdict === 'WARN' ? 2 : 0)
} catch (e) {
  console.error('❌', e?.stack || e?.message || e)
  done(1)
}
