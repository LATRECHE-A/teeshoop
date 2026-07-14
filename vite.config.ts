import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // onnxruntime-web loads its wasm binary from /ort/ at runtime. Only the
    // plain single-thread+simd build is shipped — the jsep/asyncify variants
    // are >25 MiB, which Cloudflare's per-file asset limit rejects.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
          dest: 'ort',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
          dest: 'ort',
        },
      ],
    }),
  ],
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
