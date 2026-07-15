/**
 * Custom garment shown with real depth: a silhouette-extruded shell (photo
 * front cap, photo/blank back cap, dark fabric walls) with a dark interior
 * backing plane so a detected neck/underarm hole reads hollow — matching how the
 * catalog GLBs are open at the collar.
 *
 * `CustomGarment` is the entry point: it tries to build a shell from the front
 * cutout alpha and renders it, otherwise it falls back to the proven curved
 * `CustomCard`. The shell is strictly gated inside `canvasToSilhouette` (see
 * src/lib/silhouette.ts), so uploads without a clean cutout keep the old look.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CardSource } from '@/lib/types'
import { buildShell, canvasToSilhouette, type Shell } from '@/lib/silhouette'
import { useSourceTexture } from './textures'
import { CustomCard } from './CustomCard'

// Fabric tones shared with CustomCard for a consistent custom-garment look.
const BLANK_BACK = '#242A33'
const BLANK_BACK_EMIT = '#232932'
const RIM = '#161B22'
const RIM_EMIT = '#10141B'
const INTERIOR = '#14181F'
const INTERIOR_EMIT = '#0E1218'

/** Build (and dispose) a shell from the front cutout alpha; null when ungated. */
function useShell(front: CardSource | null, wIn: number, hIn: number): Shell | null {
  const canvas = front?.canvas ?? null
  const version = front?.version ?? 0
  const shell = useMemo<Shell | null>(() => {
    if (!canvas) return null
    const sil = canvasToSilhouette(canvas, wIn, hIn)
    return sil ? buildShell(sil, wIn, hIn) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, version, wIn, hIn])

  useEffect(
    () => () => {
      shell?.geometry.dispose()
      shell?.interior?.dispose()
    },
    [shell],
  )
  return shell
}

interface ExtrudedGarmentProps {
  shell: Shell
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

  useEffect(() => {
    onMeasured?.(heightIn)
  }, [heightIn, onMeasured])

  if (!frontTex) return null

  return (
    <group>
      <mesh geometry={shell.geometry}>
        {/* 0: front cap = the photo */}
        <meshStandardMaterial
          attach="material-0"
          map={frontTex}
          roughness={0.85}
          metalness={0}
          envMapIntensity={envIntensity}
          side={THREE.FrontSide}
        />
        {/* 1: back cap = back photo, or a blank fabric silhouette */}
        {back && backTex ? (
          <meshStandardMaterial
            attach="material-1"
            map={backTex}
            roughness={0.9}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        ) : (
          <meshStandardMaterial
            attach="material-1"
            color={BLANK_BACK}
            emissive={BLANK_BACK_EMIT}
            roughness={0.9}
            metalness={0}
            envMapIntensity={envIntensity}
            side={THREE.FrontSide}
          />
        )}
        {/* 2: extruded walls (incl. hole walls) = dark fabric edge */}
        <meshStandardMaterial
          attach="material-2"
          color={RIM}
          emissive={RIM_EMIT}
          roughness={0.95}
          metalness={0}
          envMapIntensity={envIntensity}
          side={THREE.DoubleSide}
        />
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

/** Extruded shell when the cutout allows it, else the curved card. */
export function CustomGarment({ front, back, envIntensity = 1, onMeasured }: CustomGarmentProps) {
  const primary = front ?? back
  const wIn = front?.wIn ?? primary?.wIn ?? 20
  const hIn = front?.hIn ?? primary?.hIn ?? 24
  const shell = useShell(front, wIn, hIn)

  // DEV probe (see Stage.tsx __pose) — which representation is live.
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as unknown as { __custom3d?: string }).__custom3d = shell && front ? 'extrude' : 'card'
  }, [shell, front])

  if (shell && front) {
    return (
      <ExtrudedGarment
        shell={shell}
        front={front}
        back={back}
        envIntensity={envIntensity}
        heightIn={Math.max(hIn, back?.hIn ?? hIn)}
        onMeasured={onMeasured}
      />
    )
  }
  return <CustomCard front={front} back={back} envIntensity={envIntensity} onMeasured={onMeasured} />
}
