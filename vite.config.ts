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
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Multi-page: the studio (index.html) + the lean AR viewer page (v.html,
      // Google <model-viewer>). The Worker serves v.html for the short /v/{id}
      // QR URLs; model-viewer is bundled per-entry so it never bloats the studio.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        viewer: fileURLToPath(new URL('./v.html', import.meta.url)),
      },
      output: {
        manualChunks(id: string) {
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
