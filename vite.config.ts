import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { ADMIN_ASSET_DIR, adminOnlyModules } from './scripts/admin-boundary.mjs'

// onnxruntime-web's wasm runtime is committed at public/ort/ (see README) —
// only the plain single-thread+simd build; the jsep/asyncify variants are
// >25 MiB, which Cloudflare's per-file asset limit rejects.
/*
 * Walked once, at config time, from the three real entries. A module is
 * admin-only when the admin entry reaches it and neither the customer studio nor
 * the AR viewer does. Deciding on the source PATH instead is not enough: a
 * DtfModal chunk also carries shared helpers that are admin-only by
 * reachability and public by path, and that version left six of the seven admin
 * chunks in the open directory.
 */
const ADMIN_MODULES = adminOnlyModules(fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, ''))

/**
 * Is this emitted chunk made only of the shop's own code?
 *
 * OUR modules decide, and a third party's do not. A DtfModal chunk also carries
 * four lucide-react icon files, which are public library code with no notion of
 * an admin boundary; requiring THEM to be admin-only left six of the seven admin
 * chunks in the open directory, which is what the first version of this did.
 * Rollup's virtual modules (`\0…`) are dropped for the same reason, and a chunk
 * with no module of ours in it at all (the react and three vendor chunks) can
 * never qualify: `ours.length > 0` is what stops the whole vendor tree being
 * gated by a vacuous `every`.
 */
function adminChunk(chunk: { moduleIds?: readonly string[] }): boolean {
  const ours = (chunk.moduleIds ?? []).filter(
    (id) => !id.startsWith('\0') && !id.includes('/node_modules/'),
  )
  return ours.length > 0 && ours.every((id) => ADMIN_MODULES.has(id))
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // wasm-EP-only build: keeps the WebGPU (jsep) wasm out of the bundle
      'onnxruntime-web': 'onnxruntime-web/wasm',
    },
  },
  server: {
    /**
     * `npm run dev` serves static assets only — the Worker is what holds the
     * Falk&Ross credentials, so `/api/*` does not exist here and the supplier
     * catalogue would answer a Vite 404 (an HTML page, which the client then
     * fails to parse as JSON — a confusing way to learn the backend is not
     * running). Forward it to `npx wrangler dev` instead, whose default port
     * this is; with wrangler down the proxy fails loudly with ECONNREFUSED,
     * which at least says what is wrong.
     *
     * Override with `TSHOP_WORKER=http://…` if wrangler runs elsewhere.
     */
    proxy: {
      '/api': {
        target: process.env.TSHOP_WORKER ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      /*
       * The stored design documents and the customers' own rasters. The
       * workshop's production queue re-renders a paid order from these
       * (src/lib/dtf/fromR2.ts), so a dev studio without this proxy gets a Vite
       * 404 for every design and reports every order as unreadable artwork.
       */
      '/r2': {
        target: process.env.TSHOP_WORKER ?? 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  /*
   * WEB WORKERS ARE A SECOND OUTPUT GRAPH, with its own naming, and the admin
   * boundary has to hold in it too. `src/lib/dtf/nestWorker.ts` is the gang-sheet
   * packer: it IS the film economics, and it was landing in the open `assets/`
   * directory because `build.rollupOptions.output` does not reach worker chunks.
   * The customer's background-removal worker (src/lib/bgremove/worker.ts) goes
   * through the same predicate and stays public, which is the point of using the
   * predicate rather than a name.
   */
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: (chunk: { moduleIds?: readonly string[] }) =>
          adminChunk(chunk) ? `${ADMIN_ASSET_DIR}/[name]-[hash].js` : 'assets/[name]-[hash].js',
        chunkFileNames: (chunk: { moduleIds?: readonly string[] }) =>
          adminChunk(chunk) ? `${ADMIN_ASSET_DIR}/[name]-[hash].js` : 'assets/[name]-[hash].js',
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    /*
     * NO MANIFEST. This used to be `true`, with a comment saying
     * scripts/bundle-guard.mjs read it for the import edges. It never opened the
     * file (checked, session 13), and wrangler uploads dot-directories: measured
     * on 27/08, `GET /.vite/manifest.json` answered 200 with 57 ko of JSON
     * naming every emitted chunk, including the admin ones. That is a map of the
     * whole application handed to anyone who asks, and it was the discovery step
     * for the admin-chunk leak below. The guard closes its own set over import
     * specifiers AND bare asset-name mentions, which is what catches the
     * `new Worker(new URL(…))` chunks a manifest would not describe anyway.
     */
    manifest: false,
    rollupOptions: {
      // Multi-page, THREE entries:
      //   index.html  the CUSTOMER studio
      //   admin.html  the ADMIN studio — same tree, plus the workshop tools
      //   v.html      the lean AR viewer the Worker serves for /v/{id} QR links
      //
      // The customer/admin split is the security boundary, and it is a boundary
      // of MODULE REACHABILITY, not of chunk identity: admin-only modules must
      // have no static importer outside src/admin/. Sharing vendor chunks
      // between the two pages is wanted. See src/app/adminSlots.tsx.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./v.html', import.meta.url)),
      },
      output: {
        /*
         * ADMIN-ONLY CHUNKS GO SOMEWHERE THE WORKER CAN GATE.
         *
         * `dist/` is served wholesale, so gating `/admin.html` gated the PAGE and
         * nothing it loads. Measured on 27/08 against a real worker:
         * `GET /admin.html` answered 401 and
         * `GET /assets/DtfModal-<hash>.js` answered 200 with 137 ko of the film
         * cost model to an unauthenticated request. Both of the two gates that
         * exist for this were green at the time and neither was wrong:
         * adminBoundary.test.ts proves the customer entry cannot REACH that
         * module, and bundle-guard.mjs allows shop-internal markers in files
         * classified ADMIN. What neither asserted is that an ADMIN file is not
         * simply downloadable, and this project's own rule is that anything
         * reachable by URL is public.
         *
         * A chunk qualifies only when EVERY real module in it is admin-only, so a
         * chunk shared with the customer studio stays where the customer can
         * fetch it. Rollup's virtual modules (`\0…`) are ignored: a chunk of
         * nothing but those would otherwise qualify vacuously and be gated by
         * accident.
         *
         * scripts/bundle-guard.mjs asserts the result, in both directions.
         */
        /*
         * The admin ENTRY chunk goes the same way as its lazy ones. It is the
         * one that imports the rest, so leaving it in the open directory would
         * publish the admin module map even with every other chunk gated.
         */
        entryFileNames(chunk) {
          return adminChunk(chunk) ? `${ADMIN_ASSET_DIR}/[name]-[hash].js` : 'assets/[name]-[hash].js'
        },
        chunkFileNames(chunk) {
          return adminChunk(chunk) ? `${ADMIN_ASSET_DIR}/[name]-[hash].js` : 'assets/[name]-[hash].js'
        },
        manualChunks(id: string) {
          // React FIRST, and in its own chunk. Without this it lands inside the
          // `three` chunk (via @react-three/fiber's dependency on it), and
          // because React is needed for first paint the whole 1.1 MB of
          // three.js becomes eager — for a 3D view most visitors never open.
          // Measured 2026-08-12: splitting it moved 311 KB gzip off first paint.
          // Match exact package roots so react-reconciler (a fiber-only dep)
          // stays with three rather than being dragged forward.
          // Also zustand/zundo: @react-three/fiber depends on zustand, so
          // without this they land in the `three` chunk too, and the app store
          // — needed at first paint — drags three.js back in through them.
          if (
            /node_modules\/react\//.test(id) ||
            /node_modules\/react-dom\//.test(id) ||
            /node_modules\/scheduler\//.test(id) ||
            /node_modules\/zustand\//.test(id) ||
            /node_modules\/zundo\//.test(id) ||
            /node_modules\/use-sync-external-store\//.test(id)
          )
            return 'react'
          if (
            id.includes('node_modules/three') ||
            id.includes('node_modules/@react-three')
          )
            return 'three'
          if (id.includes('node_modules/konva')) return 'konva'
          return undefined
        },
      },
    },
  },
})
