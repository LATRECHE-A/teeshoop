/**
 * Bake the current design onto a mannequin-bust + garment and export it as the
 * two model formats native mobile AR needs:
 *   • GLB  → Android Scene Viewer (and WebXR) via <model-viewer src>
 *   • USDZ → iOS Quick Look via <model-viewer ios-src>
 *
 * Runs entirely in the browser. The design decals come from the SAME shared
 * renderer (`renderPrintArea`) as 2D/3D/print, so the AR garment is
 * dimensionally identical (1 unit = 1 inch, life-size). Works for vector AND
 * photo/custom designs — both are just print-area canvases here. The figure
 * stands with its feet at y=0 so native AR plants it on the real floor.
 *
 * Everything in the export scene is MeshStandardMaterial, which is the only
 * material the three USDZExporter supports well.
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import type { Design } from '@/lib/types'
import { garmentColorHex, getAreaSizeIn, renderMockup, renderPrintArea, sideLayers } from '@/lib/renderDesign'
import { buildMannequin, type Gender, type MannequinSide } from '@/three/mannequin'

const TARGET_PX = 1400 // decal render density (matches the 3D preview)
const GAP_BELOW_COLLAR = 2.6 // in, print top under the neckline
const DECAL_LIFT = 0.25 // in, above the fabric surface
const DECAL_BEND_MAX = THREE.MathUtils.degToRad(58)

export type { Gender }

export interface ArModelBlobs {
  glb: Blob
  usdz: Blob
  poster: Blob
}

/** A cylindrically-curved plane hugging the chest, sized in inches. */
function makeCurvedDecal(wIn: number, hIn: number, radius: number): THREE.PlaneGeometry {
  const bend = Math.min(DECAL_BEND_MAX, wIn / Math.max(radius, 1))
  const r = wIn / bend
  const geo = new THREE.PlaneGeometry(wIn, hIn, 40, 1)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const nor = geo.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * bend
    pos.setXYZ(i, r * Math.sin(theta), pos.getY(i), r * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.flipY = true
  tex.needsUpdate = true
  return tex
}

async function renderSide(design: Design, side: MannequinSide): Promise<HTMLCanvasElement | null> {
  if (sideLayers(design, side).length === 0) return null
  const area = getAreaSizeIn(design, side)
  const ppi = TARGET_PX / Math.max(area.wIn, area.hIn)
  return renderPrintArea(design, side, ppi).catch(() => null)
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('poster encode failed'))), type),
  )
}

/**
 * Build the design → mannequin → GLB + USDZ + poster PNG. Caller uploads the
 * blobs and shows a QR to the short URL. Disposes all GPU resources it makes.
 */
export async function buildArModel(design: Design, gender: Gender): Promise<ArModelBlobs> {
  const man = buildMannequin(gender)
  const garmentColor = design.garmentId === 'custom' ? '#eceef2' : garmentColorHex(design)
  man.shirtMaterial.color.set(garmentColor)

  // figure holds the mannequin + decals in mannequin-local space; shifting the
  // whole figure grounds the feet at y=0 for on-floor AR placement.
  const figure = new THREE.Group()
  figure.add(man.group)

  const [front, back] = await Promise.all([renderSide(design, 'front'), renderSide(design, 'back')])
  const decalDisposables: { dispose(): void }[] = []
  const addDecal = (side: MannequinSide, canvas: HTMLCanvasElement | null) => {
    if (!canvas) return
    const a = man.anchors[side]
    const size = getAreaSizeIn(design, side)
    const geo = makeCurvedDecal(size.wIn, size.hIn, a.radius)
    const tex = canvasTexture(canvas)
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.02,
      roughness: 0.82,
      metalness: 0,
      side: THREE.FrontSide,
    })
    decalDisposables.push(geo, tex, mat)
    const mesh = new THREE.Mesh(geo, mat)
    const cy = a.topY - GAP_BELOW_COLLAR - size.hIn / 2
    mesh.position.set(0, cy, side === 'front' ? a.surfaceZ + DECAL_LIFT : -(a.surfaceZ + DECAL_LIFT))
    mesh.rotation.y = a.rotationY
    figure.add(mesh)
  }
  addDecal('front', front)
  addDecal('back', back)

  figure.position.y = -man.minY
  const root = new THREE.Group()
  root.add(figure)

  try {
    const gltfExporter = new GLTFExporter()
    const glbData = (await gltfExporter.parseAsync(root, {
      binary: true,
      embedImages: true,
      onlyVisible: true,
    })) as ArrayBuffer

    const usdzExporter = new USDZExporter()
    const usdzData = await usdzExporter.parseAsync(root, {
      maxTextureSize: 2048, // decals render at 1400px — don't let USDZ downscale
      quickLookCompatible: true,
    })

    const poster = await renderMockup(design, front ? 'front' : 'back', 720).then((c) => canvasToBlob(c))

    return {
      glb: new Blob([glbData], { type: 'model/gltf-binary' }),
      usdz: new Blob([usdzData as BlobPart], { type: 'model/vnd.usdz+zip' }),
      poster,
    }
  } finally {
    man.dispose()
    for (const d of decalDisposables) d.dispose()
  }
}

/**
 * Upload the model blobs to the AR blob store (Cloudflare Worker → R2) and
 * return the short id. Throws when the backend isn't reachable (e.g. plain
 * `vite dev` with no Worker) so the caller can show a helpful message.
 */
export async function uploadArModel(blobs: ArModelBlobs): Promise<string> {
  const form = new FormData()
  form.append('glb', blobs.glb, 'model.glb')
  form.append('usdz', blobs.usdz, 'model.usdz')
  form.append('poster', blobs.poster, 'poster.png')
  const res = await fetch('/api/ar', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`AR upload failed (${res.status})`)
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new Error('AR upload returned no id')
  return data.id
}
