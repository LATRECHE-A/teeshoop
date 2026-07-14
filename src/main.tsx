import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import App from '@/app/App'
import { useStore } from '@/state/store'

if (import.meta.env.DEV) {
  ;(window as unknown as { __tshop: typeof useStore }).__tshop = useStore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Dismiss the boot splash once React has painted.
requestAnimationFrame(() => {
  const splash = document.getElementById('splash')
  if (splash) {
    splash.classList.add('done')
    setTimeout(() => splash.remove(), 450)
  }
})
