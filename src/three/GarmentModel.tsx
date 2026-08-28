/**
 * Catalog garment (tee / hoodie) with the design mapped onto the cloth.
 *
 * 1 world unit = 1 inch, and the inches are physical: the GLB is normalized once
 * per (model, size) so its own chest arc measures the size chart's laid-flat
 * half-chest and its own body measures the chart's body length (see
 * src/three/garmentFrame.ts and src/three/calibration.ts).
 *
 * The front/back print is NOT a projected decal. It is a second pass over the
 * garment geometry whose UVs are FABRIC coordinates (inches of cloth from the
 * centre-front line, from src/three/fabricUnwrap.ts), so a 10 cm logo covers
 * 10 cm of cloth wherever it sits, nothing is clipped by a projector box, and
 * the 2D editor's inches and the 3D surface are literally the same numbers.
 * A projected decal survives only for the sleeve (a tube on its own slanted
 * axis, which the torso unwrap does not describe) and as the fallback when a
 * mesh cannot be unwrapped at all.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Decal, useGLTF } from '@react-three/drei'
import type { CatalogGarmentId, DecalSource, Side, SizeId } from '@/lib/types'
import { DEFAULT_SIZE } from '@/content/sizeChart'
import { GARMENTS } from '@/garments'
import { CALIBRATION, MAX_BAKED_NORMAL_SCALE } from './calibration'
import { applyWeaveBump, inkWeaveOptions, WEAVE_DEFAULTS } from './clothShading'
import { buildFabricOverlay, fabricPrintMaterial, projectedPrintMaterial } from './decalGeom'
import { armProfile, buildGarmentFrame, fabricFrameFor, printCentreYIn, type GarmentFrame } from './garmentFrame'
import { useSourceTexture } from './textures'
import { shellRadiusAt } from './fabricUnwrap'

useGLTF.preload('/models/tee.glb', false, false)
useGLTF.preload('/models/hoodie.glb', false, false)

interface NormalizedGarment extends GarmentFrame {
  material: THREE.MeshPhysicalMaterial
}

function firstMesh(root: THREE.Object3D, name?: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  root.traverse((o) => {
    if (found) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && (!name || mesh.name === name)) found = mesh
  })
  return found
}

function useNormalizedGarment(garment: CatalogGarmentId, sizeId: SizeId): NormalizedGarment {
  const calib = CALIBRATION[garment]
  const gltf = useGLTF(calib.url, false, false)

  const normalized = useMemo<NormalizedGarment>(() => {
    gltf.scene.updateMatrixWorld(true)
    const src = firstMesh(gltf.scene, calib.meshName) ?? firstMesh(gltf.scene)
    if (!src) throw new Error(`No mesh found in ${calib.url}`)
    const frame = buildGarmentFrame(garment, src, sizeId)

    const srcMat = (Array.isArray(src.material) ? src.material[0] : src.material) as THREE.MeshStandardMaterial
    // Upgrade to a physical material with a cloth sheen so the tee/hoodie reads
    // as fabric (a Fresnel grazing highlight that emphasises curvature) rather
    // than plastic. The print is a separate pass, so inch accuracy is untouched.
    // Copy source maps explicitly: Physical.copy(Standard) is unsafe because
    // the Standard source lacks the sheen fields Physical.copy reads.
    //
    // `normalScale` is copied (and capped) because dropping it was quietly
    // throwing away most of the tee's relief: that GLB asks for its normal map
    // at scale 2.81, and rebuilding the material without it left a flat, waxy
    // surface. `aoMap` is copied only where the bake is USABLE, see
    // `bakedAoIntensity` in calibration.ts; the tee's back island is a black
    // smear and is better replaced by the measured cavity term. When it is
    // taken it needs the geometry's `uv` and rides the texture's own `channel`,
    // both of which survive the clone.
    const material = new THREE.MeshPhysicalMaterial({
      map: srcMat.map,
      normalMap: srcMat.normalMap,
      roughnessMap: srcMat.roughnessMap,
      aoMap: calib.cloth.bakedAoIntensity > 0 ? srcMat.aoMap : null,
      color: srcMat.color.clone(),
      roughness: calib.roughness,
      metalness: 0,
      envMapIntensity: calib.envMapIntensity,
      sheen: calib.cloth.sheen,
      sheenRoughness: calib.cloth.sheenRoughness,
      vertexColors: frame.geometry.getAttribute('color') !== undefined,
      // BOTH bundled GLBs declare `doubleSided: true`, and rebuilding the
      // material dropped it back to three's FrontSide default. A garment is an
      // OPEN surface (the tee mesh has 411 boundary edges), so with backfaces
      // culled you look into the collar, the hem or a cuff and see the backdrop
      // straight through the shirt, which on the default ¾ view puts a hole at
      // the neckline. VSM leaves `side` alone in the shadow pass, so there is
      // no separate shadowSide to set.
      side: srcMat.side,
    })
    // The tee's normalTexture asks for scale 2.81 over an 8×-tiled 1024 px JPEG.
    // At the framing the studio actually uses that map mips down about tenfold,
    // so what survives is its low-frequency mottling, and 2.81 amplifies THAT,
    // not the thread detail the number was authored for.
    if (srcMat.normalMap) {
      // PER AXIS, not by length: `clampLength` bounds the L2 norm, so a uniform
      // (s, s) scale is really capped at MAX/√2: 1.5 would have been 1.061 in
      // effect, a different material from the one the number describes.
      material.normalScale.set(
        THREE.MathUtils.clamp(srcMat.normalScale.x, -MAX_BAKED_NORMAL_SCALE, MAX_BAKED_NORMAL_SCALE),
        THREE.MathUtils.clamp(srcMat.normalScale.y, -MAX_BAKED_NORMAL_SCALE, MAX_BAKED_NORMAL_SCALE),
      )
    }
    if (material.aoMap) material.aoMapIntensity = calib.cloth.bakedAoIntensity
    applyWeaveBump(material, {
      ...WEAVE_DEFAULTS,
      foldStrength: calib.cloth.foldStrength,
      foldHalfHeightIn: frame.heightIn / 2,
    })

    return { ...frame, material }
  }, [gltf, garment, calib, sizeId])

  useEffect(
    () => () => {
      normalized.geometry.dispose()
      normalized.material.dispose()
    },
    [normalized],
  )

  return normalized
}

const PROBE_MATERIAL = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
/** Sheen mixing target: see the colour effect in GarmentModel. */
const WHITE = new THREE.Color(1, 1, 1)

/** Z of the outermost front/back surface at (xIn, yIn), via local raycast. */
function probeSurfaceZ(geometry: THREE.BufferGeometry, xIn: number, yIn: number, side: Side): number | null {
  const mesh = new THREE.Mesh(geometry, PROBE_MATERIAL)
  const ray = new THREE.Raycaster()
  const sign = side === 'front' ? 1 : -1
  ray.set(new THREE.Vector3(xIn, yIn, sign * 1000), new THREE.Vector3(0, 0, -sign))
  const hits = ray.intersectObject(mesh, false)
  return hits.length > 0 ? hits[0].point.z : null
}

interface PrintOverlayProps {
  frame: GarmentFrame
  garment: CatalogGarmentId
  side: Exclude<Side, 'sleeve'>
  source: DecalSource
  /** Print grading factor for the previewed size (src/lib/printScale.ts). */
  k: number
  /** Scene lighting multiplier: the SAME one the cloth under it takes. */
  envIntensity: number
}

/**
 * The print, painted in fabric space. The overlay is the garment mesh itself
 * with fabric UVs, lifted a hair along its normals; the material discards
 * everything outside the print rect and everything off the printable shell.
 */
function PrintOverlay({ frame, garment, side, source, k, envIntensity }: PrintOverlayProps) {
  const texture = useSourceTexture(source, { premultiplied: true })

  const geometry = useMemo(
    () => buildFabricOverlay(frame.geometry, fabricFrameFor(garment, side, frame, source.wIn, source.hIn, k)),
    [frame, garment, side, source.wIn, source.hIn, k],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  const cavity = geometry.getAttribute('color') !== undefined
  const material = useMemo(
    () =>
      texture
        ? fabricPrintMaterial(
            texture,
            cavity,
            inkWeaveOptions(CALIBRATION[garment].cloth.foldStrength, frame.heightIn / 2),
          )
        : null,
    [texture, cavity, garment, frame.heightIn],
  )
  useEffect(() => () => material?.dispose(), [material])

  // The ink is lit by the same scene as the cloth it is fused to. Without this
  // the garment dimmed at night and brightened on the beach while the artwork
  // held its studio brightness: a print that does not follow its own shirt is
  // the definition of a sticker added afterwards.
  useEffect(() => {
    if (material) material.envMapIntensity = CALIBRATION[garment].envMapIntensity * envIntensity
  }, [material, garment, envIntensity])

  if (!material) return null
  return <mesh geometry={geometry} material={material} renderOrder={2} receiveShadow />
}

/**
 * The ink material for a PROJECTED decal, with the treatment the fabric overlay
 * already had: the cloth's weave and drape underneath it, the film's own edge,
 * the un-premultiply, and the scene's exposure.
 *
 * Both projected paths shipped as a bare `meshStandardMaterial`, so a sleeve
 * print kept a flat studio brightness while the sleeve under it curved into the
 * armpit hollow, went into the key's shadow and took the fabric's grain. The
 * front and back panels have not looked like that since the fabric overlay
 * landed; the sleeve never caught up.
 */
function useProjectedInk(
  texture: THREE.CanvasTexture | null,
  garment: CatalogGarmentId,
  envIntensity: number,
  foldHalfHeightIn: number,
): THREE.MeshStandardMaterial | null {
  const material = useMemo(
    () =>
      texture
        ? projectedPrintMaterial(
            texture,
            inkWeaveOptions(CALIBRATION[garment].cloth.foldStrength, foldHalfHeightIn),
          )
        : null,
    [texture, garment, foldHalfHeightIn],
  )
  useEffect(() => () => material?.dispose(), [material])
  useEffect(() => {
    if (material) material.envMapIntensity = CALIBRATION[garment].envMapIntensity * envIntensity
  }, [material, garment, envIntensity])
  return material
}

interface PrintDecalProps {
  geometry: THREE.BufferGeometry
  side: Exclude<Side, 'sleeve'>
  source: DecalSource
  /** World Y (inches) of the print-area centre. */
  centreYIn: number
  garment: CatalogGarmentId
  envIntensity: number
  foldHalfHeightIn: number
}

/**
 * Fallback for a mesh the unwrap could not validate: an orthographic projector.
 * It clips artwork that curves away from the box and maps chords rather than
 * arc length, so it is deliberately the second choice, but a wrong-looking
 * print beats no print, and it is what keeps an unknown ingested mesh usable.
 */
function PrintDecal({ geometry, side, source, centreYIn, garment, envIntensity, foldHalfHeightIn }: PrintDecalProps) {
  const texture = useSourceTexture(source, { premultiplied: true })
  const material = useProjectedInk(texture, garment, envIntensity, foldHalfHeightIn)

  const placement = useMemo(() => {
    // Probe the surface Z over the WHOLE footprint (a 5×5 grid), skipping
    // misses: the old ±half-width probes fell off the torso entirely and their
    // bbox fallback floated the box off the fabric.
    let zMin = Infinity
    let zMax = -Infinity
    for (let j = 0; j <= 4; j++) {
      for (let i = 0; i <= 4; i++) {
        const z = probeSurfaceZ(
          geometry,
          -source.wIn / 2 + (source.wIn * i) / 4,
          centreYIn - source.hIn / 2 + (source.hIn * j) / 4,
          side,
        )
        if (z === null) continue
        if (z < zMin) zMin = z
        if (z > zMax) zMax = z
      }
    }
    const half = Math.abs((geometry.boundingBox as THREE.Box3).max.z)
    if (!Number.isFinite(zMin)) return { z: side === 'front' ? half * 0.8 : -half * 0.8, depth: 0.8 }
    // Clamp to < 0.55·halfDepth so a front box never reaches the back
    // hemisphere (DecalGeometry does no normal culling, so it would bleed).
    return { z: (zMin + zMax) / 2, depth: THREE.MathUtils.clamp(zMax - zMin + 1.0, 0.8, 0.55 * half) }
  }, [geometry, side, centreYIn, source.wIn, source.hIn])

  if (!material || !texture) return null
  return (
    // `map` and `depthTest` are passed even though the material already carries
    // them: drei's Decal pierces `material-map` and `material-depthTest` onto
    // whatever material the mesh ends up with, and its defaults are `undefined`
    // and `false`, which would clear the texture and switch depth testing off
    // on a material that needs both.
    <Decal
      position={[0, centreYIn, placement.z]}
      rotation={[0, side === 'back' ? Math.PI : 0, 0]}
      scale={[source.wIn, source.hIn, placement.depth]}
      map={texture}
      depthTest
      renderOrder={2}
      receiveShadow
    >
      <primitive object={material} attach="material" />
    </Decal>
  )
}

/** Slack beyond the tube's own sagitta, inches: the print also curves
 *  vertically, and the box must not graze the surface it projects onto. */
const SLEEVE_BOX_SLACK_IN = 0.6
/** How far past the measured crown the box's outer face sits. Covers the sweep's
 *  own z-quantisation (±0.28 in on a tee ⇒ under 0.02 in of tube sagitta); the
 *  box simply extends into the air, which clips nothing. */
const SLEEVE_BOX_MARGIN_IN = 0.15

interface SleeveDecalProps {
  frame: GarmentFrame
  garment: CatalogGarmentId
  source: DecalSource
  /** +1 = one flank (+X), −1 = the other (−X). */
  sign: 1 | -1
  envIntensity: number
}

/**
 * The sleeve keeps a PROJECTED decal on purpose. The fabric unwrap measures arc
 * around the garment's vertical axis; an arm is a separate tube on its own
 * slanted axis (hence `sleeve.rotZ`), and estimating that axis from an A-pose
 * mesh is far less stable than projecting a 4 in print onto a ~2 in-radius tube.
 * What DID need fixing is the box: it is now sized from the arm's measured
 * thickness, so the print no longer loses its outboard fifth.
 */
function SleeveDecal({ frame, garment, source, sign, envIntensity }: SleeveDecalProps) {
  const texture = useSourceTexture(source, { premultiplied: true })
  const material = useProjectedInk(texture, garment, envIntensity, frame.heightIn / 2)
  const calib = CALIBRATION[garment]

  const placement = useMemo(() => {
    const y = calib.sleeve.yRaw * frame.yScale
    // The arm, MEASURED: its own radius, its own crown and its own centre. See
    // garmentFrame.armProfile for why all three had to be found and what each
    // was costing the print.
    const arm = armProfile(frame.geometry, y, sign, frame.depthIn / 2)
    // Depth must cover how far the tube falls away under the print's own half
    // width, plus slack for the vertical curve. sagitta = r − √(r² − (w/2)²).
    const halfW = Math.min(source.wIn / 2, arm.radiusIn * 0.98)
    const sagitta = arm.radiusIn - Math.sqrt(Math.max(0, arm.radiusIn * arm.radiusIn - halfW * halfW))
    const depth = Math.max(2 * sagitta + SLEEVE_BOX_SLACK_IN, 1.2)
    // Outer face just PAST the crown. Outboard of the surface costs nothing
    // (there is no geometry out there to clip) while a hair inboard cuts a strip
    // out of the middle of the print, which is exactly what pinning it to the
    // surface at z = 0 was doing.
    const x = arm.crownX + sign * SLEEVE_BOX_MARGIN_IN - sign * depth * 0.5
    return { x, y, z: arm.centreZ, depth }
  }, [frame, calib, sign, source.wIn])

  if (!material || !texture) return null
  return (
    <Decal
      position={[placement.x, placement.y, placement.z]}
      rotation={[0, (sign * Math.PI) / 2, sign * calib.sleeve.rotZ]}
      scale={[source.wIn, source.hIn, placement.depth]}
      map={texture}
      depthTest
      renderOrder={2}
      receiveShadow
    >
      <primitive object={material} attach="material" />
    </Decal>
  )
}

export interface GarmentModelProps {
  garment: CatalogGarmentId
  colorHex: string
  /** Previewed chart size; drives both the girth and the length scale. */
  sizeId?: SizeId
  front: DecalSource | null
  back: DecalSource | null
  sleeve: DecalSource | null
  /** Print grading factor for the previewed size (src/lib/printScale.ts). */
  printK?: number
  /** Scene lighting multiplier for the fabric's env-map response. */
  envIntensity?: number
  /**
   * Reports the normalized garment extents (inches). The floor follows the
   * PREVIEWED size; the camera frames `fitIn` (the chart's biggest size) so
   * changing size visibly changes the garment instead of the camera.
   */
  onMeasured?: (
    heightIn: number,
    widthIn?: number,
    fitIn?: { heightIn: number; widthIn: number },
    printIn?: {
      heightIn: number
      widthIn: number
      centreYIn: number
      centreZIn: number
      topZIn: number
      bottomZIn: number
    },
  ) => void
}

export function GarmentModel({
  garment,
  colorHex,
  sizeId,
  front,
  back,
  sleeve,
  printK = 1,
  envIntensity = 1,
  onMeasured,
}: GarmentModelProps) {
  const normalized = useNormalizedGarment(garment, sizeId ?? DEFAULT_SIZE)
  const { geometry, material, heightIn, widthIn, fitHeightIn, fitWidthIn, table } = normalized

  // The sheen lobe is the FUZZ on the fibre. It is lit from the side and behind
  // and it scatters forward, so it carries the LIGHT's colour more than the
  // dye's, which is why a rim-lit black tee has a pale grey edge in a real
  // photograph and not a black one. It still has to stay TIED to the garment,
  // because a fixed near-white sheen behaves as an additive film: measured
  // once, a warm off-white over #191C20 rendered that near-black hoodie brown.
  // 0.3 -> 0.55 is what lets the grazing lobe read on a dark colourway; the
  // warmth that caused the brown is gone from the rig itself (the studio key is
  // neutral now), so the risk that number was guarding against is not the same
  // risk any more.
  useEffect(() => {
    material.color.set(colorHex)
    material.sheenColor.set(colorHex).lerp(WHITE, 0.55)
    material.needsUpdate = true
  }, [material, colorHex])

  // Scene lighting: scale the calibrated env-map response so the fabric reads
  // brighter on the beach, moodier at night, etc.
  useEffect(() => {
    material.envMapIntensity = CALIBRATION[garment].envMapIntensity * envIntensity
    material.needsUpdate = true
  }, [material, garment, envIntensity])

  /**
   * Where the front print sits, for the detail framing (Stage.MeasuredExtent).
   *
   * Read from the two places the ink itself is read from: `printAreasIn` for
   * the rectangle and `printCentreYIn` for the height, both graded by the same
   * `printK`. Nothing here derives a position of its own, so a close-up cannot
   * drift away from what is printed.
   */
  const printFrame = useMemo(() => {
    const area = GARMENTS[garment].printAreasIn.front
    const centreYIn = printCentreYIn(garment, 'front', normalized, printK)
    /**
     * How far the printed cloth stands off the rotation axis, at that height.
     *
     * From the SAME arc table the ink is mapped through, at theta = 0, which is
     * the centre-front line: `shellRadiusAt` in raw units, scaled by the girth
     * scale. A camera placed at the distance the print rectangle asks for is
     * that much closer to the ink than to the axis it orbits, and on a tee that
     * is 5,8 in out of 38,8, which crops the print. When the table is not usable
     * (an ingested mesh we could not describe) the bbox half-depth is the
     * conservative stand-in: it is never smaller than the true offset, so the
     * close-up errs wide rather than cropping.
     */
    const centreZIn = normalized.table.usable
      ? shellRadiusAt(normalized.table, centreYIn / normalized.yScale, 0) * normalized.xzScale
      : normalized.depthIn / 2
    // The same reading at the rect's own top and bottom edges, because that is
    // where a close-up crops and the shell is not a cylinder: on the tee the
    // surface stands 5,79 in proud at the print centre and 6,04 at the bottom
    // edge, and it is the far edge that decides whether the area fits.
    const hIn = area.hIn * printK
    const zAt = (y: number) =>
      normalized.table.usable
        ? shellRadiusAt(normalized.table, y / normalized.yScale, 0) * normalized.xzScale
        : normalized.depthIn / 2
    return {
      widthIn: area.wIn * printK,
      heightIn: hIn,
      centreYIn,
      centreZIn,
      topZIn: zAt(centreYIn + hIn / 2),
      bottomZIn: zAt(centreYIn - hIn / 2),
    }
  }, [garment, printK, normalized])

  useEffect(() => {
    onMeasured?.(heightIn, widthIn, { heightIn: fitHeightIn, widthIn: fitWidthIn }, printFrame)
  }, [heightIn, widthIn, fitHeightIn, fitWidthIn, printFrame, onMeasured])

  const panel = (side: Exclude<Side, 'sleeve'>, source: DecalSource) =>
    table.usable ? (
      <PrintOverlay
        frame={normalized}
        garment={garment}
        side={side}
        source={source}
        k={printK}
        envIntensity={envIntensity}
      />
    ) : (
      <PrintDecal
        geometry={geometry}
        side={side}
        source={source}
        centreYIn={printCentreYIn(garment, side, normalized, printK)}
        garment={garment}
        envIntensity={envIntensity}
        foldHalfHeightIn={normalized.heightIn / 2}
      />
    )

  return (
    <mesh geometry={geometry} material={material} userData={{ role: 'garment' }} castShadow receiveShadow>
      {front && panel('front', front)}
      {back && panel('back', back)}
      {sleeve && (
        <>
          <SleeveDecal frame={normalized} garment={garment} source={sleeve} sign={-1} envIntensity={envIntensity} />
          <SleeveDecal frame={normalized} garment={garment} source={sleeve} sign={1} envIntensity={envIntensity} />
        </>
      )}
    </mesh>
  )
}
