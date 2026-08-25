/**
 * The 3D board: the selected basket products standing on one wall, orbitable
 * together. Lazily imported, exactly like the single-garment stage.
 *
 * WHAT MAKES IT AFFORDABLE
 * ------------------------
 *  - ONE geometry per (garment, size) and one material per (garment, colour),
 *    from src/three/garmentCache.ts. Eight identical L tees upload one mesh.
 *  - Prints are coarse fabric grids (src/three/BoardGarment.tsx), never the
 *    full-mesh overlay and never `<Decal>`.
 *  - `frameloop="demand"`: nothing renders unless the camera moved or a texture
 *    landed. There is no sway and no turntable here — both would pin the GPU at
 *    60 fps for a view the user is reading, not watching.
 *  - Past the product cap, extra products render as BILLBOARDS textured with the
 *    2D board's already-rasterised mockup: one quad, no new texture work, still
 *    positioned in the grid and still orbitable. Degrading beats refusing.
 *
 * Layout is a wall in X-Y at z = 0 with every garment facing +Z, so orbiting
 * walks the viewer around the rack and shows the backs — which is the thing a
 * multi-product 3D view exists to do. Garments are BOTTOM-aligned in their
 * cells: hems on a line is how a rail reads, and it is what makes an S tee
 * beside a 3XL hoodie legible as a size difference rather than a layout bug.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei'
import type { CardSource, CatalogGarmentId, DecalSource, GarmentId, SizeId } from '@/lib/types'
import { layoutBoard, type BoardItemSize } from '@/state/board'
import { getScene, type GroundSpec, type SceneId } from '@/scenes'
import { CALIBRATION } from './calibration'
import {
  boardGarmentFrame,
  boardGarmentMaterial,
  keepBoardGarments,
  scheduleDisposeBoardGarments,
} from './garmentCache'
import { BoardGarment } from './BoardGarment'
import { CustomCard } from './CustomCard'
import { Ground, ReadyPing, SHADOW_LIFT_IN, SceneEnvironment, fitRadius, groundYIn } from './Stage'
import { useSourceTexture } from './textures'

/** Gutter between products on the wall, inches. */
const GAP_W_IN = 6
const GAP_H_IN = 7

export interface BoardProduct {
  id: string
  /** Accessible name; also the group name, which makes r3f dumps readable. */
  label: string
  garment: GarmentId
  colorHex: string
  sizeId: SizeId
  /** Print grading factor for THIS product's size (never the global one). */
  printK: number
  front: DecalSource | null
  back: DecalSource | null
  custom: { front: CardSource | null; back: CardSource | null }
  /** Flat 2D mockup — the degradation path past the 3D cap. */
  flat: CardSource | null
  /** Real extents for anything we cannot measure from a mesh. */
  extentIn: BoardItemSize
  /** False → render as a billboard rather than a real garment. */
  solid: boolean
}

export interface Board3DProps {
  products: BoardProduct[]
  scene: SceneId
  /** Only `studio` follows it, but the floor's colour is picked from it. */
  theme: 'dark' | 'light'
  onFocus(id: string): void
  onReady?: () => void
}

// --- billboard (the graceful degradation) ---------------------------------

function Billboard({
  source,
  extentIn,
  label,
  onFocus,
}: {
  source: CardSource | null
  extentIn: BoardItemSize
  label: string
  onFocus(): void
}) {
  const texture = useSourceTexture(source)
  const w = source?.wIn ?? extentIn.wIn
  const h = source?.hIn ?? extentIn.hIn
  return (
    <group name={label}>
      {texture && (
        <mesh>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={texture} transparent alphaTest={0.02} toneMapped={false} />
        </mesh>
      )}
      <mesh
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
        <boxGeometry args={[w, h, 1]} />
        <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

// --- custom garment (ship-your-own) ---------------------------------------

function CustomProduct({
  product,
  envIntensity,
  onFocus,
}: {
  product: BoardProduct
  envIntensity: number
  onFocus(): void
}) {
  const primary = product.custom.front ?? product.custom.back
  const w = primary?.wIn ?? product.extentIn.wIn
  const h = primary?.hIn ?? product.extentIn.hIn
  return (
    <group name={product.label}>
      {/* CustomCard, not the inflated shell: a Poisson solve per garment is a
          single-garment luxury, and the card is already its documented cheap
          form. */}
      <CustomCard front={product.custom.front} back={product.custom.back} envIntensity={envIntensity} />
      <mesh
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
        <boxGeometry args={[w, h, 2]} />
        <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

// --- camera ---------------------------------------------------------------

/**
 * Frames the whole wall on arrival and clamps the orbit around that distance.
 * The single-garment rig's hard-coded 20…280 range is meaningless here: a board
 * is an order of magnitude wider than one garment, so both ends scale with the
 * framed distance instead.
 */
function BoardCameraRig({ halfWIn, halfHIn }: { halfWIn: number; halfHIn: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const framed = fitRadius(halfHIn * 2, camera.fov ?? 26, camera.aspect ?? 1, halfWIn * 2)
  const fitted = useRef(0)
  const userTook = useRef(false)

  useEffect(() => {
    if (userTook.current) return
    if (Math.abs(framed - fitted.current) < 0.5) return
    fitted.current = framed
    // Straight on: the point of arriving at a wall of garments is reading it
    // flat. Orbiting from there is the user's business.
    camera.position.set(0, 0, framed)
    camera.lookAt(0, 0, 0)
    invalidate()
  }, [framed, camera, invalidate, size])

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      minDistance={Math.max(12, framed * 0.28)}
      maxDistance={framed * 2.6}
      minPolarAngle={0.35}
      maxPolarAngle={1.62}
      onStart={() => {
        userTook.current = true
      }}
    />
  )
}

/**
 * DEV-only handle on the live scene, the same idea as Stage.tsx's `__pose`:
 * what a board actually put on the GPU (geometries, textures, hit proxies) is
 * only knowable from inside the canvas, and scripts/board-verify.mjs asserts on
 * it rather than trusting the code that built it.
 */
function DevProbe() {
  const scene = useThree((s) => s.scene)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __board3d?: { scene: THREE.Scene; gl: THREE.WebGLRenderer } }
    w.__board3d = { scene, gl }
    return () => {
      if (w.__board3d?.scene === scene) delete w.__board3d
    }
  }, [scene, gl])
  return null
}

/**
 * `frameloop="demand"` means a frame happens only when something asks. The env
 * map bake, the contact-shadow bake and every arriving texture are all "ask
 * once" events, so a short pump after any change is both sufficient and far
 * cheaper than a continuous loop.
 */
function Pump({ signal }: { signal: unknown }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let raf = 0
    const until = performance.now() + 700
    const tick = () => {
      invalidate()
      if (performance.now() < until) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [invalidate, signal])
  return null
}

// --- the wall -------------------------------------------------------------

/**
 * Where the board's floor is, and why it is not groundYIn(grid.height).
 *
 * `grid.height` is rows x cellH, and cellH is the TALLEST GARMENT PLUS
 * GAP_H_IN of air (state/board.ts). The items are bottom-aligned in their cell,
 * so on a single row the tallest garment is centred at y = 0 with its hem at
 * -maxH/2, while -grid.height/2 - 1.1 sits at -maxH/2 - 4,6: half a gap plus the
 * hem clearance. The single-garment stage gives 1,1 in of clearance and this
 * gave 4,6. That was invisible while the thing it positioned was a shadow drawn
 * on a transparent canvas, which is to say invisible; the moment the floor
 * became something you can see, the garments were standing well above it.
 * Taking the gap back out makes the argument a GARMENT height, which is what
 * groundYIn documents itself to take.
 */
const boardFloorY = (placed: { grid: { cellH: number } }): number =>
  groundYIn(Math.max(1, placed.grid.cellH - GAP_H_IN))

function BoardScene({
  products,
  envIntensity,
  shadow,
  ground,
  theme,
  onFocus,
}: {
  products: BoardProduct[]
  envIntensity: number
  shadow: { shadowColor: string; shadowOpacity: number }
  ground: GroundSpec | undefined
  theme: 'dark' | 'light'
  onFocus(id: string): void
}) {
  const aspect = useThree((s) => s.viewport.aspect)

  // Both catalog models, once. drei caches per URL, so N garments share one
  // parsed gltf; the per-size normalization is what garmentCache collapses.
  const urls = useMemo(() => {
    const wanted = new Set<string>()
    for (const p of products)
      if (p.solid && p.garment !== 'custom') wanted.add(CALIBRATION[p.garment].url)
    // useGLTF cannot be called conditionally, and an empty list is not a valid
    // request — a custom-only board still asks for the tee (already preloaded).
    return wanted.size > 0 ? [...wanted] : [CALIBRATION.tee.url]
  }, [products])
  const gltfs = useGLTF(urls)
  const sceneByUrl = useMemo(() => {
    const map = new Map<string, THREE.Object3D>()
    const list = Array.isArray(gltfs) ? gltfs : [gltfs]
    urls.forEach((url, i) => {
      const g = list[i]
      if (g) map.set(url, g.scene)
    })
    return map
  }, [gltfs, urls])

  // Paired keep/dispose: see garmentCache.ts. An immediate dispose here would
  // free the geometry StrictMode is about to re-mount, and cancelling only on
  // acquire would not help — the re-mount does not re-render.
  useEffect(() => {
    keepBoardGarments()
    return () => scheduleDisposeBoardGarments()
  }, [])

  const placed = useMemo(() => {
    const built = products.map((p) => {
      if (p.solid && p.garment !== 'custom') {
        const garment = p.garment as CatalogGarmentId
        const scene = sceneByUrl.get(CALIBRATION[garment].url)
        if (scene) {
          const frame = boardGarmentFrame(garment, p.sizeId, scene)
          return {
            product: p,
            frame,
            material: boardGarmentMaterial(
              garment,
              p.colorHex,
              scene,
              frame.geometry.getAttribute('color') !== undefined,
            ),
            size: { wIn: frame.widthIn, hIn: frame.heightIn },
          }
        }
      }
      const primary = p.custom.front ?? p.custom.back ?? p.flat
      return {
        product: p,
        frame: null,
        material: null,
        size: primary ? { wIn: primary.wIn, hIn: primary.hIn } : p.extentIn,
      }
    })
    const grid = layoutBoard(
      built.map((b) => b.size),
      { gapW: GAP_W_IN, gapH: GAP_H_IN, aspect: Math.max(aspect, 0.4), maxCols: built.length },
    )
    const items = built.map((b, i) => {
      const cell = grid.places[i]
      // Bottom-align inside the cell (hems on a line), then flip to +Y up.
      const bottom = (cell.row + 1) * grid.cellH - GAP_H_IN / 2
      return {
        ...b,
        position: [
          cell.x + cell.w / 2 - grid.width / 2,
          grid.height / 2 - (bottom - b.size.hIn / 2),
          0,
        ] as [number, number, number],
      }
    })
    return { items, grid }
  }, [products, sceneByUrl, aspect])

  return (
    <>
      <BoardCameraRig halfWIn={placed.grid.width / 2} halfHIn={placed.grid.height / 2} />
      {placed.items.map((it) => (
        <group key={it.product.id} position={it.position}>
          {it.frame && it.material ? (
            <BoardGarment
              frame={it.frame}
              material={it.material}
              garment={it.product.garment as CatalogGarmentId}
              front={it.product.front}
              back={it.product.back}
              printK={it.product.printK}
              label={it.product.label}
              onFocus={() => onFocus(it.product.id)}
            />
          ) : it.product.solid && it.product.garment === 'custom' ? (
            <CustomProduct
              product={it.product}
              envIntensity={envIntensity}
              onFocus={() => onFocus(it.product.id)}
            />
          ) : (
            <Billboard
              source={it.product.flat}
              extentIn={it.product.extentIn}
              label={it.product.label}
              onFocus={() => onFocus(it.product.id)}
            />
          )}
        </group>
      ))}
      {/* One row = a rail standing on a floor, and the shadow sells it. More
          rows are a wall, where a single ground plane is meaningless.

          AND THE FLOOR HAS TO BE THERE FOR THE SHADOW TO LAND ON. This rig has
          been mounted here the whole time and has never produced a visible
          pixel, for exactly the reason the single-garment stage had none: a
          contact shadow darkens what is under it, and under it was a
          transparent canvas over the page. The basket is one of the three
          places the preview is looked at, so it gets the same floor. */}
      {placed.grid.rows === 1 && placed.grid.height > 0 && (
        <>
          {ground && (
            <Ground
              spec={ground}
              theme={theme}
              fixed={{
                y: boardFloorY(placed),
                radius: (placed.grid.width * 1.15 * ground.radiusFactor) / 2,
              }}
            />
          )}
          <ContactShadows
            frames={1}
            position={[0, boardFloorY(placed) + SHADOW_LIFT_IN, 0]}
            scale={placed.grid.width * 1.15}
            blur={2.1}
            far={placed.grid.height * 0.55}
            resolution={512}
            color={shadow.shadowColor}
            opacity={shadow.shadowOpacity}
          />
        </>
      )}
      <Pump signal={placed} />
    </>
  )
}

// --- canvas ---------------------------------------------------------------

export default function Board3D({ products, scene, theme, onFocus, onReady }: Board3DProps) {
  const cfg = getScene(scene).three
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const mobile =
    typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767.98px)').matches
  // A drag that ends on a garment is an orbit, not a click. r3f fires its
  // pointer handlers regardless, so the guard has to live here.
  const down = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)

  useEffect(() => () => {
    document.body.style.cursor = ''
  }, [])

  if (contextLost) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg0">
        <div className="flex max-w-[320px] flex-col items-center gap-3 px-6 text-center">
          <p className="text-[12.5px] leading-relaxed text-tx2">
            Le contexte graphique a été perdu (trop de produits pour ce GPU, ou onglet
            en arrière-plan). Vos designs sont intacts.
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setContextLost(false)
              setCanvasKey((k) => k + 1)
            }}
          >
            Recharger la 3D
          </button>
        </div>
      </div>
    )
  }

  return (
    <Canvas
      key={canvasKey}
      frameloop="demand"
      dpr={[1, mobile ? 1.25 : 1.5]}
      camera={{ position: [0, 0, 160], fov: 26, near: 1, far: 4000 }}
      gl={{
        alpha: true,
        antialias: !mobile,
        // Neutral (KHR_PBR_neutral), matching the studio canvas — see the note
        // in src/three/index.tsx. ACES is a FILM look: it pulls saturated colour
        // toward the white point and lifts blacks, so the SAME red tee came out
        // one red in the studio, another on this board and a third in the AR
        // viewer, in one session. For an apparel shop the colour a customer
        // picks is the product.
        toneMapping: THREE.NeutralToneMapping,
        powerPreference: 'high-performance',
      }}
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
        moved.current = false
      }}
      onPointerMove={(e) => {
        if (!down.current) return
        if (Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 5)
          moved.current = true
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault()
          setContextLost(true)
        })
      }}
    >
      <SceneEnvironment key={scene} config={cfg} resolution={mobile ? 256 : 512} />
      {cfg.hemisphere && (
        <hemisphereLight
          args={[cfg.hemisphere.sky, cfg.hemisphere.ground, cfg.hemisphere.intensity]}
        />
      )}
      {/* THE SEPARATION LIGHTS, for the same reason the single-garment stage
          has them: a black tee against this backdrop measured a silhouette step
          of 0,2 sRGB levels, which is no outline at all, and the basket is
          where a customer compares one line against another. No shadow map, so
          a directional light's position here is only a bearing and none of the
          stage's extent plumbing is needed. This scene also inherited the night
          exposure lift, which was calibrated in the preview WITH these two
          carrying part of it, so leaving them out left board night both
          brighter and flatter than the thing it is a picture of. */}
      {cfg.rims?.map((r, i) => (
        <directionalLight
          key={i}
          position={r.direction}
          intensity={r.intensity}
          color={r.color}
          castShadow={false}
        />
      ))}
      <Suspense fallback={null}>
        <BoardScene
          products={products}
          envIntensity={cfg.envIntensity}
          shadow={{ shadowColor: cfg.shadowColor, shadowOpacity: cfg.shadowOpacity }}
          ground={cfg.ground}
          theme={theme}
          onFocus={(id) => {
            if (!moved.current) onFocus(id)
          }}
        />
        <ReadyPing onReady={onReady} />
      </Suspense>
      <DevProbe />
    </Canvas>
  )
}
