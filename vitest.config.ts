import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

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
