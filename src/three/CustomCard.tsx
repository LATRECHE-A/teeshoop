/**
 * Custom garment ("customer ships their own") — the CardSource composites are
 * shown as a gently curved card pair: front face, blank/back face and a dark
 * silhouette "rim" sandwiched between them for an extruded-thickness
 * illusion. 1 world unit = 1 inch; the card is wIn inches wide (measured
 * along the bent surface).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CardSource } from '@/lib/types'
import { useSilhouetteTexture, useSourceTexture } from './textures'

/** Total cylindrical bend of the card, radians (~12°). */
const BEND = (12 * Math.PI) / 180
/** Blank reverse color when the back photo is missing (per CONTRACTS §A3). */
const BLANK_BACK = '#242A33'
const RIM = '#161B22'

function makeCurvedCard(wIn: number, hIn: number): { geometry: THREE.PlaneGeometry; sagIn: number } {
  const radius = wIn / BEND
  const geometry = new THREE.PlaneGeometry(wIn, hIn, 48, 1)
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const nor = geometry.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const theta = (pos.getX(i) / wIn) * BEND // -BEND/2 .. BEND/2
    pos.setXYZ(i, radius * Math.sin(theta), pos.getY(i), radius * (Math.cos(theta) - 1))
    nor.setXYZ(i, Math.sin(theta), 0, Math.cos(theta))
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, sagIn: radius * (1 - Math.cos(BEND / 2)) }
}

function useCurvedCard(wIn: number, hIn: number) {
  const card = useMemo(() => makeCurvedCard(wIn, hIn), [wIn, hIn])
  useEffect(() => () => card.geometry.dispose(), [card])
  return card
}

export interface CustomCardProps {
  front: CardSource | null
  back: CardSource | null
  onMeasured?: (heightIn: number) => void
}

export function CustomCard({ front, back, onMeasured }: CustomCardProps) {
  const primary = front ?? back
  const frontTex = useSourceTexture(front)
  // Note: the back face is a π-rotated plane, and that rotation alone makes
  // its texture read correctly from behind (no u-flip needed — verified with
  // the harness "BACK" wordmark).
  const backTex = useSourceTexture(back)
  // Missing back → the front's alpha silhouette filled with a neutral fabric
  // tone (looks like the blank reverse of the garment).
  const blankBackTex = useSilhouetteTexture(back ? null : front, BLANK_BACK)
  const rimTex = useSilhouetteTexture(primary, RIM)

  const wIn = primary?.wIn ?? 20
  const hIn = primary?.hIn ?? 24
  const backWIn = back?.wIn ?? wIn
  const backHIn = back?.hIn ?? hIn

  const frontCard = useCurvedCard(wIn, hIn)
  const backCard = useCurvedCard(backWIn, backHIn)

  // Keep the two faces from intersecting: each face's edges curve backwards
  // by sagIn, so the slab must be a bit thicker than twice that.
  const thickness = Math.max(1.1, 2.3 * Math.max(frontCard.sagIn, backCard.sagIn))

  useEffect(() => {
    onMeasured?.(Math.max(hIn, backHIn))
  }, [hIn, backHIn, onMeasured])

  if (!primary) return null

  return (
    <group>
      {(front ? frontTex : rimTex) && (
        <mesh geometry={frontCard.geometry} position={[0, 0, thickness / 2]}>
          <meshStandardMaterial
            map={front ? frontTex : rimTex}
            alphaTest={0.35}
            roughness={0.85}
            metalness={0}
            side={THREE.FrontSide}
          />
        </mesh>
      )}
      {/* Dark mid layer, slightly enlarged: reads as the slab's edge.
          The emissive floor keeps it legible over the near-black app bg. */}
      {rimTex && (
        <mesh geometry={frontCard.geometry} scale={[1.02, 1.015, 1]}>
          <meshStandardMaterial
            map={rimTex}
            alphaTest={0.35}
            roughness={0.95}
            metalness={0}
            emissive="#10141B"
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {(back ? backTex : blankBackTex) && (
        <group rotation={[0, Math.PI, 0]} position={[0, 0, -thickness / 2]}>
          <mesh geometry={back ? backCard.geometry : frontCard.geometry}>
            <meshStandardMaterial
              map={back ? backTex : blankBackTex}
              alphaTest={0.35}
              roughness={0.9}
              metalness={0}
              // The blank reverse (#242A33 silhouette) would otherwise crush
              // to the backdrop under the moody rear lighting. alphaTest
              // already confines fragments to the silhouette cutout.
              emissive={back ? '#000000' : '#232932'}
              side={THREE.FrontSide}
            />
          </mesh>
        </group>
      )}
    </group>
  )
}
