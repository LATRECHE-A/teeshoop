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
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Multi-page: the studio (index.html) + the standalone AR try-on page
      // (ar.html). ar.html is a real built asset, so Cloudflare's SPA fallback
      // serves it directly at /ar.html instead of rewriting to index.html.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ar: fileURLToPath(new URL('./ar.html', import.meta.url)),
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
