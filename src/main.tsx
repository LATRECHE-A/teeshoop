import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import App from '@/app/App'
import { useStore } from '@/state/store'
import { startShopBridge } from '@/lib/teeshoop/bridge'

/*
 * Offer the handshake to the shop before React mounts.
 *
 * `bridge.js` on the WordPress page answers with the product context, and the
 * sooner that lands the sooner the top bar can show the real basket action
 * rather than switching under the customer's cursor. Inert, and says so once in
 * the console, when the studio is not framed.
 */
startShopBridge()

if (import.meta.env.DEV) {
  ;(window as unknown as { __tshop: typeof useStore }).__tshop = useStore
  // Headless AR-export probe (scripts/ar-verify.mjs) — lazily pulls the same
  // module the AR modal uses so the export can be validated without a backend.
  ;(window as unknown as { __arExport?: () => Promise<typeof import('@/lib/arExport')> }).__arExport = () =>
    import('@/lib/arExport')
  // Lets ar-verify parse an exported GLB back with GLTFLoader (the loader the AR
  // viewer uses) — a stronger check than magic bytes.
  ;(window as unknown as { __gltf?: () => Promise<typeof import('three/examples/jsm/loaders/GLTFLoader.js')> }).__gltf = () =>
    import('three/examples/jsm/loaders/GLTFLoader.js')
  ;(window as unknown as { __three?: () => Promise<typeof import('three')> }).__three = () => import('three')
  // Lets ar-verify seed a real ship-your-own garment (asset + cutout) so the
  // custom AR path (inflated shell) is exercised, not just the mannequin fallback.
  ;(window as unknown as { __assets?: () => Promise<typeof import('@/state/assets')> }).__assets = () =>
    import('@/state/assets')
  // Lets scripts/parity-verify.mjs call the SHARED renderer (the 2D truth) to
  // measure 2D-vs-3D-vs-AR print size/placement parity.
  ;(window as unknown as { __render?: () => Promise<typeof import('@/lib/renderDesign')> }).__render = () =>
    import('@/lib/renderDesign')
  // The official cm chart, so parity-verify can assert the rendered garment
  // really scales by the chart's chest/body-length ratios at every size.
  ;(window as unknown as { __sizes?: () => Promise<typeof import('@/content/sizeChart')> }).__sizes = () =>
    import('@/content/sizeChart')
  // Lets scripts/fabric-verify.mjs measure the arc-length unwrap and the fabric
  // mapping built on it — against the tee's own isometric UV atlas and against
  // arc walked directly on the mesh cross-sections. The 3D print placement is
  // pure geometry, so it is provable without a single rendered pixel.
  ;(
    window as unknown as {
      __fabric?: () => Promise<{
        unwrap: typeof import('@/three/fabricUnwrap')
        decal: typeof import('@/three/decalGeom')
        frame: typeof import('@/three/garmentFrame')
        calibration: typeof import('@/three/calibration')
        zones: typeof import('@/content/zones')
      }>
    }
  ).__fabric = async () => ({
    unwrap: await import('@/three/fabricUnwrap'),
    decal: await import('@/three/decalGeom'),
    frame: await import('@/three/garmentFrame'),
    calibration: await import('@/three/calibration'),
    zones: await import('@/content/zones'),
  })
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
