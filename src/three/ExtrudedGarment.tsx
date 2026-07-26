/**
 * Custom garment shown as a HOLLOW, realistic shell: two Poisson-inflated
 * sheets (photo front, photo/blank back — Baran & Lehtinen 2009, Z-only
 * displacement so inch/UV accuracy is untouched) plus inward-facing LINING
 * duplicates of both sheets. Through the neck/hem alpha openings you see the
 * darkened inside of the opposite panel with real parallax; two single-sided
 * interior catch planes cover only the degenerate straight-through ray.
 * Shading: photo-derived wrinkle normal map (mid folds are true geometry,
 * high-pass + knit grain live in the map), baked vertex AO, sheen cloth
 * highlight.
 *
 * `CustomGarment` is the entry point: it tries to build the inflated shell
 * from the front cutout (strictly gated inside `canvasToSilhouette`),
 * otherwise it falls back to the proven curved `CustomCard` — so uploads
 * without a clean cutout keep the old, safe look.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CardSource } from '@/lib/types'
import {
  buildInflatedShell,
  buildWrinkleNormalCanvas,
  canvasToSilhouette,
  type InflatedShell,
} from '@/lib/silhouette'
import { useNormalMapTexture, useSilhouetteTexture, useSourceTexture } from './textures'
import { fabricNormalTexture } from './fabric'
import { CustomCard } from './CustomCard'

// Fabric tones shared with CustomCard for a consistent custom-garment look.
const BLANK_BACK = '#242A33'
const BLANK_BACK_EMIT = '#232932'
const INTERIOR = '#14181F'
const INTERIOR_EMIT = '#0E1218'
const SHEEN = '#dfe6f2'
/** Lining multiply — the inside of a garment sits in its own shadow. #adadad
 *  sRGB ≈ 0.42 LINEAR (material.color is sRGB→linear converted; #6b6b6b would
 *  be a 0.15 multiply and, stacked with the baked ×0.6 lining AO, pitch black). */
const LINING_TINT = '#adadad'
/**
 * Blank-back lining flood: the unprinted REVERSE of the fabric reads lighter/
 * desaturated than the outside face. #242A33 × 0.42 would be pitch black and
 * indistinguishable from the interior catch plane — no hollow parallax read.
 */
const BLANK_LINING = '#aab3c0'

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
      shell?.interiorFront?.dispose()
      shell?.liningFront?.dispose()
      shell?.liningBack?.dispose()
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
  // Lighter flood for the blank back's LINING (visible through the neck).
  const blankLiningTex = useSilhouetteTexture(back ? null : front, BLANK_LINING)

  // Photo wrinkle + knit-grain normal map for the front (built by the shell).
  const frontN = useNormalMapTexture(shell.normalMapCanvas ?? null)
  // The back photo gets its own map. No pre-mirror: the back sheet samples
  // u→1−u and three's derivative tangent frame flips with the mirrored UVs,
  // so a map generated in the photo's own pixel space stays consistent.
  const backCanvas = back?.canvas ?? null
  const backVersion = back?.version ?? 0
  const backNCanvas = useMemo(
    () => (backCanvas && back ? buildWrinkleNormalCanvas(backCanvas, back.wIn, back.hIn) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backCanvas, backVersion],
  )
  const backN = useNormalMapTexture(backNCanvas)
  // Procedural weave fallback (blank back / shells built without a photo map).
  const fabricN = useMemo(() => fabricNormalTexture(front.wIn / 0.9, front.hIn / 0.9), [front.wIn, front.hIn])
  useEffect(() => () => fabricN.dispose(), [fabricN])

  useEffect(() => {
    onMeasured?.(heightIn)
  }, [heightIn, onMeasured])

  if (!frontTex) return null

  return (
    <group>
      {/* Front cap = photo, bulged. Alpha-tested opaque so the silhouette is
          crisp and front/back/lining/interior depth-sort correctly. */}
      <mesh geometry={shell.front}>
        <meshPhysicalMaterial
          map={frontTex}
          vertexColors
          normalMap={frontN ?? fabricN}
          normalScale={frontN ? [0.6, 0.6] : [0.35, 0.35]}
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
            normalMap={backN ?? fabricN}
            normalScale={backN ? [0.6, 0.6] : [0.35, 0.35]}
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

      {/* Interior LININGS — the hollow read. Same photo, multiplied down to a
          self-shadowed inside (winding already faces into the cavity, AO ×0.6
          is baked into their vertex colors). Matte: no sheen, high rough. */}
      {shell.liningFront && (
        <mesh geometry={shell.liningFront}>
          <meshStandardMaterial
            map={frontTex}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
            transparent={false}
            alphaTest={0.45}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity * 0.5}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.liningBack && (
        <mesh geometry={shell.liningBack}>
          <meshStandardMaterial
            map={back && backTex ? backTex : (blankLiningTex ?? undefined)}
            color={LINING_TINT}
            vertexColors
            normalMap={fabricN}
            normalScale={[0.3, 0.3]}
            transparent={false}
            alphaTest={0.45}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity * 0.5}
            side={THREE.FrontSide}
          />
        </mesh>
      )}

      {/* Interior catch planes: cover the straight-through ray only (all four
          sheets share the same alpha holes). Single-sided per view direction
          so neither can halo through the rim from the wrong side. */}
      {shell.interior && (
        <mesh geometry={shell.interior}>
          <meshStandardMaterial
            color={INTERIOR}
            emissive={INTERIOR_EMIT}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {shell.interiorFront && (
        <mesh geometry={shell.interiorFront}>
          <meshStandardMaterial
            color={INTERIOR}
            emissive={INTERIOR_EMIT}
            roughness={0.95}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
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
 * The uploaded garment shown as a real, hollow 3D garment: the Poisson-
 * inflated shell (silhouette.ts) — a seamed, chest-full, shoulder/hem-tucked
 * body with a visible interior through the neck opening, no longer a sealed
 * balloon. Prominent and clear for editing; the AR try-on then shows the same
 * garment WORN on a body. Falls back to the curved card when the upload has
 * no clean cutout.
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
