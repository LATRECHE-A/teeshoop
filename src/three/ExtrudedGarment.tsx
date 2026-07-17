/**
 * Custom garment shown with real VOLUME: an inflated "pillow" built from the
 * cutout alpha — two densely tessellated sheets (photo front cap, photo/blank
 * back cap) displaced in Z by a smooth distance-to-edge field so the garment
 * bulges like worn cloth instead of reading as a flat card. The garment
 * silhouette + neck/arm holes come from the texture alpha (alpha-tested), and a
 * dark interior backing makes holes read hollow. Caps use a sheen material for
 * a cloth-like grazing highlight.
 *
 * `CustomGarment` is the entry point: it tries to build the inflated shell from
 * the front cutout (strictly gated inside `canvasToSilhouette`), otherwise it
 * falls back to the proven curved `CustomCard` — so uploads without a clean
 * cutout keep the old, safe look.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CardSource } from '@/lib/types'
import { buildInflatedShell, canvasToSilhouette, type InflatedShell } from '@/lib/silhouette'
import { useSilhouetteTexture, useSourceTexture } from './textures'
import { fabricNormalTexture } from './fabric'
import { CustomCard } from './CustomCard'

// Fabric tones shared with CustomCard for a consistent custom-garment look.
const BLANK_BACK = '#242A33'
const BLANK_BACK_EMIT = '#232932'
const INTERIOR = '#14181F'
const INTERIOR_EMIT = '#0E1218'
const SHEEN = '#dfe6f2'

/** Build (and dispose) an inflated shell from the front cutout; null when ungated. */
function useInflatedShell(front: CardSource | null, wIn: number, hIn: number): InflatedShell | null {
  const canvas = front?.canvas ?? null
  const version = front?.version ?? 0
  const shell = useMemo<InflatedShell | null>(() => {
    if (!canvas) return null
    const sil = canvasToSilhouette(canvas, wIn, hIn)
    return sil ? buildInflatedShell(canvas, sil, wIn, hIn) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, version, wIn, hIn])

  useEffect(
    () => () => {
      shell?.front.dispose()
      shell?.back.dispose()
      shell?.interior?.dispose()
    },
    [shell],
  )
  return shell
}

interface ExtrudedGarmentProps {
  shell: InflatedShell
  front: CardSource
  back: CardSource | null
  envIntensity?: number
  heightIn: number
  onMeasured?: (heightIn: number) => void
}

function ExtrudedGarment({
  shell,
  front,
  back,
  envIntensity = 1,
  heightIn,
  onMeasured,
}: ExtrudedGarmentProps) {
  const frontTex = useSourceTexture(front)
  const backTex = useSourceTexture(back)
  // Missing back → the front's alpha silhouette flooded with a fabric tone.
  const blankBackTex = useSilhouetteTexture(back ? null : front, BLANK_BACK)
  // Subtle woven-cloth grain (shading only; geometry/UVs/inches untouched).
  const fabricN = useMemo(() => fabricNormalTexture(front.wIn / 0.9, front.hIn / 0.9), [front.wIn, front.hIn])
  useEffect(() => () => fabricN.dispose(), [fabricN])

  useEffect(() => {
    onMeasured?.(heightIn)
  }, [heightIn, onMeasured])

  if (!frontTex) return null

  return (
    <group>
      {/* Front cap = photo, bulged. Alpha-tested opaque so the silhouette is
          crisp and front/back/interior depth-sort correctly. */}
      <mesh geometry={shell.front}>
        <meshPhysicalMaterial
          map={frontTex}
          vertexColors
          normalMap={fabricN}
          normalScale={[0.35, 0.35]}
          transparent={false}
          alphaTest={0.45}
          roughness={0.86}
          metalness={0}
          sheen={0.55}
          sheenRoughness={0.85}
          sheenColor={SHEEN}
          envMapIntensity={envIntensity}
          side={THREE.FrontSide}
        />
      </mesh>

      {/* Back cap = back photo, or a blank fabric silhouette. */}
      <mesh geometry={shell.back}>
        {back && backTex ? (
          <meshPhysicalMaterial
            map={backTex}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.35, 0.35]}
            transparent={false}
            alphaTest={0.45}
            roughness={0.9}
            metalness={0}
            sheen={0.4}
            sheenRoughness={0.9}
            sheenColor={SHEEN}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        ) : (
          <meshPhysicalMaterial
            map={blankBackTex ?? undefined}
            color={blankBackTex ? '#ffffff' : BLANK_BACK}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.35, 0.35]}
            transparent={false}
            alphaTest={0.45}
            emissive={BLANK_BACK_EMIT}
            roughness={0.92}
            metalness={0}
            sheen={0.35}
            sheenRoughness={0.9}
            sheenColor={SHEEN}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        )}
      </mesh>

      {shell.interior && (
        <mesh geometry={shell.interior}>
          <meshStandardMaterial
            color={INTERIOR}
            emissive={INTERIOR_EMIT}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}

export interface CustomGarmentProps {
  front: CardSource | null
  back: CardSource | null
  envIntensity?: number
  onMeasured?: (heightIn: number) => void
}

/**
 * The uploaded garment shown as a real, volumetric 3D garment: the reshaped
 * inflated shell (silhouette.ts) — a seamed, chest-full, shoulder/hem-tucked
 * body, no longer a symmetric balloon. Prominent and clear for editing; the AR
 * try-on then shows the same garment WORN on a body. Falls back to the curved
 * card when the upload has no clean cutout.
 */
export function CustomGarment({ front, back, envIntensity = 1, onMeasured }: CustomGarmentProps) {
  // A back-only upload faces FORWARD (parity with 2D / poster / AR), never a
  // blank front card.
  const fwd = front ?? back
  const rev = front ? back : null
  const wIn = fwd?.wIn ?? 20
  const hIn = fwd?.hIn ?? 24
  const shell = useInflatedShell(fwd, wIn, hIn)

  useEffect(() => {
    if (import.meta.env.DEV)
      (window as unknown as { __custom3d?: string }).__custom3d = shell && fwd ? 'inflate' : 'card'
  }, [shell, fwd])

  if (shell && fwd) {
    return (
      <ExtrudedGarment
        shell={shell}
        front={fwd}
        back={rev}
        envIntensity={envIntensity}
        heightIn={Math.max(hIn, rev?.hIn ?? hIn)}
        onMeasured={onMeasured}
      />
    )
  }
  return <CustomCard front={fwd} back={rev} envIntensity={envIntensity} onMeasured={onMeasured} />
}
