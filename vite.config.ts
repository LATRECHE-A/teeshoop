import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // onnxruntime-web loads its wasm binaries from /ort/ at runtime
    viteStaticCopy({
      targets: [{ src: 'node_modules/onnxruntime-web/dist/*.wasm', dest: 'ort' }],
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
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
