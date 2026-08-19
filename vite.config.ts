import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// onnxruntime-web's wasm runtime is committed at public/ort/ (see README) —
// only the plain single-thread+simd build; the jsep/asyncify variants are
// >25 MiB, which Cloudflare's per-file asset limit rejects.
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
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // Emitted so scripts/bundle-guard.mjs can report static vs dynamic import
    // edges. It does NOT describe `new Worker(new URL(…))` chunks, which is why
    // the guard also closes the set over asset-name mentions.
    manifest: true,
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
