/**
 * INGEST dev harness (port 5185). Exercises the REAL pipeline end-to-end
 * without the onnx model: a synthetic pre-cut (alpha) tee PNG runs through
 * normalizeGarmentPhoto's pre-cut fast path, autoPrintArea's collar-dip
 * detection, and saveProduct; the modal then opens on the result.
 *
 *   /dev/ingest.html            → product editor (seeded product)
 *   /dev/ingest.html?view=list  → product library view
 */
import ReactDOM from 'react-dom/client'
import '@/styles.css'
import AdminIngestModal from '@/app/modals/AdminIngestModal'
import { autoPrintArea, normalizeGarmentPhoto } from '@/lib/ingest/pipeline'
import { saveProduct } from '@/lib/ingest/store'
import type { ProductDef } from '@/lib/ingest/types'
import { getCustomSideInfo } from '@/lib/custom'
import { cmToIn } from '@/lib/units'
import { SIZE_CHARTS } from '@/content/sizeChart'

const PRODUCT_ID = 'dev-harness-tee'

/** Laid-flat heather tee with a genuine transparent neck notch. */
function syntheticTee(): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 800
  c.height = 900
  const ctx = c.getContext('2d')!
  // torso
  ctx.fillStyle = '#B7BCC2'
  ctx.beginPath()
  ctx.moveTo(220, 130)
  ctx.lineTo(580, 130)
  ctx.lineTo(590, 850)
  ctx.lineTo(210, 850)
  ctx.closePath()
  ctx.fill()
  // sleeves
  ctx.fillStyle = '#ADB3BA'
  ctx.beginPath()
  ctx.moveTo(222, 132)
  ctx.lineTo(120, 200)
  ctx.lineTo(160, 360)
  ctx.lineTo(240, 320)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(578, 132)
  ctx.lineTo(680, 200)
  ctx.lineTo(640, 360)
  ctx.lineTo(560, 320)
  ctx.closePath()
  ctx.fill()
  // faint centre crease
  ctx.fillStyle = 'rgba(0,0,0,0.05)'
  ctx.fillRect(398, 140, 4, 700)
  // punch the neck opening (the dip autoPrintArea must find)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.ellipse(400, 128, 95, 58, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalCompositeOperation = 'source-over'
  // collar ribbing (closes the notch like a real crew neck)
  ctx.strokeStyle = '#9AA0A8'
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.ellipse(400, 128, 99, 62, 0, 0, Math.PI)
  ctx.stroke()
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'),
  )
}

async function seed(): Promise<void> {
  const halfChestCm = SIZE_CHARTS.tee.sizes.M.halfChestCm
  const photo = await normalizeGarmentPhoto(await syntheticTee(), {
    name: 'Harness tee, front',
  })
  const side = { assetId: photo.assetId, useCutout: photo.hasCutout }
  const info = await getCustomSideInfo(
    { ...side, printArea: { xIn: 0, yIn: 0, wIn: 1, hIn: 1 } },
    cmToIn(halfChestCm),
  )
  const printArea = autoPrintArea(info.img, info.bbox, halfChestCm, 'front')
  const product: ProductDef = {
    id: PRODUCT_ID,
    name: 'Tee bio 180 g (harness)',
    brandRef: 'DEV / synthetic',
    createdAt: Date.now(),
    sizes: { ...SIZE_CHARTS.tee.sizes },
    defaultSize: 'M',
    front: { ...side, printArea },
    back: null,
    notes: 'Seeded by src/dev/ingestHarness.tsx',
  }
  await saveProduct(product)
}

const listView = new URLSearchParams(location.search).get('view') === 'list'

void seed().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <AdminIngestModal initialProductId={listView ? undefined : PRODUCT_ID} />,
  )
})
