#!/usr/bin/env node
/**
 * KEYBOARD GATE: the two studio controls that claimed an ARIA role without the
 * behaviour behind it, driven by a real keyboard in a real browser.
 *
 *   node scripts/focus-verify.mjs
 *
 * WHY IT EXISTS. Session 12 audited the buying path for WCAG 2.2 AA and left
 * two things it could not take, because they are inside the studio: the scene
 * picker was `role="listbox"` with no arrow keys and one tab stop per option,
 * and the modal was `aria-modal="true"` with no focus trap and no focus
 * returned on close. Both are the same defect in two shapes, and it is worse
 * than the missing attribute would have been: a screen reader announces a
 * behaviour, and then the keyboard does something else.
 *
 * WHY IT IS NOT PART OF scripts/a11y-verify.mjs. That one drives the WordPress
 * shop at :8080 and measures contrast, target size and obscured focus over six
 * rendered pages. This one boots the studio's own bundle under vite and types.
 * Different servers, different instrument, and merging them would mean neither
 * could be run without the other.
 *
 * WHAT IT ASSERTS, and the failure each was written against:
 *
 *   the listbox owns options only        `<ul role=listbox><li><button role=option>`
 *                                        put a listitem between the two, and a
 *                                        listbox may only own options or groups
 *   one tab stop, not six                every option was tabbable, so leaving
 *                                        the control took six presses
 *   arrows move, and only focus moves    the scene must not change under the
 *                                        keyboard before Enter
 *   Down at the end does not wrap        no native select does
 *   Escape returns focus to the button   it was left on a removed element,
 *                                        which sends focus to the document
 *   choosing returns focus too           same
 *   Tab out of the dialog cycles         Tab walked into the page the dialog
 *                                        had just told a reader was inert
 *   Shift+Tab wraps backwards            same, in the other direction
 *   focus arriving from outside is       a round trip through the browser's own
 *   pulled back                          chrome re-enters at the top of the
 *                                        document, past any Tab handler
 *   closing restores the opener          focus fell to <body>, so the next Tab
 *                                        restarted from the top of the studio
 *
 * Exit: 0 all assertions passed, 1 at least one failed, 2 it asserted nothing
 * or could not run, which is never a pass.
 */
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.FOCUS_PORT ?? 5183)
const BASE = `http://localhost:${PORT}`

let failed = 0
let checked = 0
const ok = (m) => {
  checked++
  console.log(`  ok   ${m}`)
}
const fail = (m) => {
  checked++
  failed++
  console.error(`  FAIL ${m}`)
}
const is = (actual, expected, what) =>
  actual === expected ? ok(`${what}: ${actual}`) : fail(`${what}: ${actual}, expected ${expected}`)

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
let browser
const done = (c) => {
  try { browser?.close() } catch {}
  try { server.kill('SIGTERM') } catch {}
  process.exit(c)
}
process.on('SIGINT', () => done(130))

const waitServer = async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('vite never came up')
}

/** What the keyboard is standing on, described the way a person would read it. */
const where = (page) =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return { tag: 'BODY', role: null, label: null, inDialog: false }
    return {
      tag: el.tagName,
      role: el.getAttribute('role'),
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
      inDialog: !!el.closest('[role="dialog"]'),
      isSceneButton: el.getAttribute('aria-haspopup') === 'listbox',
    }
  })

try {
  await waitServer()
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser
    .newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    .then((c) => c.newPage())
  await page.goto(BASE, { waitUntil: 'load', timeout: 300000 })

  const trigger = page.locator('button[aria-haspopup="listbox"]').first()
  await trigger.waitFor({ state: 'visible', timeout: 60000 })

  // ---------------------------------------------------------------- listbox

  console.log('\nLe sélecteur de scènes')

  await trigger.press('ArrowDown')
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 })

  const children = await page.evaluate(() =>
    Array.from(document.querySelector('[role="listbox"]').children).map(
      (c) => c.getAttribute('role') || c.tagName.toLowerCase(),
    ),
  )
  const notOptions = children.filter((r) => r !== 'option')
  is(notOptions.length, 0, `the listbox owns ${children.length} children and ${notOptions.length} are not options`)

  const tabbable = await page.evaluate(
    () => Array.from(document.querySelectorAll('[role="option"]')).filter((o) => o.tabIndex === 0).length,
  )
  is(tabbable, 1, 'options carrying a tab stop')

  const opened = await where(page)
  is(opened.role, 'option', 'ArrowDown on the button opens the list and focus lands on an option')

  /*
   * `innerText`, not `textContent`. The option's name and its description are
   * two spans and the second is `display:block`, so textContent runs them
   * together as « PlageSoleil chaud, ciel clair » and the comparison against
   * the button's « Plage » fails on a control that is working.
   */
  const sceneOf = () => page.evaluate(() => document.activeElement.innerText.trim().split('\n')[0])
  const firstLabel = await sceneOf()
  await page.keyboard.press('ArrowDown')
  const secondLabel = await sceneOf()
  is(secondLabel !== firstLabel, true, `ArrowDown moves focus (${firstLabel} -> ${secondLabel})`)

  const selectedStill = await page.evaluate(
    () => document.querySelector('[role="option"][aria-selected="true"]').innerText.trim().split('\n')[0],
  )
  is(selectedStill, firstLabel, 'moving with the arrows does not change the chosen scene')

  await page.keyboard.press('End')
  const atEnd = await sceneOf()
  await page.keyboard.press('ArrowDown')
  is(await sceneOf(), atEnd, `ArrowDown at the last option stays put (${atEnd})`)

  await page.keyboard.press('Home')
  is(await sceneOf(), firstLabel, 'Home returns to the first option')

  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 })
  is((await where(page)).isSceneButton, true, 'Escape closes the list and focus is back on the button')

  // Choose the second scene with the keyboard alone, and check the stage took it.
  await page.keyboard.press('ArrowDown')
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 })
  await page.keyboard.press('ArrowDown')
  const chosen = await sceneOf()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[role="listbox"]', { state: 'detached', timeout: 5000 })
  is((await where(page)).isSceneButton, true, 'choosing with Enter returns focus to the button')
  const buttonNow = (await trigger.textContent()).trim()
  is(buttonNow.includes(chosen), true, `the button now reads the chosen scene (${buttonNow})`)

  // ------------------------------------------------------------------ dialog

  console.log('\nLa fenêtre modale')

  await trigger.focus()
  await page.keyboard.press('?')
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })

  is((await where(page)).inDialog, true, 'opening the dialog moves focus into it')

  let escaped = null
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    const w = await where(page)
    if (!w.inDialog) {
      escaped = `${w.tag} ${w.label}`
      break
    }
  }
  is(escaped, null, '25 presses of Tab never leave the dialog')

  await page.keyboard.press('Shift+Tab')
  is((await where(page)).inDialog, true, 'Shift+Tab stays inside as well')

  /*
   * The browser-chrome round trip, reproduced: focus something outside the
   * dialog directly, which is what the address bar handing focus back to the
   * document does. A Tab handler alone never sees this.
   */
  const pulled = await page.evaluate(() => {
    const outside = document.querySelector('button[aria-haspopup="listbox"]')
    if (!outside) return 'no element outside the dialog to focus'
    outside.focus()
    return document.activeElement.closest('[role="dialog"]') ? 'pulled back' : 'left outside'
  })
  is(pulled, 'pulled back', 'focus arriving from outside is pulled back into the dialog')

  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 })
  is((await where(page)).isSceneButton, true, 'closing gives the keyboard back to what opened it')
} catch (e) {
  console.error(`\nfocus-verify could not run: ${e?.message ?? e}`)
  done(2)
}

/*
 * NOTHING ASSERTED IS NOT A PASS. If the studio never rendered, every locator
 * above would have thrown into the catch; this covers the other shape, where
 * the assertions are skipped and the summary line prints green over an empty
 * set.
 */
if (checked < 15) {
  console.error(`\nfocus-verify: only ${checked} assertion(s) ran. That is not this harness.`)
  done(2)
}

console.log(
  failed
    ? `\nfocus-verify: ${failed} of ${checked} assertions failed.`
    : `\nfocus-verify: ${checked} assertions, all passed.`,
)
done(failed ? 1 : 0)
