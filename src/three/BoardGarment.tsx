/**
 * One catalog garment on the 3D board.
 *
 * TWO THINGS HERE ARE NOT STYLE CHOICES.
 *
 * 1. THE PRINT IS A LOW-POLY FABRIC GRID, never the preview's full-mesh fabric
 *    overlay and never drei's `<Decal>`. The overlay pass copies EVERY garment
 *    vertex (10.5k on the tee, 36.5k on the hoodie) and evaluates the arc-length
 *    unwrap at each one; `<Decal>` is far worse still, CPU-clipping every
 *    triangle of the parent mesh. Both are the right call for a single garment
 *    the user is inspecting, and both are multiplied by 2 sides × N products
 *    here. `buildFabricDecal` samples the SAME unwrap on its own coarse grid
 *    (441 vertices instead of 36,450), so the print sits on the true surface,
 *    at the true arc length, for a fraction of the work. It is the geometry AR
 *    already ships, which is also why its placement is already parity-checked
 *    (scripts/fabric-verify.mjs, check G).
 *
 * 2. POINTER EVENTS GO ON AN INVISIBLE BOX, never on the garment. react-three-
 *    fiber raycasts every object that carries a handler on every pointermove;
 *    eight hoodies is half a million triangles per mouse move. The proxy is 12
 *    triangles. It must be `colorWrite: false` and NOT `visible={false}`.
 *    Raycaster skips invisible objects entirely, which would make it useless.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CatalogGarmentId, DecalSource, Side } from '@/lib/types'
import { buildFabricDecal, makeCurvedDecal, projectedPrintMaterial } from './decalGeom'
import { fabricFrameFor, printCentreYIn, type GarmentFrame } from './garmentFrame'
import { useSourceTexture } from './textures'
import { inkWeaveOptions } from './clothShading'
import { CALIBRATION } from './calibration'

/**
 * Print lift above the fabric, inches. Larger than the preview's 0.012 because
 * the board's decal grid is coarse: a 20-segment chord cuts inside the surface
 * it approximates, and the sagitta of that chord is what has to be cleared.
 */
const BOARD_LIFT_IN = 0.06
/** Grid resolution of a board print. 20×20 = 800 triangles, 441 unwrap samples. */
const BOARD_DECAL_SEG = 20
/** Cylindrical fallback bend cap when a mesh has no usable arc table. */
const FALLBACK_BEND_MAX = (58 * Math.PI) / 180

interface BoardPrintProps {
  frame: GarmentFrame
  garment: CatalogGarmentId
  side: Exclude<Side, 'sleeve'>
  source: DecalSource
  /** Print grading factor for THIS line's size (src/lib/printScale.ts). */
  k: number
}

function BoardPrint({ frame, garment, side, source, k }: BoardPrintProps) {
  // The SAME ink as the single-garment preview. The board is the basket: a
  // customer comparing eight lines there and then opening one of them must not
  // see two different photographs of the same shirt, and until this shared the
  // preview's material it did: no un-premultiply (so every artwork edge kept the
  // dark halo the preview no longer has), no weave under the ink, no film edge.
  const texture = useSourceTexture(source, { premultiplied: true })
  // ...INCLUDING THE WEAVE, which the sentence above claimed and the call did
  // not do. `projectedPrintMaterial` takes the relief as an optional argument
  // and it was being left out, so the board's ink was the only ink in the app
  // sitting on a surface with no cloth under it: flat where the preview's is
  // broken up by the same thread and drape field as the garment. It is the
  // SAME FUNCTION the preview calls now, not the same literal written out
  // again, which is what "cannot drift apart" has to mean.
  const material = useMemo(
    () =>
      texture
        ? projectedPrintMaterial(
            texture,
            inkWeaveOptions(CALIBRATION[garment].cloth.foldStrength, frame.heightIn / 2),
          )
        : null,
    [texture, garment, frame.heightIn],
  )
  useEffect(() => () => material?.dispose(), [material])

  const placed = useMemo(() => {
    if (frame.table.usable)
      return {
        geometry: buildFabricDecal(
          fabricFrameFor(garment, side, frame, source.wIn, source.hIn, k),
          BOARD_LIFT_IN,
          BOARD_DECAL_SEG,
          BOARD_DECAL_SEG,
        ),
        position: [0, 0, 0] as [number, number, number],
        rotationY: 0,
      }
    // No usable unwrap (an ingested mesh we could not describe): fall back to a
    // cylinder hugging the bbox. Approximate by construction: it is the same
    // fallback the preview and the AR bake take, kept only so an unknown mesh
    // still shows its print rather than nothing.
    const radius = Math.max(1, frame.depthIn / 2)
    const y = printCentreYIn(garment, side, frame, k)
    const z = (side === 'front' ? 1 : -1) * (radius * 0.8 + BOARD_LIFT_IN)
    return {
      geometry: makeCurvedDecal(source.wIn, source.hIn, radius, FALLBACK_BEND_MAX),
      position: [0, y, z] as [number, number, number],
      rotationY: side === 'back' ? Math.PI : 0,
    }
  }, [frame, garment, side, source.wIn, source.hIn, k])

  useEffect(() => () => placed.geometry.dispose(), [placed])

  if (!material) return null
  return (
    <mesh
      geometry={placed.geometry}
      material={material}
      position={placed.position}
      rotation={[0, placed.rotationY, 0]}
      renderOrder={2}
    />
  )
}

export interface BoardGarmentProps {
  frame: GarmentFrame
  material: THREE.Material
  garment: CatalogGarmentId
  front: DecalSource | null
  back: DecalSource | null
  /** Print grading factor for this line's size. */
  printK: number
  /** Accessible name, mirrored by the sr-only product list beside the canvas. */
  label: string
  onFocus(): void
}

export function BoardGarment({
  frame,
  material,
  garment,
  front,
  back,
  printK,
  label,
  onFocus,
}: BoardGarmentProps) {
  const box = frame.geometry.boundingBox as THREE.Box3

  return (
    <group name={label}>
      <mesh geometry={frame.geometry} material={material} />
      {front && (
        <BoardPrint frame={frame} garment={garment} side="front" source={front} k={printK} />
      )}
      {back && <BoardPrint frame={frame} garment={garment} side="back" source={back} k={printK} />}
      {/* Sleeve prints are deliberately absent: unreadable at board zoom, and
          two extra meshes plus a texture per garment is the whole budget. */}
      <mesh
        position={[0, 0, 0]}
        onPointerUp={(e) => {
          e.stopPropagation()
          onFocus()
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = ''
        }}
      >
        <boxGeometry
          args={[
            Math.max(box.max.x - box.min.x, 1),
            Math.max(box.max.y - box.min.y, 1),
            Math.max(box.max.z - box.min.z, 1),
          ]}
        />
        <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  )
}
