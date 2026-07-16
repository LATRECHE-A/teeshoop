/**
 * AR entry (module: AR). A lean, standalone bundle — NO Zustand store, no
 * editor, no Konva — that reconstructs a shared design and renders it on a
 * mannequin in the phone camera. Shipped as its own page (ar.html); see
 * vite.config.ts build.rollupOptions.input.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import ArApp from './ArApp'

ReactDOM.createRoot(document.getElementById('ar-root')!).render(
  <React.StrictMode>
    <ArApp />
  </React.StrictMode>,
)
