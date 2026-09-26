import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/*
 * A LOWER-CASE DRIVE LETTER IS REFUSED BY NAME (EDI-18). Started from a cwd
 * spelled `c:\Users\...` (what VS Code's terminal often reports), vitest loads
 * its own module under two spellings of one path, and every suite fails with
 * « Cannot read properties of undefined (reading 'config') » without running a
 * test: a red that says nothing about the code. Setting `root`, aliasing
 * `vitest` and `preserveSymlinks` were each tried from such a cwd and none
 * helped, because the runner is already loaded under the other spelling before
 * this file is read. So the run stops here and says what to do.
 */
const drive = /^([a-z]):/.exec(process.cwd())
if (drive) {
  const fixed = drive[1].toUpperCase() + process.cwd().slice(1)
  throw new Error(
    `vitest a été lancé depuis « ${process.cwd()} », lettre de lecteur en minuscule : ` +
      `chaque suite échouerait sans exécuter un test. Relancez depuis « ${fixed} » ` +
      `(par exemple : cd /d ${fixed}, ou Set-Location '${fixed}').`,
  )
}

/**
 * Deliberately NOT extending vite.config.ts. Vitest would then load the react
 * and tailwind plugins, the dev-server proxy and the multi-page build inputs,
 * none of which a test needs, all of which could break one. The `@` alias is
 * the only thing the two configs must agree on.
 *
 * `environment: 'node'` because every module under test is pure: no DOM, no
 * canvas. Anything that needs a browser already has a harness in scripts/.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
