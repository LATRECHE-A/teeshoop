#!/usr/bin/env node
/**
 * The scenes a customer is actually OFFERED, read from the studio's own source.
 *
 * WHY IT EXISTS. `src/scenes/index.ts` exports `SCENE_IDS`, the list the picker
 * renders, and it is NOT the same as the scenes the module knows how to build:
 * `night` was withdrawn on 1 September 2026 (question 53) and its definition
 * stayed, so a stored design that names it still renders. Two harnesses held
 * their own copy of the list, `scripts/render-verify.mjs` in a corpus row and
 * `scripts/leak-verify.mjs` in an environment default, and both went on
 * measuring a scene nobody is shown. A harness that keeps its own copy of the
 * thing it verifies proves the copy.
 *
 * IT PARSES RATHER THAN IMPORTS, because these harnesses are plain Node and the
 * source is TypeScript. The regex is deliberately strict and there is NO
 * fallback list: a source it cannot read makes the caller exit 2, because a
 * harness that quietly substituted its own list is exactly what this file
 * replaces.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function offeredScenes() {
  const path = fileURLToPath(new URL('../src/scenes/index.ts', import.meta.url))
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch (e) {
    return { ok: false, why: `src/scenes/index.ts is unreadable: ${e.message}` }
  }
  const m = /export const SCENE_IDS: SceneId\[\] = \[([^\]]*)\]/.exec(src)
  if (!m) {
    return { ok: false, why: 'SCENE_IDS is no longer declared the way this reader parses it' }
  }
  const ids = [...m[1].matchAll(/'([a-z0-9_-]+)'/g)].map((x) => x[1])
  if (ids.length === 0) {
    return { ok: false, why: 'SCENE_IDS parsed to an empty list, which cannot be right' }
  }
  return { ok: true, ids }
}
